// 0.30.0 — Newsnab-compatible NZB indexer client.
//
// Talks to any Newznab/Torznab v2 API: NZBgeek, NZBfinder, omgwtfnzbs,
// drunkenslug, etc. The protocol is uniform across providers — endpoint is
// `<base>/api?t=search&apikey=KEY&q=...&cat=...&limit=...`. We request JSON
// output (`o=json`) where supported and fall back to a small XML parser
// otherwise. Returns NZB URLs + metadata; we do NOT download or stream the
// NZB itself — that's the user's Usenet client (NzbDAV / TorBox Usenet /
// SABnzbd / Usenet Ultimate) job.
//
// Not used by /stream yet (Step 2 of the 0.30.0 pivot). This module is wired
// up in Step 4 alongside `lib/sources/usenet-ultimate.js`.

const fetch = require('node-fetch');
const settings = require('../settings');
const httpAgent = require('../http-agent');

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// In-memory cache keyed by (endpoint, apiKey, query, categories). Usenet
// retention is years and indexer results barely change minute-to-minute,
// so a 1-hour TTL is conservative. Heavily-rate-limited endpoints (TorBox
// search-api) avoid re-hitting the upstream on repeat catalog clicks.
const RESULT_CACHE = new Map();
const RESULT_CACHE_MAX = 500;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

// Per-endpoint circuit breaker. When an endpoint 429s, mark its base+apiKey
// as cooling down. Subsequent requests during the cooldown skip the upstream
// entirely (returning a fast not-configured-style failure) — avoids the
// rate-limit pattern where retrying within the window extends the block.
// Key shape mirrors the result cache so different keys / hosts get
// independent cooldowns.
const COOLDOWN = new Map();
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;   // 5 minutes

function cooldownKey(cfg) {
  return (cfg.url || '') + '|' + (cfg.apiKey || '');
}
function cooldownActive(cfg) {
  const until = COOLDOWN.get(cooldownKey(cfg));
  if (!until) return 0;
  if (until < Date.now()) { COOLDOWN.delete(cooldownKey(cfg)); return 0; }
  return until - Date.now();
}
function cooldownTrip(cfg, ttlMs) {
  COOLDOWN.set(cooldownKey(cfg), Date.now() + (ttlMs || DEFAULT_COOLDOWN_MS));
}

function cacheKey(cfg, query, cats) {
  return cfg.url + '|' + (cfg.apiKey || '') + '|' + cats + '|' + query;
}
function cacheGet(key) {
  const entry = RESULT_CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) { RESULT_CACHE.delete(key); return null; }
  return entry.results;
}
function cacheSet(key, results, ttlMs) {
  // Simple FIFO eviction at the cap — newest writes push oldest out.
  if (RESULT_CACHE.size >= RESULT_CACHE_MAX) {
    const firstKey = RESULT_CACHE.keys().next().value;
    if (firstKey) RESULT_CACHE.delete(firstKey);
  }
  RESULT_CACHE.set(key, { results, expiresAt: Date.now() + (ttlMs || DEFAULT_CACHE_TTL_MS) });
}

// Single search query against the configured indexer(s).
// Returns { ok, error?, results, count, query } — never throws.
//
// 0.42.7 — if cfg has multiple `endpoints`, this fans out to all of them
// in parallel and merges + deduplicates the results. This lets a promotion
// hit e.g. nzbgeek + usenet-crawler at once, since indexers vary widely in
// which release groups + which seasons they carry (current DARKSPORT
// releases show up on usenet-crawler weeks before nzbgeek indexes them).
async function search(query, options) {
  const opts = options || {};
  const log = opts.log || (() => {});
  const cfg = opts.config || settings.getNewsnab();

  const endpoints = (cfg.endpoints && cfg.endpoints.length > 0)
    ? cfg.endpoints
    : (cfg.url && cfg.apiKey ? [{ url: cfg.url, apiKey: cfg.apiKey }] : []);

  if (endpoints.length === 0) {
    log('  newsnab: not configured');
    return { ok: false, error: 'not-configured', results: [], count: 0, query };
  }

  if (endpoints.length === 1) {
    return searchOne(query, endpoints[0], cfg.categories, opts);
  }

  // Multi-endpoint fan-out. Query all in parallel, then merge + dedup by
  // nzbUrl / guid / title. If ANY endpoint succeeds, we return ok=true with
  // the union of results.
  const perEp = await Promise.all(endpoints.map((ep) =>
    searchOne(query, ep, cfg.categories, opts)));
  const seen = new Set();
  const merged = [];
  let anyOk = false;
  for (const r of perEp) {
    if (r.ok) anyOk = true;
    if (!r.ok || !r.results) continue;
    for (const item of r.results) {
      const k = item.nzbUrl || item.guid || item.title;
      if (!k || seen.has(k)) continue;
      seen.add(k);
      merged.push(item);
    }
  }
  return { ok: anyOk, results: merged, count: merged.length, query };
}

// Single-endpoint search — the guts of the pre-0.42.7 `search`. Factored out
// so multi-endpoint fan-out just calls this once per endpoint.
async function searchOne(query, endpoint, categoriesCfg, options) {
  const opts = options || {};
  const log = opts.log || (() => {});
  const cfg = { url: endpoint.url, apiKey: endpoint.apiKey, categories: categoriesCfg };
  if (!cfg.url || !cfg.apiKey) {
    return { ok: false, error: 'not-configured', results: [], count: 0, query };
  }

  const base = cfg.url.replace(/\/+$/, '');
  const params = new URLSearchParams({
    t: 'search',
    apikey: cfg.apiKey,
    q: query,
    limit: String(opts.limit || 100),
    o: 'json',
  });
  const cats = (opts.categories || cfg.categories || ['5000', '5080', '8000']).join(',');
  params.set('cat', cats);
  const url = base + '/api?' + params.toString();

  // Cache hit — return without touching the upstream.
  const ck = cacheKey(cfg, query, cats);
  const cached = cacheGet(ck);
  if (cached) {
    log('  newsnab: cache hit for "' + query + '" (' + cached.length + ' result(s))');
    return { ok: true, results: cached, count: cached.length, query, cached: true };
  }

  // Circuit-breaker check — skip if this endpoint is cooling down after 429.
  const cdRemain = cooldownActive(cfg);
  if (cdRemain > 0) {
    log('  newsnab: skipping "' + query + '" — endpoint cooling down for '
      + Math.ceil(cdRemain / 1000) + 's after recent 429');
    return { ok: false, error: 'cooldown', results: [], count: 0, query };
  }

  const fetchOnce = async () => {
    return fetch(url, httpAgent.fetchOpts({
      headers: { Accept: 'application/json, application/rss+xml, application/xml' },
      timeout: opts.timeoutMs || 10000,
    }, url));
  };

  let res;
  try {
    res = await fetchOnce();
  } catch (err) {
    log('  newsnab: network error: ' + err.message);
    return { ok: false, error: 'network: ' + err.message, results: [], count: 0, query };
  }

  // 429 backoff — TorBox's search-api throttles tightly. Sleep + retry once
  // before giving up so a single spike-rate burst doesn't kill the response.
  if (res.status === 429) {
    const backoffMs = opts.rateLimitBackoffMs || 5000;
    log('  newsnab: HTTP 429 rate-limited, sleeping ' + backoffMs + 'ms and retrying once');
    await delay(backoffMs);
    try { res = await fetchOnce(); }
    catch (err) {
      log('  newsnab: retry network error: ' + err.message);
      return { ok: false, error: 'network: ' + err.message, results: [], count: 0, query };
    }
  }

  if (!res.ok) {
    log('  newsnab: HTTP ' + res.status + ' ' + res.statusText);
    // Persistent 429 after retry — trip the circuit breaker so subsequent
    // calls during the cooldown window skip this endpoint instantly.
    if (res.status === 429) {
      cooldownTrip(cfg, opts.cooldownMs);
      log('  newsnab: cooldown engaged for ' + Math.ceil((opts.cooldownMs || DEFAULT_COOLDOWN_MS) / 1000) + 's');
    }
    return { ok: false, error: 'HTTP ' + res.status, results: [], count: 0, query };
  }

  let body;
  try { body = await res.text(); } catch (err) {
    log('  newsnab: bad body: ' + err.message);
    return { ok: false, error: 'bad-body', results: [], count: 0, query };
  }

  const parsed = parseResponse(body);
  // 0.42.12 — tag each item with the specific indexer name derived from the
  // endpoint URL (nzbgeek / usenet-crawler / drunkenslug / ...). uu row builder
  // surfaces this in the stream-row meta line so the user knows which indexer
  // sourced the release.
  const indexerName = indexerNameFromUrl(endpoint.url);
  for (const item of parsed) { if (item) item.indexer = indexerName; }
  // Cache successful results — even an empty array is worth caching since
  // re-querying the same empty term in a 1h window won't change anything.
  cacheSet(ck, parsed, opts.cacheTtlMs);
  return { ok: true, results: parsed, count: parsed.length, query };
}

// Extract a compact display name from an indexer's API base URL.
// api.nzbgeek.info -> "nzbgeek", www.usenet-crawler.com -> "usenet-crawler",
// api.drunkenslug.com -> "drunkenslug", api.nzbfinder.ws -> "nzbfinder".
function indexerNameFromUrl(url) {
  if (!url) return 'newsnab';
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h
      .replace(/^(api|www|search)\./, '')
      .replace(/\.(com|net|org|info|io|to|me|tv|ws|xyz|eu|co\.uk)$/, '');
  } catch (_) { return 'newsnab'; }
}

// Multiple queries (typically the per-promotion searchTitles array). Fires
// them serially with a tiny delay so we don't trip the indexer's per-second
// rate limit (NZBgeek = ~1 req/sec on free tier). Dedupes by NZB URL when
// the same post is returned for two different queries (common with our
// short-form aliases like "UFC FN 277" + "UFC Fight Night 277").
async function multiSearch(queries, options) {
  const opts = options || {};
  const log = opts.log || (() => {});
  const seen = new Set();
  const merged = [];
  const perQueryStats = [];

  // Optional cap on how many query variants we fire. Heavily-rate-limited
  // endpoints (TorBox search-api) set this to 1 so we only hit the upstream
  // with the shortest/most-likely variant — their fuzzy text-search handles
  // the rest. For permissive endpoints (NZBgeek admin-side) the default of
  // no cap fires every variant from searchTitles().
  const maxQueries = Number(opts.maxQueries) > 0
    ? Math.min(queries.length, Number(opts.maxQueries))
    : queries.length;
  const queriesToRun = queries.slice(0, maxQueries);
  if (maxQueries < queries.length) {
    log('  newsnab: maxQueries=' + maxQueries + ' — skipping ' +
        (queries.length - maxQueries) + ' variant(s)');
  }

  // 0.41.1 — Run queries in parallel batches. Previous behaviour was strict
  // serial with a 1.1s inter-query delay — fine for 5 variants (~10s), fatal
  // for the 51 variants an alias-enabled football promotion emits (~100s,
  // times out on the client). A concurrency of 5 with no delay finishes 51
  // queries in ~5s while keeping the load on the newsnab endpoint modest.
  const concurrency = Math.max(1, Number(opts.concurrency) || 5);
  // 0.41.2 — secondary dedup on normalised (title, size) tuple.
  // Different indexers proxy the same release via different NZB URLs, so
  // dedupe on nzbUrl alone lets the exact same release title through 4x
  // (once per source). Normalising the title (lowercased, punctuation
  // stripped, whitespace collapsed) and combining with byte-count size
  // catches those duplicates without collapsing legitimately-different
  // releases (e.g. 1080p vs 2160p share a title but differ in size).
  const seenNormalised = new Set();
  function normaliseForDedup(item) {
    const t = String(item.title || '')
      .toLowerCase()
      .replace(/[._\-\s]+/g, ' ')
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
    const s = Number(item.size) || 0;
    return t + '|' + s;
  }

  const runOne = async (q) => {
    log('  newsnab: query "' + q + '"');
    const r = await search(q, { ...opts, log });
    perQueryStats.push({ query: q, ok: r.ok, count: r.count, error: r.error });
    if (!r.ok) { log('    -> ' + (r.error || 'failed')); return; }
    log('    -> ' + r.count + ' raw results' + (r.cached ? ' (cached)' : ''));
    for (const item of r.results) {
      // Primary dedup — usually catches near-100% of dupes within a single indexer.
      const key = item.nzbUrl || item.guid || item.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // Secondary dedup — catches the same release proxied by multiple indexers.
      const normKey = normaliseForDedup(item);
      if (seenNormalised.has(normKey)) continue;
      seenNormalised.add(normKey);
      merged.push(item);
    }
  };
  // Drain the queue by kicking off `concurrency` workers, each of which
  // pulls the next query off the shared iterator.
  let cursor = 0;
  async function worker() {
    while (cursor < queriesToRun.length) {
      const i = cursor++;
      try { await runOne(queriesToRun[i]); }
      catch (err) { log('    -> worker error: ' + err.message); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queriesToRun.length) }, () => worker()));

  // Sort by published date desc (newest first). Releases without a date
  // sink to the bottom.
  merged.sort((a, b) => {
    const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bt - at;
  });

  log('  newsnab: ' + merged.length + ' unique result(s) across ' + queries.length + ' queries');
  return { results: merged, count: merged.length, perQuery: perQueryStats };
}

// ---------- response parsing ----------

function parseResponse(body) {
  // Try JSON first (when indexer honoured o=json).
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return parseJson(JSON.parse(trimmed)); }
    catch (_) { /* fall through to XML */ }
  }
  return parseXml(body);
}

// Newsnab/Torznab JSON shape varies slightly by provider. Common roots:
//   { channel: { item: [...] } }
//   { item: [...] }                        (older Newznab)
//   { results: [...] }                     (some forks)
//   [...]                                  (rare, direct array)
function parseJson(j) {
  let items = null;
  if (Array.isArray(j)) items = j;
  else if (j && j.channel && Array.isArray(j.channel.item)) items = j.channel.item;
  else if (j && j.channel && j.channel.item) items = [j.channel.item];
  else if (j && Array.isArray(j.item)) items = j.item;
  else if (j && Array.isArray(j.results)) items = j.results;
  else if (j && Array.isArray(j.entries)) items = j.entries;
  if (!items) return [];
  return items.map(normaliseItem).filter(Boolean);
}

// Tiny XML extractor — Newsnab's RSS items are simple and consistent, no
// need to drag in a full XML library. We pull <title>, <link>, <guid>,
// <pubDate>, and any <newznab:attr name="..." value="..."/> pairs.
function parseXml(body) {
  const out = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(body))) {
    const inner = m[1];
    // <enclosure url="..." length="123456" type="application/x-nzb"/> — most
    // Newsnab providers (including NZBgeek) put the byte size here rather
    // than in a <newznab:attr name="size"/> pair.
    const encl = inner.match(/<enclosure\b([^>]*)\/?>/i);
    let enclosure = null;
    if (encl) {
      const attrText = encl[1];
      const url    = (attrText.match(/url="([^"]+)"/i)    || [])[1] || null;
      const length = (attrText.match(/length="(\d+)"/i)   || [])[1] || null;
      const type   = (attrText.match(/type="([^"]+)"/i)   || [])[1] || null;
      enclosure = { url, length, type };
    }
    const item = {
      title: cdataOrText(extractTag(inner, 'title')),
      link: cdataOrText(extractTag(inner, 'link')),
      guid: cdataOrText(extractTag(inner, 'guid')),
      pubDate: cdataOrText(extractTag(inner, 'pubDate')),
      category: cdataOrText(extractTag(inner, 'category')),
      description: cdataOrText(extractTag(inner, 'description')),
      attrs: extractAttrs(inner),
      enclosure,
    };
    const norm = normaliseItem(item);
    if (norm) out.push(norm);
  }
  return out;
}

function extractTag(xml, tag) {
  const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}
function cdataOrText(s) {
  if (s == null) return null;
  const m = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (m ? m[1] : s).trim();
}
function extractAttrs(xml) {
  const re = /<(?:newznab:|torznab:|nntmux:)attr\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi;
  const out = {};
  let m;
  while ((m = re.exec(xml))) out[m[1].toLowerCase()] = m[2];
  return out;
}

// Normalise an item (JSON or XML-derived) into our flat shape.
function normaliseItem(raw) {
  if (!raw) return null;
  const attrs = (raw.attrs || raw.newznab_attr || {}) || {};
  // Some JSON shapes put attrs as an array of {name,value} — normalise that too.
  if (Array.isArray(attrs)) {
    const flat = {};
    for (const a of attrs) if (a && a.name) flat[String(a.name).toLowerCase()] = a.value;
    Object.assign(attrs, flat);
  }
  const title = (raw.title || '').trim();
  if (!title) return null;
  const nzbUrl = (raw.link || raw.nzbUrl || raw.enclosure_url || '').trim();
  const size = toInt(raw.size || attrs.size || (raw.enclosure && raw.enclosure.length) || 0);
  const grabs = toInt(attrs.grabs || raw.grabs || 0);
  const publishedAt = raw.pubDate || raw.published || raw.publishedAt || null;
  return {
    title,
    nzbUrl,
    guid: raw.guid || raw.id || null,
    size,
    grabs,
    group: attrs.group || raw.group || null,
    poster: attrs.poster || null,
    category: raw.category || attrs.category || null,
    indexer: 'newsnab',
    publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
  };
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

// ---------- sports noise filter ----------
//
// Newsnab indexers index EVERYTHING with the event's name in it — vlogs,
// interviews, press conferences, weigh-ins, recaps, highlights — most of
// which aren't the actual fight card. This filter rejects the obvious
// non-card content so /stream returns just the prelims/main-card/PPV rips.
//
// Patterns are matched against the release title with case-insensitive,
// separator-tolerant ([\s._-]) word-boundary regex. Add to this list as
// new noise patterns surface in real indexer results.
const NOISE_PATTERNS = [
  /\bvlog\b/i,
  /\bembedded\b/i,
  /\binterview\b/i,
  /\bpress[\s._-]*conf/i,
  /\bweigh[\s._-]*in\b/i,
  /\bceremonial\b/i,
  /\b(?:q[\s._-]*and[\s._-]*a|qanda|q&a)\b/i,
  /\bpreview\b/i,
  /\brecap\b/i,
  /\bhighlights?\b/i,
  /\bbest[\s._-]*finishes?\b/i,
  /\bpromo\b/i,
  /\btrailer\b/i,
  /\bbehind[\s._-]*the[\s._-]*scenes\b/i,
  /\bdocumentary\b/i,
  /\bcountdown\b/i,
  /\bhype\b/i,
  /\bon[\s._-]*the[\s._-]*line\b/i,                  // UFC promo show
  /\bextra[\s._-]*rounds\b/i,                         // UFC podcast/preview
  /\bits[\s._-]*time\b/i,                             // Bruce Buffer preview
  /\bfight[\s._-]*week\b/i,                           // weekly hype reel
  /\banniversary\b/i,
  /\btalk(?:ing)?[\s._-]*smack\b/i,                   // WWE
  /\bthe[\s._-]*bump\b/i,                             // WWE
  /\bafter[\s._-]*the[\s._-]*bell\b/i,                // WWE
  /\bcontrol[\s._-]*center\b/i,                       // AEW
  /\btech[\s._-]*talk\b/i,                            // F1
  /\btop[\s._-]*10\b/i,                               // highlights
  /\bpre[\s._-]*fight\b/i,                            // press junket etc
  /\bpost[\s._-]*fight\b/i,                           // recap show
  /\bpresser\b/i,
  /\bopen[\s._-]*workout/i,
  /\bmedia[\s._-]*day\b/i,
];

// 0.41.2 — foreign-language releases. Football (EPL, UCL) release groups
// tag non-English commentary tracks as SPANISH / FRENCH / etc. Default off
// so casual users don't have to fight through them. Env-gate ALLOW_FOREIGN_LANG
// disables the filter for operators who want all languages.
const FOREIGN_LANG_PATTERNS = [
  /\bSPANISH\b/i,
  /\bESPA[NÑ]OL\b/i,
  /\bFRENCH\b/i,
  /\bFRANCAIS\b/i, /\bFRAN[CÇ]AIS\b/i,
  /\bITALIAN\b/i, /\bITALIANO\b/i,
  /\bGERMAN\b/i, /\bDEUTSCH\b/i,
  /\bPORTUGUESE\b/i, /\bPORTUGU[EÊ]S\b/i, /\bBRAZILIAN\b/i, /\bPT[\s._-]?BR\b/,
  /\bDUTCH\b/i, /\bNEDERLANDS\b/i,
  /\bPOLISH\b/i, /\bPOLSKI\b/i,
  /\bRUSSIAN\b/i, /\bRU[\s._-]?DUB\b/i,
  /\bARABIC\b/i,
  /\bTURKISH\b/i, /\bT[UÜ]RK[CÇ]E\b/i,
  /\bCZECH\b/i,
  /\bHUNGARIAN\b/i, /\bMAGYAR\b/i,
  /\bGREEK\b/i,
  /\bJAPANESE\b/i,
  /\bKOREAN\b/i,
  /\bCHINESE\b/i, /\bMANDARIN\b/i,
];
const ALLOW_FOREIGN_LANG = /^(1|true|yes|on)$/i.test(String(process.env.ALLOW_FOREIGN_LANG || ''));

// Return true if this title looks like ACTUAL event content (prelims, main
// card, PPV, fight night rip) — false if it's vlog/interview/promo noise.
// Optional `extraPatterns` is a list of pre-compiled RegExp objects to also
function isLikelyEventContent(title, extraPatterns) {
  if (!title) return false;
  for (const re of NOISE_PATTERNS) if (re.test(title)) return false;
  // 0.41.2 — foreign-language filter (env-gated).
  if (!ALLOW_FOREIGN_LANG) {
    for (const re of FOREIGN_LANG_PATTERNS) if (re.test(title)) return false;
  }
  if (extraPatterns && extraPatterns.length) {
    for (const re of extraPatterns) if (re && re.test(title)) return false;
  }
  return true;
}

// Drop noise items from a results array. Returns the surviving items and
// a count of what was filtered for logging.
//
// 0.35.0: optional `promotionId` param pulls per-promotion override patterns
// from lib/match-overrides. Each pattern string is compiled to RegExp with
// safe error handling (bad UI input gets logged + skipped, not crashing the
// filter). Backward-compatible — old call sites without promotionId still
// work with just the global NOISE_PATTERNS list.
function filterSportsNoise(results, log, promotionId) {
  if (!Array.isArray(results)) return { results: [], dropped: 0 };

  // Lazy-require to avoid pulling match-overrides on every call to noise
  // filter from non-stream code paths.
  let extraPatterns = null;
  if (promotionId) {
    try {
      const overrides = require('../match-overrides');
      const extraStrings = overrides.getMergedNoisePatterns(promotionId, []);
      if (extraStrings.length) {
        extraPatterns = [];
        for (const s of extraStrings) {
          const re = overrides.compileOverridePattern(s, 'i');
          if (re) extraPatterns.push(re);
          else if (log) log('  newsnab: skipping bad noise pattern: ' + s);
        }
      }
    } catch (err) {
      if (log) log('  newsnab: override load failed: ' + err.message);
    }
  }

  const out = [];
  let dropped = 0;
  for (const r of results) {
    if (isLikelyEventContent(r.title, extraPatterns)) out.push(r);
    else {
      dropped++;
      if (log) log('  newsnab: noise-filter drop: ' + r.title);
    }
  }
  return { results: out, dropped };
}

module.exports = { search, multiSearch, isLikelyEventContent, filterSportsNoise };
