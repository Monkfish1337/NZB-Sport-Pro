// bitsearch.eu source — direct GET to the public JSON search API.
//
// Long-tail tracker aggregator with strong overlap with TheRARBG/Knaben but
// occasionally surfaces verified releases (the `verified` flag) the others
// miss. Useful as a triangulation source.
//
// Endpoint:
//   GET https://bitsearch.eu/api/v1/search?q=<query>
//   (bitsearch.to redirects to bitsearch.eu — follow redirects)
//
// Response shape (fields actually used):
//   {
//     success: true,
//     query: '...',
//     results: [{
//       id:           '...',
//       infohash:     '40-HEX-HASH',
//       title:        '...',
//       size:         bytes,
//       category:     numeric (1=Movies, 2=TV, 3=Music, ...),
//       subCategory:  numeric,
//       seeders:      N,
//       leechers:     N,
//       downloads:    N,
//       verified:     bool,
//       createdAt:    ISO,
//       updatedAt:    ISO,
//     }],
//   }

const fetch = require('node-fetch');
const httpAgent = require('../http-agent');

const BITSEARCH_URL = 'https://bitsearch.eu';

function normHash(h) {
  if (!h || typeof h !== 'string') return '';
  return /^[A-Fa-f0-9]{40}$/.test(h) ? h.toLowerCase() : '';
}

async function singleSearch(query, sourceConfig, log) {
  const params = new URLSearchParams({ q: query });
  const url = (sourceConfig.url || BITSEARCH_URL).replace(/\/+$/, '')
    + '/api/v1/search?' + params.toString();
  let res;
  try {
    res = await fetch(url, httpAgent.fetchOpts({
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: sourceConfig.timeoutMs || 10000,
      // bitsearch.to redirects to bitsearch.eu and node-fetch follows by default.
    }, url));
  } catch (err) {
    log.error('source', 'bitsearch network error: ' + err.message);
    return [];
  }
  if (!res.ok) {
    log.warn('source', 'bitsearch HTTP ' + res.status);
    return [];
  }
  let payload;
  try { payload = await res.json(); }
  catch (err) { log.warn('source', 'bitsearch bad JSON: ' + err.message); return []; }
  const hits = Array.isArray(payload && payload.results) ? payload.results : [];
  const out = [];
  const limit = Number(sourceConfig.limit) || 100;
  for (const h of hits.slice(0, limit)) {
    const hash = normHash(h.infohash);
    if (!hash) continue;
    out.push({
      infoHash: hash,
      title: h.title || '',
      size: Number(h.size || 0) || 0,
      seeders: Number(h.seeders || 0) || 0,
      // We surface the `verified` flag as part of indexer attribution so
      // it shows up in logs without expanding the candidate contract.
      indexer: 'bitsearch' + (h.verified ? ':verified' : ''),
      magnetTrackers: [],
      publishDate: h.createdAt || null,
    });
  }
  return out;
}

async function multiSearch(queries, sourceConfig, log) {
  const seen = new Set();
  const out = [];
  for (const q of queries) {
    log.info('source', 'bitsearch query "' + q + '"');
    const results = await singleSearch(q, sourceConfig, log);
    log.info('source', '  -> ' + results.length + ' hits');
    for (const r of results) {
      if (seen.has(r.infoHash)) continue;
      seen.add(r.infoHash);
      out.push(r);
    }
  }
  return out;
}

async function test(sourceConfig, log) {
  const start = Date.now();
  try {
    const results = await singleSearch('UFC 325', sourceConfig, log);
    return {
      ok: true,
      latencyMs: Date.now() - start,
      message: 'bitsearch responding, ' + results.length + ' hit(s) for "UFC 325"',
    };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, message: err.message };
  }
}

module.exports = {
  type: 'bitsearch',
  label: 'bitsearch.eu',
  description: 'Direct GET to bitsearch.eu /api/v1/search JSON endpoint. '
    + 'Long-tail aggregator that surfaces verified releases other sources miss.',
  schema: [
    { name: 'url',       label: 'Base URL',     type: 'url',    default: 'https://bitsearch.eu',
      hint: 'bitsearch.to also works; it redirects to .eu.' },
    { name: 'limit',     label: 'Hits per query', type: 'number', default: 100 },
    { name: 'timeoutMs', label: 'Timeout (ms)',  type: 'number', default: 10000 },
  ],
  multiSearch,
  test,
};
