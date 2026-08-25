// Experimental TorBox Usenet resolver.
//
// SSS uploads an NZB held in memory only after the user clicks a native
// Newznab stream row. The bytes are never written to disk or served back to
// the client. Cached jobs are resolved to TorBox CDN URLs; uncached jobs are
// queued in the user's own TorBox account and reported as queued.

const crypto = require('crypto');
const fetch = require('node-fetch');
const httpAgent = require('../http-agent');
const { redact } = require('../redact');

const TORBOX_API_BASE = (process.env.TORBOX_API_BASE
  || 'https://api.torbox.app/v1/api').replace(/\/+$/, '');
const VIDEO_EXT_RE = /\.(mkv|mp4|m4v|avi|mov|ts|m2ts|webm|wmv|flv|vob)$/i;
const ID_CACHE = new Map(); // API-key fingerprint + NZB MD5 -> { id, expiresAt }
const ID_TTL_MS = 24 * 60 * 60 * 1000;

function nzbHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function accountCacheKey(apiKey, hash) {
  const account = crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 16);
  return account + ':' + hash;
}

function cacheGet(apiKey, hash) {
  const key = accountCacheKey(apiKey, hash);
  const entry = ID_CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { ID_CACHE.delete(key); return null; }
  return entry.id;
}

function cacheSet(apiKey, hash, id) {
  if (id == null) return;
  if (ID_CACHE.size >= 1000) ID_CACHE.delete(ID_CACHE.keys().next().value);
  ID_CACHE.set(accountCacheKey(apiKey, hash), { id, expiresAt: Date.now() + ID_TTL_MS });
}

function authHeaders(apiKey, extra) {
  return Object.assign({ Accept: 'application/json', Authorization: 'Bearer ' + apiKey }, extra || {});
}

function extractId(value, depth) {
  if (depth > 4 || value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractId(item, depth + 1);
      if (found != null) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const preferred = [
    'usenet_id', 'usenetId', 'usenetdownload_id', 'usenetDownloadId',
    'download_id', 'downloadId', 'id',
  ];
  for (const key of preferred) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const found = extractId(value[key], depth + 1);
      if (found != null) return found;
    }
  }
  if (value.data !== undefined) return extractId(value.data, depth + 1);
  return null;
}

function cachedFromPayload(payload, hash) {
  const data = payload && payload.data !== undefined ? payload.data : payload;
  if (!data) return false;
  if (Array.isArray(data)) {
    return data.some((item) => {
      if (typeof item === 'string') return item.toLowerCase() === hash;
      return String(item && (item.hash || item.md5 || '')).toLowerCase() === hash;
    });
  }
  if (typeof data === 'object') {
    const matchingKey = Object.keys(data).find((key) => key.toLowerCase() === hash);
    if (matchingKey) return data[matchingKey] !== false && data[matchingKey] != null;
    return String(data.hash || data.md5 || '').toLowerCase() === hash;
  }
  return false;
}

function cachedHashesFromPayload(payload, hashes) {
  const wanted = Array.from(new Set((hashes || [])
    .map((hash) => String(hash || '').toLowerCase())
    .filter((hash) => /^[a-f0-9]{32}$/.test(hash))));
  return new Set(wanted.filter((hash) => cachedFromPayload(payload, hash)));
}

async function checkCachedMany(hashes, apiKey, log, options) {
  log = log || (() => {});
  const wanted = Array.from(new Set((hashes || [])
    .map((hash) => String(hash || '').toLowerCase())
    .filter((hash) => /^[a-f0-9]{32}$/.test(hash)))).slice(0, 100);
  if (!wanted.length || !apiKey) return new Set();
  const url = TORBOX_API_BASE + '/usenet/checkcached?format=object&list_files=false';
  try {
    const response = await ((options && options.fetchImpl) || fetch)(url, httpAgent.fetchOpts({
      method: 'POST',
      headers: authHeaders(apiKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ hashes: wanted }),
      timeout: Number((options && options.timeoutMs) || 5000),
    }, url));
    if (!response.ok) {
      log('  torbox-usenet: batch checkcached HTTP ' + response.status);
      return new Set();
    }
    return cachedHashesFromPayload(await response.json(), wanted);
  } catch (err) {
    log('  torbox-usenet: batch checkcached ' + redact(err.message));
    return new Set();
  }
}

async function checkCached(hash, apiKey, log, options) {
  const normalized = String(hash || '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized) || !apiKey) return false;
  return (await checkCachedMany([normalized], apiKey, log, options)).has(normalized);
}

function multipartNzb(buffer, filename, fields) {
  const boundary = '----sss-' + crypto.randomBytes(16).toString('hex');
  const safeName = String(filename || 'serioussportsync.nzb')
    .replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'serioussportsync.nzb';
  const chunks = [];
  for (const [name, rawValue] of Object.entries(fields || {})) {
    if (rawValue === undefined || rawValue === null) continue;
    const safeField = String(name).replace(/[^A-Za-z0-9_-]+/g, '');
    if (!safeField) continue;
    chunks.push(Buffer.from('--' + boundary + '\r\n'
      + 'Content-Disposition: form-data; name="' + safeField + '"\r\n\r\n'
      + String(rawValue) + '\r\n'));
  }
  chunks.push(Buffer.from('--' + boundary + '\r\n'
    + 'Content-Disposition: form-data; name="file"; filename="' + safeName + '"\r\n'
    + 'Content-Type: application/x-nzb\r\n\r\n'));
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([...chunks, buffer, tail]);
  return { boundary, body };
}

async function createDownload(buffer, title, apiKey, log, options) {
  log = log || (() => {});
  if (!Buffer.isBuffer(buffer) || !buffer.length || !apiKey) return null;
  const upload = multipartNzb(buffer, (title || 'serioussportsync') + '.nzb', {
    add_only_if_cached: options && options.cachedOnly ? 'true' : undefined,
  });
  const url = TORBOX_API_BASE + '/usenet/createusenetdownload';
  let response;
  try {
    response = await ((options && options.fetchImpl) || fetch)(url, httpAgent.fetchOpts({
      method: 'POST',
      headers: authHeaders(apiKey, {
        'Content-Type': 'multipart/form-data; boundary=' + upload.boundary,
        'Content-Length': String(upload.body.length),
      }),
      body: upload.body,
      timeout: 20000,
    }, url));
  } catch (err) {
    log('  torbox-usenet: create ' + redact(err.message));
    return null;
  }
  let payload = null;
  try { payload = await response.json(); } catch (_) { /* status is enough */ }
  if (!response.ok && !(payload && payload.data)) {
    const detail = payload && (payload.detail || payload.error || payload.message);
    log('  torbox-usenet: create HTTP ' + response.status + (detail ? ' ' + redact(detail) : ''));
    return null;
  }
  return extractId(payload, 0);
}

function normalizeJob(payload, wantedId) {
  let data = payload && payload.data !== undefined ? payload.data : payload;
  if (Array.isArray(data)) {
    data = data.find((item) => String(item && item.id) === String(wantedId)) || data[0] || null;
  }
  return data && typeof data === 'object' ? data : null;
}

async function getJob(id, apiKey, log, options) {
  log = log || (() => {});
  if (id == null || !apiKey) return null;
  const params = new URLSearchParams({ id: String(id), bypass_cache: 'true' });
  const url = TORBOX_API_BASE + '/usenet/mylist?' + params.toString();
  try {
    const response = await ((options && options.fetchImpl) || fetch)(url, httpAgent.fetchOpts({
      headers: authHeaders(apiKey), timeout: 10000,
    }, url));
    if (!response.ok) { log('  torbox-usenet: mylist HTTP ' + response.status); return null; }
    return normalizeJob(await response.json(), id);
  } catch (err) {
    log('  torbox-usenet: mylist ' + redact(err.message));
    return null;
  }
}

function jobFiles(job) {
  if (!job || typeof job !== 'object') return [];
  if (Array.isArray(job.files)) return job.files;
  if (job.download && Array.isArray(job.download.files)) return job.download.files;
  return [];
}

function pickPlayableFileId(files) {
  const candidates = (Array.isArray(files) ? files : []).map((file) => ({
    id: file && (file.id != null ? file.id : file.file_id),
    name: String(file && (file.name || file.short_name || file.filename) || ''),
    size: Number(file && (file.size || file.bytes) || 0) || 0,
    mimetype: String(file && (file.mimetype || file.mime_type) || ''),
  })).filter((file) => file.id != null);
  const byExt = candidates.filter((file) => VIDEO_EXT_RE.test(file.name));
  const byMime = candidates.filter((file) => /^video\//i.test(file.mimetype));
  const pool = byExt.length ? byExt : (byMime.length ? byMime : candidates);
  pool.sort((a, b) => b.size - a.size);
  return pool[0] ? pool[0].id : null;
}

async function requestDl(usenetId, fileId, apiKey, log, options) {
  log = log || (() => {});
  if (usenetId == null || fileId == null || !apiKey) return null;
  const params = new URLSearchParams({
    token: apiKey,
    usenet_id: String(usenetId),
    file_id: String(fileId),
    zip_link: 'false',
  });
  const url = TORBOX_API_BASE + '/usenet/requestdl?' + params.toString();
  try {
    const response = await ((options && options.fetchImpl) || fetch)(url, httpAgent.fetchOpts({
      headers: authHeaders(apiKey), timeout: 12000,
    }, url));
    if (!response.ok) { log('  torbox-usenet: requestdl HTTP ' + response.status); return null; }
    const payload = await response.json();
    if (payload && typeof payload.data === 'string') return payload.data;
    if (payload && payload.data && typeof payload.data.url === 'string') return payload.data.url;
    if (payload && typeof payload.url === 'string') return payload.url;
    return null;
  } catch (err) {
    log('  torbox-usenet: requestdl ' + redact(err.message));
    return null;
  }
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function findPlayable(id, apiKey, log, options) {
  const opts = options || {};
  const attempts = Math.max(1, Math.min(6, Number(opts.pollAttempts || 3)));
  const intervalMs = Math.max(0, Number(opts.pollIntervalMs || 1200));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const job = await getJob(id, apiKey, log, opts);
    const fileId = pickPlayableFileId(jobFiles(job));
    if (fileId != null) {
      const url = await requestDl(id, fileId, apiKey, log, opts);
      if (url) return url;
    }
    if (attempt + 1 < attempts && intervalMs) await delay(intervalMs);
  }
  return null;
}

async function resolveNzb(buffer, title, apiKey, log, options) {
  log = log || (() => {});
  if (!Buffer.isBuffer(buffer) || !buffer.length) return { ok: false, error: 'empty-nzb' };
  if (!apiKey) return { ok: false, error: 'no-torbox-key' };
  const opts = options || {};
  const hash = nzbHash(buffer);
  const cached = typeof opts.knownCached === 'boolean'
    ? opts.knownCached : await checkCached(hash, apiKey, log, opts);
  let id = cacheGet(apiKey, hash);
  if (id == null) {
    id = await createDownload(buffer, title, apiKey, log,
      Object.assign({}, opts, { cachedOnly: cached }));
    if (id != null) cacheSet(apiKey, hash, id);
  }
  if (id == null) return { ok: false, error: cached ? 'cached-create-failed' : 'create-failed' };
  const url = await findPlayable(id, apiKey, log, Object.assign({}, opts, {
    pollAttempts: cached ? 4 : 1,
  }));
  if (url) return { ok: true, url, cached: true, id, hash };
  return { ok: true, queued: true, cached, id, hash };
}

module.exports = {
  TORBOX_API_BASE,
  nzbHash,
  cachedFromPayload,
  cachedHashesFromPayload,
  multipartNzb,
  extractId,
  checkCached,
  checkCachedMany,
  createDownload,
  normalizeJob,
  getJob,
  pickPlayableFileId,
  requestDl,
  findPlayable,
  resolveNzb,
  _test: { ID_CACHE, jobFiles, accountCacheKey },
};
