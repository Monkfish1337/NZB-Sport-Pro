// qBittorrent Web API v2 client.
//
// Used by /api/grab when the operator clicks "qBit" on a general-search row.
// Manages session cookies across requests so we don't re-auth on every grab.
//
// Auth flow:
//   POST <base>/api/v2/auth/login    (urlencoded user+pass) → session cookie
// Add torrent:
//   POST <base>/api/v2/torrents/add  (urlencoded; field "urls" = magnet OR .torrent URL)
//
// Cookie name (0.1.5 — quirk):
//   Older qBit:    "SID"
//   Newer qBit:    "QBT_SID_<port>" (e.g. QBT_SID_8090) — distinguishes
//                  sessions when multiple qBit instances share a hostname.
//   We accept either, store the full {name,value} pair, and replay it
//   verbatim on subsequent requests.
//
// Cookie lifetime is long-ish (~60 min default). We re-auth lazily on 401.
// Add accepts magnets and HTTP .torrent URLs — qBit handles the fetch itself.

const fetch = require('node-fetch');
const httpAgent = require('../http-agent');
const log = require('../log-buffer');

const DEFAULT_TIMEOUT_MS = 10000;
const SESSION_TTL_MS = 55 * 60 * 1000;

// Match either the legacy SID cookie OR the newer QBT_SID_<port> form.
// Both are case-sensitive in qBit's source.
const SESSION_COOKIE_RE = /(SID|QBT_SID_\d+)=([^;]+)/;

function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

// Per-target session cache. Key = `<url>|<username>`.
// Value = { name: 'SID'|'QBT_SID_8090', value: '<token>', expiresAt }.
const SESSION_CACHE = new Map();

function sessionKey(cfg) { return (cfg.url || '') + '|' + (cfg.username || ''); }

function getCachedSession(cfg) {
  const e = SESSION_CACHE.get(sessionKey(cfg));
  if (!e) return null;
  if (e.expiresAt < Date.now()) { SESSION_CACHE.delete(sessionKey(cfg)); return null; }
  return e;
}

function setCachedSession(cfg, name, value) {
  SESSION_CACHE.set(sessionKey(cfg), {
    name, value,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
}

function clearCachedSession(cfg) { SESSION_CACHE.delete(sessionKey(cfg)); }

// Walk every Set-Cookie header on the response and return the first matching
// session cookie as { name, value }. Returns null if none found.
function extractSessionCookie(res) {
  // Method 1: raw Set-Cookie array (node-fetch v2 exposes res.headers.raw())
  if (res.headers.raw) {
    const raw = res.headers.raw()['set-cookie'];
    if (Array.isArray(raw)) {
      for (const c of raw) {
        const m = SESSION_COOKIE_RE.exec(c);
        if (m) return { name: m[1], value: m[2] };
      }
    }
  }
  // Method 2: combined single string (fallback for environments that flatten)
  const combined = res.headers.get('set-cookie');
  if (combined) {
    const m = SESSION_COOKIE_RE.exec(combined);
    if (m) return { name: m[1], value: m[2] };
  }
  // Method 3: walk all response headers manually
  for (const [key, value] of res.headers) {
    if (key.toLowerCase() === 'set-cookie') {
      const m = SESSION_COOKIE_RE.exec(value);
      if (m) return { name: m[1], value: m[2] };
    }
  }
  return null;
}

async function login(cfg) {
  const base = trimSlash(cfg.url);
  const body = new URLSearchParams({
    username: cfg.username || '',
    password: cfg.password || '',
  });
  const res = await fetch(base + '/api/v2/auth/login', httpAgent.fetchOpts({
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': base,
    },
    body,
    timeout: DEFAULT_TIMEOUT_MS,
  }, base + '/api/v2/auth/login'));
  // qBit returns 200 with body "Ok."/"Fails." on older versions, 204 No Content
  // on newer versions. Treat any 2xx as a positive HTTP outcome and gate on
  // the cookie presence + (if present) the body text.
  if (!res.ok) throw new Error('login http ' + res.status);
  const text = await res.text();
  if (text && text.trim() === 'Fails.') {
    throw new Error('login rejected (bad credentials)');
  }
  const session = extractSessionCookie(res);
  if (!session) {
    // Debug-friendly: dump the header names we did see so future qBit changes
    // are easier to diagnose without a server-side curl.
    const names = [];
    for (const [k] of res.headers) names.push(k);
    throw new Error('login succeeded but no SID/QBT_SID_* cookie. Headers: ' + names.join(', '));
  }
  setCachedSession(cfg, session.name, session.value);
  return session;
}

async function ensureSession(cfg) {
  let s = getCachedSession(cfg);
  if (s) return s;
  return login(cfg);
}

// Add a torrent by URL or magnet. Returns { ok, error? }.
//   opts.config    — { url, username, password, category }  (required)
//   opts.url       — magnet: or http(s):// .torrent URL     (required)
//   opts.category  — override default category               (optional)
async function addTorrent(opts) {
  const cfg = opts && opts.config;
  if (!cfg || !cfg.url) return { ok: false, error: 'qbit not configured' };
  if (!opts.url) return { ok: false, error: 'no url/magnet provided' };
  const base = trimSlash(cfg.url);
  const category = (opts.category != null ? opts.category : cfg.category) || 'general';

  function buildBody() {
    const b = new URLSearchParams();
    b.append('urls', opts.url);
    b.append('category', category);
    if (opts.savepath) b.append('savepath', opts.savepath);
    b.append('paused', 'false');
    return b;
  }

  async function attempt() {
    const session = await ensureSession(cfg);
    return fetch(base + '/api/v2/torrents/add', httpAgent.fetchOpts({
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': session.name + '=' + session.value,
        'Referer': base,
      },
      body: buildBody(),
      timeout: DEFAULT_TIMEOUT_MS,
    }, base + '/api/v2/torrents/add'));
  }

  let res;
  try {
    res = await attempt();
    if (res.status === 401 || res.status === 403) {
      clearCachedSession(cfg);
      res = await attempt();
    }
  } catch (err) {
    log.warn('http', 'qbit grab error: ' + err.message);
    return { ok: false, error: 'qbit: ' + err.message };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: 'qbit http ' + res.status + ' ' + body.slice(0, 200) };
  }
  const txt = (await res.text().catch(() => '')).trim();
  if (txt === 'Fails.') {
    return { ok: false, error: 'qbit rejected the URL (dupe? unreachable? malformed?)' };
  }
  return { ok: true };
}

async function testConnection(cfg) {
  if (!cfg || !cfg.url) return { ok: false, error: 'qbit not configured' };
  try {
    const session = await ensureSession(cfg);
    const base = trimSlash(cfg.url);
    const res = await fetch(base + '/api/v2/app/version', httpAgent.fetchOpts({
      method: 'GET',
      headers: {
        'Cookie': session.name + '=' + session.value,
        'Referer': base,
      },
      timeout: DEFAULT_TIMEOUT_MS,
    }, base + '/api/v2/app/version'));
    if (!res.ok) {
      clearCachedSession(cfg);
      return { ok: false, error: 'qbit http ' + res.status };
    }
    const v = (await res.text().catch(() => '')).trim();
    return { ok: true, version: v };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { addTorrent, testConnection, clearCachedSession };
