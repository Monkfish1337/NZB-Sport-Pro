// 0.33.0 — TorBox resolver for the metadata addon.
//
// Per-user TorBox API integration. Two responsibilities:
//   1. checkCachedBatch(hashes, apiKey) -> Set of cached hash strings.
//   2. resolveCached(hash, magnet, apiKey, log) -> playable CDN URL.
//
// Returns ONLY playable URLs — uncached hashes are silently dropped by
// the caller. This is by design: no infoHash rows ever leave /stream,
// so the client can't fall through to peer-to-peer.
//
// In-process torrent_id cache (24h TTL) so a hash a user has clicked
// recently doesn't re-create the TorBox torrent on every /stream.
//
// API endpoints (TorBox v1). Auth is inconsistent across endpoints — most
// accept Authorization: Bearer <key>, but /requestdl still requires the
// legacy ?token=<key> query parameter (Bearer alone → 422 "field required").
// We pass Bearer everywhere, plus ?token= on /requestdl specifically.
//   GET  /api/torrents/checkcached?hash=<csv>&format=object         (Bearer)
//   POST /api/torrents/createtorrent           (body: magnet)        (Bearer)
//   GET  /api/torrents/mylist?id=<id>&bypass_cache=true              (Bearer)
//   GET  /api/torrents/requestdl?token=<key>&torrent_id=<id>&file_id=<fid>
//                                              &zip_link=false       (Bearer + ?token=)

const fetch = require('node-fetch');
const httpAgent = require('../http-agent');

const TORBOX_API_BASE = process.env.TORBOX_API_BASE || 'https://api.torbox.app/v1/api';

// torrent_id cache: hash -> { id, expiresAt }
const TORRENT_ID_CACHE = new Map();
const TORRENT_ID_TTL_MS = 24 * 60 * 60 * 1000;
const TORRENT_ID_CACHE_MAX = 1000;

function cacheGetId(hash) {
  const entry = TORRENT_ID_CACHE.get(hash);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) { TORRENT_ID_CACHE.delete(hash); return null; }
  return entry.id;
}
function cacheSetId(hash, id) {
  if (TORRENT_ID_CACHE.size >= TORRENT_ID_CACHE_MAX) {
    const firstKey = TORRENT_ID_CACHE.keys().next().value;
    if (firstKey) TORRENT_ID_CACHE.delete(firstKey);
  }
  TORRENT_ID_CACHE.set(hash, { id, expiresAt: Date.now() + TORRENT_ID_TTL_MS });
}

// Build a basic magnet URL from a hash + optional tracker list.
function buildMagnet(hash, trackers) {
  let m = 'magnet:?xt=urn:btih:' + hash;
  for (const t of (trackers || [])) {
    if (!t || typeof t !== 'string') continue;
    m += '&tr=' + encodeURIComponent(t);
  }
  return m;
}

// Batch cache check. Returns a Set of cached hash strings (lower-case hex).
// Defensive against TorBox's various response shapes — sometimes returns
// {data: {hash: {...}}}, sometimes {data: [{hash, ...}]}, etc.
async function checkCachedBatch(hashes, apiKey, log) {
  log = log || (() => {});
  if (!Array.isArray(hashes) || hashes.length === 0) return new Set();
  if (!apiKey) { log('  torbox: no apiKey — cache check skipped'); return new Set(); }
  const out = new Set();
  // TorBox accepts repeated hash params (up to ~50 per request safely).
  const CHUNK = 50;
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const chunk = hashes.slice(i, i + CHUNK);
    const params = new URLSearchParams({ format: 'object' });
    for (const h of chunk) params.append('hash', h);
    const url = TORBOX_API_BASE + '/torrents/checkcached?' + params.toString();
    let res;
    try {
      res = await fetch(url, httpAgent.fetchOpts({
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        timeout: 10000,
      }, url));
    } catch (err) {
      log('  torbox: checkcached network error: ' + err.message);
      continue;
    }
    if (!res.ok) {
      log('  torbox: checkcached HTTP ' + res.status);
      continue;
    }
    let body;
    try { body = await res.json(); }
    catch (err) { log('  torbox: checkcached bad JSON: ' + err.message); continue; }
    const data = body && body.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const key of Object.keys(data)) {
        const k = key.toLowerCase();
        if (/^[a-f0-9]{40}$/.test(k)) out.add(k);
      }
    } else if (Array.isArray(data)) {
      for (const item of data) {
        const k = (item && (item.hash || item.infoHash || '')).toLowerCase();
        if (/^[a-f0-9]{40}$/.test(k)) out.add(k);
      }
    }
  }
  return out;
}

// Submit a magnet to TorBox. Returns the torrent_id (or null on failure).
// Treats "already exists" as success and returns the existing id.
async function createTorrent(magnet, apiKey, log) {
  log = log || (() => {});
  if (!magnet || !apiKey) return null;
  const url = TORBOX_API_BASE + '/torrents/createtorrent';
  const body = new URLSearchParams({ magnet, seed: '3', allow_zip: 'false' });
  let res;
  try {
    res = await fetch(url, httpAgent.fetchOpts({
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
      timeout: 15000,
    }, url));
  } catch (err) {
    log('  torbox: createtorrent network error: ' + err.message);
    return null;
  }
  let payload = null;
  try { payload = await res.json(); } catch (_) { /* tolerate */ }
  if (!res.ok && !(payload && payload.data)) {
    log('  torbox: createtorrent HTTP ' + res.status);
    return null;
  }
  const data = payload && payload.data;
  if (data && (data.torrent_id || data.id)) return Number(data.torrent_id || data.id);
  return null;
}

// Request the playable download URL for a torrent + file.
//
// IMPORTANT auth note: /requestdl is the one TorBox endpoint that still
// authenticates via the legacy ?token=<key> query parameter — Bearer header
// alone returns 422 "field required: query.token". Other endpoints (mylist,
// checkcached, createtorrent) accept Bearer. We pass both here so we're
// covered if/when TorBox harmonizes auth across endpoints.
async function requestDl(torrentId, fileId, apiKey, log) {
  log = log || (() => {});
  if (!torrentId || !apiKey) return null;
  const params = new URLSearchParams({
    token: apiKey,
    torrent_id: String(torrentId),
    zip_link: 'false',
  });
  if (fileId != null) params.set('file_id', String(fileId));
  const url = TORBOX_API_BASE + '/torrents/requestdl?' + params.toString();
  let res;
  try {
    res = await fetch(url, httpAgent.fetchOpts({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      timeout: 12000,
    }, url));
  } catch (err) {
    log('  torbox: requestdl network error: ' + err.message);
    return null;
  }
  if (!res.ok) {
    // Try to surface TorBox's error body for diagnosis — it usually carries
    // a `detail` or `error` string that's invaluable when debugging 4xx.
    let detail = '';
    try { const j = await res.json(); detail = ' ' + JSON.stringify(j).slice(0, 200); }
    catch (_) { /* tolerate */ }
    log('  torbox: requestdl HTTP ' + res.status + detail);
    return null;
  }
  let body;
  try { body = await res.json(); }
  catch (err) { log('  torbox: requestdl bad JSON: ' + err.message); return null; }
  if (body && typeof body.data === 'string') return body.data;
  if (body && body.data && typeof body.data.url === 'string') return body.data.url;
  return null;
}

// List files inside a (cached) TorBox torrent. We need this to pass a
// concrete `file_id` to /requestdl — TorBox no longer auto-picks the largest
// file when file_id is omitted, it just returns 422 "Invalid params".
//
// Endpoint: GET /api/torrents/mylist?id=<torrent_id>&bypass_cache=true
// Response data: { id, files: [{ id, name, size, mimetype, ... }, ...], ... }
async function getTorrentFiles(torrentId, apiKey, log) {
  log = log || (() => {});
  if (!torrentId || !apiKey) return [];
  const params = new URLSearchParams({
    id: String(torrentId),
    bypass_cache: 'true',
  });
  const url = TORBOX_API_BASE + '/torrents/mylist?' + params.toString();
  let res;
  try {
    res = await fetch(url, httpAgent.fetchOpts({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      timeout: 10000,
    }, url));
  } catch (err) {
    log('  torbox: mylist network error: ' + err.message);
    return [];
  }
  if (!res.ok) {
    log('  torbox: mylist HTTP ' + res.status);
    return [];
  }
  let body;
  try { body = await res.json(); }
  catch (err) { log('  torbox: mylist bad JSON: ' + err.message); return []; }
  const data = body && body.data;
  if (Array.isArray(data && data.files)) return data.files;
  // Some payload shapes wrap the torrent in an array.
  if (Array.isArray(data) && data[0] && Array.isArray(data[0].files)) return data[0].files;
  return [];
}

// Pick the largest video file from a TorBox file list. Returns the file_id
// (or null if no video file is found).
const VIDEO_EXT_RE = /\.(mkv|mp4|m4v|avi|mov|ts|m2ts|webm|wmv|flv|vob)$/i;
function pickPlayableFileId(files) {
  if (!Array.isArray(files) || files.length === 0) return null;
  const candidates = files
    .map((f) => ({
      id: f.id != null ? f.id : f.file_id,
      name: String(f.name || f.short_name || ''),
      size: Number(f.size || 0) || 0,
      mimetype: String(f.mimetype || ''),
    }))
    .filter((f) => f.id != null);
  // Prefer video by extension; fall back to mimetype video/*; fall back to largest overall.
  const byExt = candidates.filter((f) => VIDEO_EXT_RE.test(f.name));
  const byMime = candidates.filter((f) => /^video\//.test(f.mimetype));
  const pool = byExt.length ? byExt : (byMime.length ? byMime : candidates);
  pool.sort((a, b) => b.size - a.size);
  return pool[0] ? pool[0].id : null;
}

// Resolve a single cached hash into a playable URL. Uses the torrent_id
// cache to skip the createtorrent step on repeat plays of the same hash.
async function resolveCached(hash, magnet, apiKey, log) {
  if (!hash || !apiKey) return null;
  let id = cacheGetId(hash);
  if (id == null) {
    id = await createTorrent(magnet, apiKey, log);
    if (id != null) cacheSetId(hash, id);
  }
  if (id == null) return null;
  // TorBox now requires a concrete file_id — query the file list and pick the
  // largest playable video file.
  const files = await getTorrentFiles(id, apiKey, log);
  const fileId = pickPlayableFileId(files);
  if (fileId == null) {
    log('  torbox: no playable file in torrent ' + id + ' (files=' + files.length + ')');
    return null;
  }
  return requestDl(id, fileId, apiKey, log);
}

module.exports = {
  buildMagnet,
  checkCachedBatch,
  createTorrent,
  getTorrentFiles,
  pickPlayableFileId,
  requestDl,
  resolveCached,
};
