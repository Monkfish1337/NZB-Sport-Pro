// Zilean source — indexes the DebridMediaManager community hashlists.
// Hits a self-hosted Zilean instance directly; not through Prowlarr.
// Every hash here is by definition already cached on a debrid somewhere,
// so it's especially useful for our flow.

const fetch = require('node-fetch');
const httpAgent = require('../http-agent');

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function normHash(h) {
  if (!h || typeof h !== 'string') return '';
  return /^[A-Fa-f0-9]{40}$/.test(h) ? h.toLowerCase() : '';
}

async function singleSearch(query, sourceConfig, log) {
  if (!sourceConfig.url) return [];
  const url = sourceConfig.url.replace(/\/+$/, '') + '/dmm/search';
  let res = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(url, httpAgent.fetchOpts({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ queryText: query }),
        timeout: sourceConfig.timeoutMs || 12000,
      }, url));
    } catch (err) {
      if (attempt === 0) { log.warn('source', 'zilean ' + err.message + ' — retrying'); await delay(1200); continue; }
      log.error('source', 'zilean network error: ' + err.message);
      return [];
    }
    if (res.ok) break;
    if ((res.status === 429 || res.status === 503) && attempt === 0) {
      log.warn('source', 'zilean HTTP ' + res.status + ' — retrying'); await delay(1200); res = null; continue;
    }
    log.warn('source', 'zilean HTTP ' + res.status);
    return [];
  }
  if (!res) return [];

  let body;
  try { body = await res.json(); }
  catch (err) { log.warn('source', 'zilean bad JSON: ' + err.message); return []; }
  const items = Array.isArray(body) ? body
    : (body && Array.isArray(body.results) ? body.results : []);

  const out = [];
  const seen = new Set();
  for (const it of items) {
    const hash = normHash(it.infoHash || it.InfoHash || it.info_hash || it.hash);
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    const title = it.filename || it.raw_title || it.rawTitle || it.title || it.Filename || '';
    out.push({
      infoHash: hash,
      title: String(title),
      size: Number(it.filesize || it.fileSize || it.size || 0) || 0,
      seeders: 0,
      indexer: 'Zilean',
      magnetTrackers: [],
      publishDate: it.ingested_at || it.indexed_at || null,
    });
  }
  return out;
}

async function multiSearch(queries, sourceConfig, log) {
  const seen = new Set();
  const out = [];
  for (const q of queries) {
    log.info('source', 'zilean query "' + q + '"');
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
  if (!sourceConfig.url) return { ok: false, message: 'URL not configured' };
  const start = Date.now();
  try {
    // Use a trivial query as a liveness probe.
    const result = await singleSearch('test', sourceConfig, log);
    return {
      ok: true,
      latencyMs: Date.now() - start,
      message: 'Zilean responding, ' + result.length + ' hit(s) for probe',
    };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, message: err.message };
  }
}

module.exports = {
  type: 'zilean',
  label: 'Zilean (DMM hashlist)',
  description: 'Self-hosted Zilean instance. Hashes are pre-cached on debrid services.',
  schema: [
    { name: 'url',       label: 'Zilean URL',    type: 'url',    required: true,
      placeholder: 'http://zilean:8181',
      hint: 'Internal service URL — not through any VPN/proxy.' },
    { name: 'timeoutMs', label: 'Timeout (ms)', type: 'number', default: 12000 },
  ],
  multiSearch,
  test,
};
