// Direct Knaben client. Bypasses Prowlarr because Prowlarr's Knaben
// Cardigann definition is broken (returns 0 results for sport content).
//
// Knaben is a public meta-search engine that aggregates 1337x, TPB, and
// many other indexers. Useful for us because 1337x is Cloudflare-blocked
// in many homelab stacks; Knaben surfaces 1337x's catalog without CF.
//
// We HTML-scrape because Knaben's JSON API at api.knaben.org/v1 ignores
// the keywords param entirely and returns top-seeded junk regardless of
// query. The website renders results server-side, so a single fetch +
// regex extraction is enough.

const fetch = require('node-fetch');
const httpAgent = require('../http-agent');

const BASE = 'https://knaben.org';
const TIMEOUT_MS = 12000;

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Each result row on Knaben's search page contains an anchor with the
// magnet URL and the release title in the title= attribute, e.g.
//   <a title="UFC.Fight.Night.276.Main.Card..." href="magnet:?xt=urn:btih:HASH&dn=...&tr=...">
// We pull all of those out in one pass.
const ROW_RE = /<a\s+title="([^"]+)"\s+href="(magnet:\?[^"]+)"/gi;

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function hashFromMagnet(magnet) {
  const m = magnet.match(/urn:btih:([A-Fa-f0-9]{40})/i);
  return m ? m[1].toLowerCase() : '';
}

// Knaben sometimes encodes the size + seeders in nearby table cells.
// They're not in a stable attribute so we make a best effort to read them
// from the row context. If parsing fails we return 0 and the relevance
// check downstream still has the title.
function extractRowContext(html, anchorStart) {
  // Walk backward to the row's <tr> and forward to </tr>, then look for
  // numeric size + seeders in <td>s. Knaben's layout uses GB/MB suffixes.
  const TR_OPEN = html.lastIndexOf('<tr', anchorStart);
  const TR_CLOSE = html.indexOf('</tr>', anchorStart);
  if (TR_OPEN < 0 || TR_CLOSE < 0) return { size: 0, seeders: 0 };
  const row = html.slice(TR_OPEN, TR_CLOSE);
  let size = 0;
  const sizeMatch = row.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB|TB)/i);
  if (sizeMatch) {
    const n = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();
    const mult = unit === 'TB' ? 1099511627776
              : unit === 'GB' ? 1073741824
              : unit === 'MB' ? 1048576
              : 1024;
    size = Math.round(n * mult);
  }
  // Seeders/leechers usually appear as bare integers in adjacent <td>s.
  // Grab the first 1-6 digit number that isn't part of the size string.
  let seeders = 0;
  const seedMatch = row.match(/<td[^>]*>\s*(\d{1,6})\s*<\/td>/);
  if (seedMatch) seeders = parseInt(seedMatch[1], 10);
  return { size, seeders };
}

async function search(query, options) {
  const opts = options || {};
  const log = opts.log || (() => {});
  if (!query) return [];

  const encoded = encodeURIComponent(query);
  // /0 = all categories (TV/Sport 002006000 returns nothing because Knaben
  // re-categorizes scraped releases by source tracker, not content type).
  const url = BASE + '/search/' + encoded + '/0/1/seeders';

  // Knaben throttles / times out under the warmer's rapid-fire queries, which
  // would otherwise poison the cached candidate list with a false "0 results".
  // Retry once with a short backoff on a network error or a 429/503.
  let res = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(url, httpAgent.fetchOpts({
        headers: { 'User-Agent': 'serioussportsync/0.16.0' },
        timeout: TIMEOUT_MS,
      }, url));
    } catch (err) {
      if (attempt === 0) { log('  knaben: ' + err.message + ' \u2014 retrying'); await delay(1500); continue; }
      log('  knaben: network error: ' + err.message);
      return [];
    }
    if (res.ok) break;
    if ((res.status === 429 || res.status === 503) && attempt === 0) {
      log('  knaben: HTTP ' + res.status + ' \u2014 retrying'); await delay(1500); res = null; continue;
    }
    log('  knaben: HTTP ' + res.status);
    return [];
  }
  if (!res) return [];
  const html = await res.text();

  const out = [];
  const seen = new Set();
  let m;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(html)) !== null) {
    const title = decodeHtml(m[1]);
    const magnet = decodeHtml(m[2]);
    const hash = hashFromMagnet(magnet);
    if (!hash) continue;
    if (seen.has(hash)) continue;
    seen.add(hash);
    const ctx = extractRowContext(html, m.index);
    out.push({
      title,
      infoHash: hash,
      size: ctx.size,
      seeders: ctx.seeders,
      leechers: 0,
      magnetUrl: magnet,
      downloadUrl: null,
      indexer: 'Knaben',
      publishDate: null,
    });
  }
  return out;
}

async function multiSearch(queries, options) {
  const opts = options || {};
  const log = opts.log || (() => {});
  const seen = new Set();
  const out = [];
  for (const q of queries) {
    log('  knaben: query "' + q + '"');
    const results = await search(q, { log });
    log('    -> ' + results.length + ' hits');
    for (const r of results) {
      if (seen.has(r.infoHash)) continue;
      seen.add(r.infoHash);
      out.push(r);
    }
  }
  return out;
}

module.exports = { search, multiSearch };
