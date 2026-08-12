// Knaben source — direct POST to api.knaben.org/v1.
//
// Knaben aggregates a long tail of public trackers (1337x, RARBG-clones,
// niche IPTV groups, etc.) and is the go-to when Prowlarr's federated
// search misses a release. In particular, IPTV/sports stitched releases
// often live under Knaben categories that don't map cleanly to Newznab
// 5000-series, so Prowlarr's category-filtered query drops them — direct
// Knaben recovers them.
//
// Critical API param: `search_type` MUST be "100%" for actual title
// matching. "score" silently returns DB-order top-seeded items when the
// query doesn't strictly match — for "UFC Fight Night 278" you get back
// uTorrent Pro cracks. Verified against the live API.
//
// Response shape (relevant fields):
//   {
//     hits: [{
//       hash: '40-hex',
//       title: '...',
//       bytes: number,
//       seeders: number,
//       peers: number,
//       date: ISO,
//       tracker: 'name',           // inner indexer attribution
//       categoryId: [..., ...],
//       magnetUrl: 'magnet:?...',
//     }, ...],
//     total: { value: N, relation: 'eq'|'gte' },
//   }

const fetch = require('node-fetch');
const httpAgent = require('../http-agent');

const KNABEN_URL = 'https://api.knaben.org/v1';

function normHash(h) {
  if (!h || typeof h !== 'string') return '';
  return /^[A-Fa-f0-9]{40}$/.test(h) ? h.toLowerCase() : '';
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
  const body = JSON.stringify({
    query,
    search_type: '100%',                 // ← critical, see header comment
    search_field: 'title',
    order_by: 'seeders',
    order_direction: 'desc',
    from: 0,
    size: Number(sourceConfig.limit) || 100,
    hide_unsafe: false,
    hide_xxx: true,
  });
  let res;
  try {
    res = await fetch(KNABEN_URL, httpAgent.fetchOpts({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      timeout: sourceConfig.timeoutMs || 10000,
    }, KNABEN_URL));
  } catch (err) {
    log.error('source', 'knaben network error: ' + err.message);
    return [];
  }
  if (!res.ok) {
    log.warn('source', 'knaben HTTP ' + res.status);
    return [];
  }
  let payload;
  try { payload = await res.json(); }
  catch (err) { log.warn('source', 'knaben bad JSON: ' + err.message); return []; }
  const hits = Array.isArray(payload && payload.hits) ? payload.hits : [];
  const out = [];
  for (const h of hits) {
    const hash = normHash(h.hash);
    if (!hash) continue;
    out.push({
      infoHash: hash,
      title: h.title || '',
      size: Number(h.bytes || 0) || 0,
      seeders: Number(h.seeders || 0) || 0,
      // Attribute the inner indexer Knaben sourced from — useful for
      // debugging "why did Knaben surface this but Prowlarr didn't".
      indexer: 'Knaben:' + (h.tracker || 'unknown'),
      magnetTrackers: extractMagnetTrackers(h.magnetUrl),
      publishDate: h.date || null,
    });
  }
  return out;
}

async function multiSearch(queries, sourceConfig, log) {
  const seen = new Set();
  const out = [];
  for (const q of queries) {
    log.info('source', 'knaben query "' + q + '"');
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
    // "UFC 291" is a known-good probe — it's a real PPV with many indexed
    // releases, so a healthy Knaben returns dozens of hits and confirms
    // 100%-mode matching is working (vs. score-mode returning movies).
    const results = await singleSearch('UFC 291', sourceConfig, log);
    return {
      ok: true,
      latencyMs: Date.now() - start,
      message: 'Knaben responding, ' + results.length + ' hit(s) for "UFC 291"',
    };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, message: err.message };
  }
}

module.exports = {
  type: 'knaben',
  label: 'Knaben',
  description: 'Direct POST to api.knaben.org/v1. Covers releases Prowlarr\'s '
    + 'federated search misses (IPTV stitched releases, 0-seeder hits, '
    + 'niche tracker categorisations).',
  schema: [
    { name: 'limit',     label: 'Hits per query', type: 'number', default: 100,
      hint: 'Max results returned per search title.' },
    { name: 'timeoutMs', label: 'Timeout (ms)',   type: 'number', default: 10000 },
  ],
  multiSearch,
  test,
};
