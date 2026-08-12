// TheRARBG source — direct GET to therarbg.to/get-posts.
//
// Mirror that emerged after RARBG closed, with strong UFC/MMA coverage and a
// public JSON endpoint that doesn't need an API key. Catches releases that
// Prowlarr's federated search drops due to category-mapping mismatches.
//
// Endpoint:
//   GET https://therarbg.to/get-posts/keywords:<URL-encoded query>:format:json
//
// Quirks to know:
//   - Query matching is literal-token. "UFC Fight Night 278" works.
//     "UFC.291" and "UFC 291 PPV" return 0 hits. Operator should rely on
//     the metadata addon's full-name search titles, not abbreviated forms.
//   - Older content (>1y) is aggressively pruned. "UFC 291" returns 0
//     because the site no longer indexes it; "UFC 325" works fine.
//   - The site has no Cloudflare wall on this endpoint — direct works.
//
// Response shape (fields actually used):
//   {
//     count: N, total: N,
//     results: [{
//       n:  title,
//       h:  '40-HEX-HASH',
//       s:  size in bytes,
//       se: seeders,
//       le: leechers,
//       c:  category (e.g. "TV", "Movies", "Music"),
//       tg: tags array (e.g. ["1080p", "x265"]),
//       u:  uploader,
//       pk: short post key (for details URL if needed),
//     }],
//   }

const fetch = require('node-fetch');
const httpAgent = require('../http-agent');

const RARBG_URL = 'https://therarbg.to';

function normHash(h) {
  if (!h || typeof h !== 'string') return '';
  return /^[A-Fa-f0-9]{40}$/.test(h) ? h.toLowerCase() : '';
}

async function singleSearch(query, sourceConfig, log) {
  const enc = encodeURIComponent(query);
  // Path is `keywords:<q>:format:json` — colon-separated path segments,
  // NOT a query string. URL-encode the query value only.
  const url = (sourceConfig.url || RARBG_URL).replace(/\/+$/, '')
    + '/get-posts/keywords:' + enc + ':format:json';
  let res;
  try {
    res = await fetch(url, httpAgent.fetchOpts({
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: sourceConfig.timeoutMs || 10000,
    }, url));
  } catch (err) {
    log.error('source', 'therarbg network error: ' + err.message);
    return [];
  }
  if (!res.ok) {
    log.warn('source', 'therarbg HTTP ' + res.status);
    return [];
  }
  let payload;
  try { payload = await res.json(); }
  catch (err) { log.warn('source', 'therarbg bad JSON: ' + err.message); return []; }
  const hits = Array.isArray(payload && payload.results) ? payload.results : [];
  const out = [];
  for (const h of hits) {
    const hash = normHash(h.h);
    if (!hash) continue;
    out.push({
      infoHash: hash,
      title: h.n || '',
      size: Number(h.s || 0) || 0,
      seeders: Number(h.se || 0) || 0,
      indexer: 'TheRARBG' + (h.c ? ':' + h.c : ''),
      magnetTrackers: [],
      publishDate: null, // not provided on this endpoint
    });
  }
  return out;
}

async function multiSearch(queries, sourceConfig, log) {
  const seen = new Set();
  const out = [];
  for (const q of queries) {
    log.info('source', 'therarbg query "' + q + '"');
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
    // "UFC 325" probe — known to return ~9 hits including Countdown +
    // Embedded series episodes. A healthy TheRARBG returns dozens for
    // popular events; we don't assert a minimum, just a non-error reply.
    const results = await singleSearch('UFC 325', sourceConfig, log);
    return {
      ok: true,
      latencyMs: Date.now() - start,
      message: 'TheRARBG responding, ' + results.length + ' hit(s) for "UFC 325"',
    };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, message: err.message };
  }
}

module.exports = {
  type: 'therarbg',
  label: 'TheRARBG',
  description: 'Direct GET to therarbg.to/get-posts JSON endpoint. Strong '
    + 'sports/UFC coverage; catches what Prowlarr\'s federation misses.',
  schema: [
    { name: 'url',       label: 'Base URL',      type: 'url',    default: 'https://therarbg.to',
      hint: 'Leave default unless you\'re using a mirror.' },
    { name: 'timeoutMs', label: 'Timeout (ms)',  type: 'number', default: 10000 },
  ],
  multiSearch,
  test,
};
