// General search — query every enabled prowlarr-type source in parallel,
// return merged raw results.
//
// Distinct from lib/search.js (the sport-specific /scrape pipeline) in three
// ways:
//   1. No noise/relevance filter — give the operator everything indexers say.
//   2. No infoHash hydration — for usenet results and DDL sites that don't
//      surface a btih, requiring infoHash would drop them. We return the
//      raw downloadUrl / magnetUrl and let the operator's downloader handle
//      it.
//   3. Per-source tagging — each result carries the source.id, source.name,
//      and source-derived `type` ('torrent' | 'usenet') so the UI can route
//      to the right downloader.
//
// We piggyback off the same Prowlarr Newznab endpoint as lib/sources/prowlarr.js
// but skip its multiSearch hash-hydration layer and post-filter.

// 0.2.0 — reads from lib/grabber-sources (NOT lib/settings) so the Grabber
// has its own independent indexer list. Sport-side /scrape calls are
// unaffected — they still use lib/settings.js + lib/sources/registry.js.
const fetch = require('node-fetch');
const httpAgent = require('./http-agent');
const grabberSources = require('./grabber-sources');
const log = require('./log-buffer');
const config = require('../config');   // 0.2.3 — honor SOURCE_TIMEOUT_MS

const DEFAULT_LIMIT = 100;
// 0.2.3 — was hardcoded 12000. Now respects SOURCE_TIMEOUT_MS env var
// (defaults to 10000 in config.js). Prowlarr aggregate searches can be
// slow if the operator has many indexers configured — bump SOURCE_TIMEOUT_MS
// in compose to 45000+ if you see "network timeout" errors from Prowlarr.
const DEFAULT_TIMEOUT_MS = config.defaultSourceTimeoutMs || 12000;

// 0.2.1 — relevance filter modes:
//   'strict' — every query word must appear in the title (default)
//   'loose'  — at least half (rounded up) of query words must appear
//   'off'    — no filter; return whatever the indexer says
// Bitmagnet's torznab does fuzzy postgres FTS matching so a query for "white
// zombie" returns "Eternals" and "Rosy Vista - Unbelievable". Strict default
// kills 95% of that noise; 'loose' is for searches where you don't know the
// full title yet.
function queryTokens(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')        // strip punctuation
    .split(/\s+/)
    .filter((w) => w.length >= 2);             // drop single letters
}
function relevanceFilterFn(query, mode) {
  if (!query || !mode || mode === 'off') return () => true;
  const tokens = queryTokens(query);
  if (tokens.length === 0) return () => true;
  const threshold = (mode === 'loose')
    ? Math.ceil(tokens.length / 2)
    : tokens.length;                            // strict
  return (r) => {
    const title = String(r.title || '').toLowerCase();
    let hits = 0;
    for (const t of tokens) {
      if (title.includes(t)) hits++;
      if (hits >= threshold) return true;
    }
    return false;
  };
}

function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

// Heuristic: which sources should the operator's "torrent" vs "usenet" labels
// route results from? Prowlarr instances are configured per-protocol by
// convention (one prowlarr container indexes torrent trackers, a second
// indexes Newsnab providers). Operator tags each source with a `protocol`
// field in its name or settings — we look first at source.config.protocol,
// fall back to scanning the source name for "usenet" / "nzb".
function deriveType(source) {
  const cfg = source.config || {};
  if (cfg.protocol === 'torrent') return 'torrent';
  if (cfg.protocol === 'usenet')  return 'usenet';
  const n = (source.name || source.id || '').toLowerCase();
  if (/(usenet|nzb)/.test(n)) return 'usenet';
  return 'torrent';   // default — most operators run a single torrent prowlarr
}

// Single instance fetch. Returns { ok, results, error?, count }.
async function fetchSource(source, query, opts) {
  const cfg = source.config || {};
  if (!cfg.url) return { ok: false, error: 'not-configured', results: [], count: 0 };
  if (!cfg.apiKey) return { ok: false, error: 'no api key', results: [], count: 0 };

  const limit = (opts && opts.limit) || DEFAULT_LIMIT;
  const timeoutMs = (opts && opts.timeoutMs) || cfg.timeoutMs || DEFAULT_TIMEOUT_MS;
  const base = trimSlash(cfg.url);
  const params = new URLSearchParams({
    query,
    type: 'search',
    limit: String(limit),
  });

  const url = base + '/api/v1/search?' + params.toString();
  let res;
  try {
    res = await fetch(url, httpAgent.fetchOpts({
      headers: { 'X-Api-Key': cfg.apiKey, Accept: 'application/json' },
      timeout: timeoutMs,
    }, url));
  } catch (err) {
    log.warn('source', 'general-search ' + source.name + ' network error: ' + err.message);
    return { ok: false, error: 'network: ' + err.message, results: [], count: 0 };
  }
  if (!res.ok) {
    log.warn('source', 'general-search ' + source.name + ' HTTP ' + res.status);
    return { ok: false, error: 'http ' + res.status, results: [], count: 0 };
  }
  let raw;
  try { raw = await res.json(); }
  catch (err) {
    log.warn('source', 'general-search ' + source.name + ' bad JSON: ' + err.message);
    return { ok: false, error: 'json-parse', results: [], count: 0 };
  }
  if (!Array.isArray(raw)) {
    log.warn('source', 'general-search ' + source.name + ' unexpected response shape');
    return { ok: false, error: 'bad-shape', results: [], count: 0 };
  }

  const sourceType = deriveType(source);
  const results = raw.map((r) => normalise(r, source, sourceType)).filter(Boolean);
  log.info('source', 'general-search ' + source.name + ': ' + results.length + ' result(s) for "' + query + '"');
  return { ok: true, results, count: results.length };
}

function normalise(r, source, sourceType) {
  if (!r || typeof r !== 'object') return null;
  const downloadUrl = r.downloadUrl || r.link || '';
  const magnetUrl = r.magnetUrl || (downloadUrl.startsWith('magnet:') ? downloadUrl : '');
  const isMagnet = !!magnetUrl;

  // Per-result type override — if a single torrent prowlarr returns an .nzb
  // (unlikely but possible with cross-protocol indexers), tag it as usenet.
  let type = sourceType;
  if (!magnetUrl && /\.nzb(\?|$)/i.test(downloadUrl)) type = 'usenet';
  else if (magnetUrl || /\.torrent(\?|$)/i.test(downloadUrl)) type = 'torrent';

  const categories = Array.isArray(r.categories)
    ? r.categories.map((c) => (c && (c.id || c.name)) || c).filter(Boolean)
    : [];

  return {
    title:        String(r.title || '').trim(),
    indexer:      String(r.indexer || r.indexerName || ''),
    indexerId:    r.indexerId || null,
    sourceId:     source.id,
    sourceName:   source.name,
    type,
    size:         Number(r.size) || 0,
    seeders:      Number(r.seeders) || 0,
    leechers:     Number(r.leechers) || 0,
    grabs:        Number(r.grabs) || 0,
    downloadUrl,
    magnetUrl,
    isMagnet,
    guid:         r.guid || downloadUrl || magnetUrl,
    publishedAt:  r.publishDate || r.published || null,
    categories,
  };
}

// Fan out across every enabled prowlarr-type source. Returns:
//   {
//     results: [...],
//     sources: [ { id, name, type, ok, error?, count } ],
//     query,
//   }
async function search(query, opts) {
  const all = grabberSources.enabledSources().filter((s) => s.type === 'prowlarr');
  if (all.length === 0) {
    return { results: [], sources: [], query, error: 'no enabled grabber prowlarr sources — configure at /grabber/sources' };
  }

  // 0.2.1 — relevance filter mode comes from the request ('strict' | 'loose' | 'off').
  // Default 'strict' for general-search to suppress bitmagnet's FTS noise.
  const mode = (opts && opts.relevance) || 'strict';
  const relevant = relevanceFilterFn(query, mode);

  const tasks = all.map((source) => fetchSource(source, query, opts).then((out) => {
    const raw = out.results || [];
    const filtered = mode === 'off' ? raw : raw.filter(relevant);
    return {
      id: source.id,
      name: source.name,
      type: deriveType(source),
      ok: out.ok,
      error: out.error,
      count: filtered.length,
      rawCount: raw.length,
      droppedCount: raw.length - filtered.length,
      results: filtered,
    };
  }));
  const settled = await Promise.all(tasks);

  // Merge results across sources. Dedup by (title|size) to collapse
  // duplicates that show up on multiple indexers.
  const seen = new Set();
  const merged = [];
  for (const s of settled) {
    for (const r of (s.results || [])) {
      const key = (r.title || '') + '|' + (r.size || 0);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
    }
  }

  return {
    query,
    results: merged,
    sources: settled.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      ok: s.ok,
      error: s.error,
      count: s.count,
      rawCount: s.rawCount,
      droppedCount: s.droppedCount,
    })),
  };
}

module.exports = { search };
