// Read-only TorBox Voyager Search API client.
//
// This module deliberately does not create torrents or Usenet downloads. Its
// first job is to prove the current Search API/BYOI contract without changing
// the stable companion-based stream pipeline or mutating a user's account.

const fetch = require('node-fetch');
const httpAgent = require('../http-agent');

const SEARCH_BASE = (process.env.TORBOX_SEARCH_API_BASE
  || 'https://search-api.torbox.app').replace(/\/+$/, '');
const VALID_KINDS = new Set(['torrents', 'usenet']);

function boolParam(value) { return value === false ? 'false' : 'true'; }

function buildSearchUrl(kind, query, options) {
  if (!VALID_KINDS.has(kind)) throw new Error('kind must be torrents or usenet');
  const q = String(query || '').trim();
  if (!q) throw new Error('query is required');
  const opts = options || {};
  const params = new URLSearchParams({
    query: q,
    check_cache: boolParam(opts.checkCache),
    check_owned: boolParam(opts.checkOwned),
    search_user_engines: boolParam(opts.searchUserEngines),
    cached_only: opts.cachedOnly === true ? 'true' : 'false',
  });
  return SEARCH_BASE + '/' + kind + '/search?' + params.toString();
}

function firstArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  if (payload.data && Array.isArray(payload.data.results)) return payload.data.results;
  if (payload.data && Array.isArray(payload.data.items)) return payload.data.items;
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      if (Array.isArray(value.results)) return value.results;
      if (Array.isArray(value.items)) return value.items;
    }
  }
  return [];
}

function firstValue(item, keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null && item[key] !== '') {
      return item[key];
    }
  }
  return null;
}

function booleanValue(item, keys) {
  const value = firstValue(item, keys);
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  return null;
}

function safeHost(value) {
  if (!value || typeof value !== 'string') return '';
  try { return new URL(value).hostname; } catch (_) { return ''; }
}

function safeText(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/([?&](?:api[_-]?key|token|key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .slice(0, maxLength || 300);
}

function safeId(value) {
  if (value == null) return null;
  const text = String(value);
  try {
    const url = new URL(text);
    return url.origin + url.pathname;
  } catch (_) {
    return safeText(text, 160);
  }
}

function normalizeResult(item, kind) {
  const link = firstValue(item, [
    'nzb_url', 'nzbUrl', 'download_url', 'downloadUrl', 'magnet', 'magnet_url',
    'magnetUrl', 'link', 'url',
  ]);
  const hash = firstValue(item, [
    'hash', 'info_hash', 'infoHash', 'torrent_hash', 'torrentHash', 'md5',
  ]);
  return {
    kind,
    id: safeId(firstValue(item, ['id', 'search_id', 'searchId', 'guid'])),
    title: String(firstValue(item, ['title', 'name', 'raw_title', 'rawTitle']) || ''),
    hash: hash == null ? '' : String(hash),
    size: Number(firstValue(item, ['size', 'bytes', 'length']) || 0) || 0,
    seeders: Number(firstValue(item, ['seeders', 'seeds']) || 0) || 0,
    cached: booleanValue(item, ['cached', 'is_cached', 'isCached']),
    owned: booleanValue(item, ['owned', 'is_owned', 'isOwned']),
    source: safeText(firstValue(item, [
      'indexer', 'source', 'provider', 'tracker', 'search_engine', 'searchEngine',
    ]) || '', 160),
    hasDownloadLink: typeof link === 'string' && link.length > 0,
    downloadHost: safeHost(link),
    keys: Object.keys(item || {}).sort(),
  };
}

function normalizePayload(payload, kind) {
  return firstArray(payload).map((item) => normalizeResult(item, kind));
}

function diagnosticSummary(payload, results) {
  const topKeys = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.keys(payload).sort() : [];
  const sourceCounts = {};
  for (const result of results) {
    const source = result.source || 'unlabelled';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }
  return {
    resultCount: results.length,
    cached: results.filter((r) => r.cached === true).length,
    owned: results.filter((r) => r.owned === true).length,
    withHash: results.filter((r) => !!r.hash).length,
    withDownloadLink: results.filter((r) => r.hasDownloadLink).length,
    sources: sourceCounts,
    responseKeys: topKeys,
    resultKeys: results[0] ? results[0].keys : [],
  };
}

async function search(kind, query, apiKey, options) {
  if (!apiKey) throw new Error('TorBox API key is required');
  const opts = options || {};
  const url = buildSearchUrl(kind, query, opts);
  const started = Date.now();
  let response;
  try {
    response = await (opts.fetchImpl || fetch)(url, httpAgent.fetchOpts({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      timeout: Number(opts.timeoutMs || 30000),
    }, url));
  } catch (err) {
    return {
      ok: false,
      kind,
      query,
      status: 0,
      elapsedMs: Date.now() - started,
      error: 'network-error',
      detail: err.message,
      summary: diagnosticSummary(null, []),
      results: [],
    };
  }

  let payload = null;
  try { payload = await response.json(); }
  catch (_) { /* status and a safe generic error are still useful */ }
  const results = normalizePayload(payload, kind);
  const detailValue = payload && (payload.detail || payload.error || payload.message);
  return {
    ok: response.ok,
    kind,
    query,
    status: response.status,
    elapsedMs: Date.now() - started,
    error: response.ok ? null : 'http-' + response.status,
    detail: safeText(detailValue, 300),
    summary: diagnosticSummary(payload, results),
    results: results.slice(0, Number(opts.resultLimit || 10)),
  };
}

async function probe(query, apiKey, options) {
  const opts = Object.assign({
    checkCache: true,
    checkOwned: true,
    searchUserEngines: true,
    cachedOnly: false,
  }, options || {});
  const settled = await Promise.all([
    search('torrents', query, apiKey, opts),
    search('usenet', query, apiKey, opts),
  ]);
  return {
    readOnly: true,
    query: String(query || '').trim(),
    searchedUserEngines: opts.searchUserEngines !== false,
    searches: settled,
  };
}

module.exports = {
  SEARCH_BASE,
  buildSearchUrl,
  normalizePayload,
  diagnosticSummary,
  safeText,
  search,
  probe,
};
