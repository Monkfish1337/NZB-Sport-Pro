// Prowlarr source — fans queries out across whatever indexers the operator
// has added in Prowlarr. Returns torrent candidates. Many indexers return
// infoHash=null and the hash is only reachable by following Prowlarr's
// /download proxy redirect, so we hydrate those in a bounded-concurrency
// second pass.
//
// Lifted from the metadata addon's lib/sources/prowlarr.js and adapted
// to the scraper's registry contract.

const fetch = require('node-fetch');
const httpAgent = require('../http-agent');
const config = require('../../config');   // 0.2.3 — honor SOURCE_TIMEOUT_MS

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Base32 (RFC 4648) -> bytes. Some trackers encode btih as 32 chars b32.
function base32ToBytes(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = s.toUpperCase().replace(/=+$/, '');
  const out = [];
  let buf = 0, bits = 0;
  for (const ch of s) {
    const v = alphabet.indexOf(ch);
    if (v < 0) return null;
    buf = (buf << 5) | v; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
  }
  return out;
}

function extractInfoHash(result) {
  if (result.infoHash && /^[a-f0-9]{40}$/i.test(result.infoHash)) {
    return result.infoHash.toLowerCase();
  }
  const candidates = [result.magnetUrl, result.downloadUrl, result.guid, result.infoUrl];
  for (const c of candidates) {
    if (!c || typeof c !== 'string') continue;
    const m = c.match(/urn:btih:([A-Fa-f0-9]{40}|[A-Z2-7]{32})/i);
    if (m) {
      const h = m[1];
      if (/^[a-f0-9]{40}$/i.test(h)) return h.toLowerCase();
      try {
        const bin = base32ToBytes(h);
        if (bin && bin.length === 20) {
          return Array.from(bin).map((b) => b.toString(16).padStart(2, '0')).join('');
        }
      } catch (_) { /* fall through */ }
    }
    const m2 = c.match(/\b([A-Fa-f0-9]{40})\b/);
    if (m2) return m2[1].toLowerCase();
  }
  return '';
}

function extractMagnetTrackers(magnetUrl) {
  if (!magnetUrl) return [];
  const out = [];
  const re = /[?&]tr=([^&]+)/g;
  let m;
  while ((m = re.exec(magnetUrl))) {
    try { out.push(decodeURIComponent(m[1])); } catch (_) { out.push(m[1]); }
  }
  return out;
}

async function singleSearch(query, sourceConfig, log) {
  if (!sourceConfig.url) return [];
  const limit = sourceConfig.limit || 100;
  const params = new URLSearchParams({ query, type: 'search', limit: String(limit) });
  const cats = (sourceConfig.categories || '2000,5000,8000').split(',').map((s) => s.trim()).filter(Boolean);
  for (const c of cats) params.append('categories', c);

  const url = sourceConfig.url.replace(/\/$/, '') + '/api/v1/search?' + params.toString();
  let res;
  try {
    res = await fetch(url, httpAgent.fetchOpts({
      headers: { 'X-Api-Key': sourceConfig.apiKey || '', Accept: 'application/json' },
      timeout: sourceConfig.timeoutMs || config.defaultSourceTimeoutMs || 15000,
    }, url));
  } catch (err) { log.error('source', 'prowlarr network error: ' + err.message); return []; }
  if (!res.ok) { log.warn('source', 'prowlarr HTTP ' + res.status); return []; }
  let body;
  try { body = await res.json(); }
  catch (err) { log.warn('source', 'prowlarr bad JSON: ' + err.message); return []; }
  return Array.isArray(body) ? body : [];
}

async function hydrateHashViaDownloadProxy(result, log) {
  if (!result.downloadUrl) return null;
  let res;
  try {
    res = await fetch(result.downloadUrl, httpAgent.fetchOpts({
      redirect: 'manual', timeout: 10000, method: 'GET',
    }, result.downloadUrl));
  } catch (err) {
    log.debug('source', 'hydrate fail (' + (result.indexer || '?') + '): ' + err.message);
    return { error: true };
  }
  const loc = res.headers.get('location') || '';
  if (loc.startsWith('magnet:')) {
    const m = loc.match(/urn:btih:([A-Fa-f0-9]{40})/i);
    if (m) return { hash: m[1].toLowerCase(), magnetUrl: loc };
  }
  return null;
}

async function hydrateAll(results, log) {
  const HYDRATE_MAX = 50;
  const needs = results
    .filter((r) => !r._hash && r.downloadUrl && (r.seeders || 0) > 0)
    .sort((a, b) => (b.seeders || 0) - (a.seeders || 0))
    .slice(0, HYDRATE_MAX);
  if (needs.length === 0) return 0;
  log.info('source', 'hydrating up to ' + needs.length + ' by seeders');
  const failedIndexers = new Set();
  let i = 0, hydrated = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= needs.length) return;
      const r = needs[idx];
      if (r.indexer && failedIndexers.has(r.indexer)) continue;
      const got = await hydrateHashViaDownloadProxy(r, log);
      if (got && got.hash) { r._hash = got.hash; r._magnet = got.magnetUrl; hydrated++; }
      else if (got && got.error && r.indexer) failedIndexers.add(r.indexer);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  return hydrated;
}

async function multiSearch(queries, sourceConfig, log) {
  const seen = new Set();
  const collected = [];
  for (const q of queries) {
    log.info('source', 'prowlarr query "' + q + '"');
    const results = await singleSearch(q, sourceConfig, log);
    log.info('source', '  -> ' + results.length + ' raw');
    for (const r of results) {
      r._hash = extractInfoHash(r);
      collected.push(r);
    }
    if (queries.length > 1) await delay(150);
  }
  const hydrated = await hydrateAll(collected, log);
  if (hydrated > 0) log.info('source', 'hydrated ' + hydrated + ' result(s) via download proxy');
  const out = [];
  for (const r of collected) {
    const hash = r._hash;
    if (!hash) continue;
    if (seen.has(hash)) continue;
    seen.add(hash);
    const magnet = r.magnetUrl || r._magnet || null;
    out.push({
      infoHash: hash,
      title: r.title || '',
      size: r.size || 0,
      seeders: r.seeders || 0,
      indexer: r.indexer || 'Prowlarr',
      magnetTrackers: extractMagnetTrackers(magnet),
      publishDate: r.publishDate || null,
    });
  }
  return out;
}

async function test(sourceConfig, log) {
  if (!sourceConfig.url) return { ok: false, message: 'URL not configured' };
  const start = Date.now();
  try {
    const url = sourceConfig.url.replace(/\/$/, '') + '/api/v1/health';
    const res = await fetch(url, httpAgent.fetchOpts({
      headers: { 'X-Api-Key': sourceConfig.apiKey || '', Accept: 'application/json' },
      timeout: 8000,
    }, url));
    const latencyMs = Date.now() - start;
    if (!res.ok) return { ok: false, latencyMs, message: 'HTTP ' + res.status };
    return { ok: true, latencyMs, message: 'Prowlarr health OK' };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, message: err.message };
  }
}

module.exports = {
  type: 'prowlarr',
  label: 'Prowlarr',
  description: 'Federates whatever indexers the operator has added in Prowlarr.',
  schema: [
    { name: 'url',        label: 'Prowlarr URL', type: 'url',    required: true, placeholder: 'http://prowlarr:9696' },
    { name: 'apiKey',     label: 'API key',      type: 'secret', required: true, hint: 'Prowlarr → Settings → General → API Key' },
    { name: 'categories', label: 'Categories',   type: 'csv',    default: '2000,5000,8000', hint: 'Comma-separated Newznab category IDs' },
    { name: 'limit',      label: 'Limit per query', type: 'number', default: 100 },
      { name: 'timeoutMs', label: 'Timeout (ms)', type: 'number', default: 15000, hint: 'Bump higher if Prowlarr aggregates many indexers' },
  ],
  // 0.2.4 — both names exported. `search` is the generic scraper-registry
  // contract; `multiSearch` is what lib/search.js calls directly by name.
  search: multiSearch,
  multiSearch,
  test,
};
