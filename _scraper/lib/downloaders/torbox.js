// TorBox API client (0.2.2 — grabber downloader target; 0.2.5 — multipart fix;
// 0.2.6 — download .torrent bytes and upload as real file, magnet-redirect aware).
//
// Adds a torrent (magnet or .torrent URL) or NZB URL to the user's TorBox
// queue. Different from SSS-side TorBox usage (which is a stream resolver);
// here it's a "queue for later" downloader target for the grabber search UI.
//
// Endpoints:
//   POST https://api.torbox.app/v1/api/torrents/createtorrent
//     Body multipart/form-data: { magnet: "<magnet-uri>" }  OR  { file: "<torrent-url>" }
//     Auth: Authorization: Bearer <apiKey>
//   POST https://api.torbox.app/v1/api/usenet/createusenetdownload
//     Body multipart/form-data: { link: "<nzb-url>" }
//     Auth: Authorization: Bearer <apiKey>
//
// 0.2.5 IMPORTANT: TorBox requires multipart/form-data for these two endpoints.
// application/x-www-form-urlencoded (which 0.2.2-0.2.4 sent) returns HTTP 422
// with a body like {"success":false,"error":"BAD_POST_DATA","detail":{...}}.
// We now use node-fetch v2's bundled form-data dependency to build multipart.
//
// Response shape (both endpoints):
//   { success: true, detail: 'queued', data: { torrent_id: ... } }   OR
//   { success: false, error: 'CODE', detail: '<string or object>' }

const fetch = require('node-fetch');
const FormData = require('form-data');   // 0.2.5 — bundled with node-fetch v2
const httpAgent = require('../http-agent');
const log = require('../log-buffer');

const DEFAULT_BASE = 'https://api.torbox.app/v1/api';
const DEFAULT_TIMEOUT_MS = 15000;

function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

// 0.2.5 — stringify anything, including nested objects, without falling into
// "[object Object]". Used for TorBox error payloads which sometimes nest an
// object under `detail`.
function niceStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

async function submit(cfg, path, form) {
  if (!cfg || !cfg.apiKey) return { ok: false, error: 'torbox api key not set' };
  const base = trimSlash(cfg.url) || DEFAULT_BASE;
  const url = base + path;

  // 0.2.5 — build multipart body. form-data sets its own Content-Type header
  // (including the multipart boundary), so we let it fill in the headers via
  // getHeaders() rather than setting Content-Type manually.
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) {
    if (v == null) continue;
    if (v && v.buffer) {
      // 0.2.6 — real file upload: { buffer, filename }
      fd.append(k, v.buffer, { filename: v.filename || 'upload.torrent', contentType: 'application/x-bittorrent' });
    } else {
      fd.append(k, String(v));
    }
  }

  let res;
  try {
    res = await fetch(url, httpAgent.fetchOpts({
      method: 'POST',
      headers: Object.assign(
        { 'Authorization': 'Bearer ' + cfg.apiKey },
        fd.getHeaders()
      ),
      body: fd,
      timeout: DEFAULT_TIMEOUT_MS,
    }, url));
  } catch (err) {
    log.warn('http', 'torbox grab error: ' + err.message);
    return { ok: false, error: 'torbox: ' + err.message };
  }

  // Read the body once, defensively — 422s come back as JSON with a nested
  // `detail` object.
  const rawText = await res.text().catch(() => '');
  let json = null;
  try { json = rawText ? JSON.parse(rawText) : null; } catch (_) { /* not JSON */ }

  if (!res.ok) {
    const errCode = json && (json.error || json.error_code) ? niceStr(json.error || json.error_code) : '';
    const detail  = json && json.detail ? niceStr(json.detail) : '';
    const msg = [errCode, detail].filter(Boolean).join(' — ') || rawText.slice(0, 200) || 'unknown';
    return { ok: false, error: 'torbox http ' + res.status + ': ' + msg };
  }
  if (!json) return { ok: false, error: 'torbox: non-JSON response: ' + rawText.slice(0, 200) };

  if (json.success) {
    const id = (json.data && (json.data.torrent_id || json.data.usenetdownload_id)) || null;
    return { ok: true, torrentId: id, detail: niceStr(json.detail) || 'queued' };
  }
  return { ok: false, error: niceStr(json.error) || niceStr(json.detail) || 'unknown torbox failure' };
}

// 0.2.6 — download a .torrent from a URL (e.g. Prowlarr proxy download link).
// Prowlarr sometimes redirects to a magnet: URI when the indexer has no
// .torrent file; node-fetch can't follow magnet redirects, so we handle
// redirects manually and surface the magnet back to the caller.
async function fetchTorrentFile(url) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current, httpAgent.fetchOpts({
      method: 'GET',
      redirect: 'manual',
      timeout: DEFAULT_TIMEOUT_MS,
    }, current));
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || '';
      if (/^magnet:/i.test(loc)) return { magnet: loc };
      if (!loc) throw new Error('redirect with no location from ' + current);
      current = new URL(loc, current).href;
      continue;
    }
    if (!res.ok) throw new Error('torrent download http ' + res.status + ' from ' + current);
    const buffer = await res.buffer();
    if (!buffer || !buffer.length) throw new Error('empty torrent file from ' + current);
    // Filename from Content-Disposition or the URL's `file` param, if any.
    let filename = 'download.torrent';
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
    if (m) filename = decodeURIComponent(m[1].trim());
    if (!/\.torrent$/i.test(filename)) filename += '.torrent';
    return { buffer, filename };
  }
  throw new Error('too many redirects fetching torrent from ' + url);
}

// Add a torrent by magnet URI or .torrent URL.
// 0.2.6 — TorBox's `file` field expects actual .torrent bytes (UploadFile),
// not a URL string (sending a string returns HTTP 422 "Expected UploadFile").
// For non-magnet URLs we download the .torrent ourselves and upload the bytes.
async function addTorrent(opts) {
  const cfg = opts && opts.config;
  const url = String((opts && opts.url) || '');
  if (!url) return { ok: false, error: 'no url provided' };
  if (/^magnet:/i.test(url)) return submit(cfg, '/torrents/createtorrent', { magnet: url });

  let got;
  try {
    got = await fetchTorrentFile(url);
  } catch (err) {
    log.warn('http', 'torbox torrent fetch error: ' + err.message);
    return { ok: false, error: 'torbox: ' + err.message };
  }
  if (got.magnet) return submit(cfg, '/torrents/createtorrent', { magnet: got.magnet });
  return submit(cfg, '/torrents/createtorrent', { file: { buffer: got.buffer, filename: got.filename } });
}

// Add an NZB by URL.
async function addUsenet(opts) {
  const cfg = opts && opts.config;
  const url = String((opts && opts.url) || '');
  if (!url) return { ok: false, error: 'no url provided' };
  return submit(cfg, '/usenet/createusenetdownload', { link: url });
}

// Ping user info as a connection test.
async function testConnection(cfg) {
  if (!cfg || !cfg.apiKey) return { ok: false, error: 'torbox api key not set' };
  const base = trimSlash(cfg.url) || DEFAULT_BASE;
  const url = base + '/user/me?settings=false';
  try {
    const res = await fetch(url, httpAgent.fetchOpts({
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + cfg.apiKey },
      timeout: DEFAULT_TIMEOUT_MS,
    }, url));
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) return { ok: false, error: 'torbox http ' + res.status + ': ' + niceStr(j.error || j.detail || '?') };
    const email = (j.data && j.data.email) || 'unknown';
    const plan  = (j.data && j.data.plan)  || 'unknown';
    return { ok: true, version: 'user=' + email + ' plan=' + plan };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { addTorrent, addUsenet, testConnection };
