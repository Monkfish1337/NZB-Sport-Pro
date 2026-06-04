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

// Single search query against the configured indexer.
// Returns { ok, error?, results, count, query } — never throws.
async function search(query, options) {
  const opts = options || {};
  const log = opts.log || (() => {});
  const cfg = opts.config || settings.getNewsnab();
  if (!cfg.url || !cfg.apiKey) {
    log('  newsnab: not configured');
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

  let res;
  try {
    res = await fetch(url, httpAgent.fetchOpts({
      headers: { Accept: 'application/json, application/rss+xml, application/xml' },
      timeout: opts.timeoutMs || 10000,
    }, url));
  } catch (err) {
    log('  newsnab: network error: ' + err.message);
    return { ok: false, error: 'network: ' + err.message, results: [], count: 0, query };
  }
  if (!res.ok) {
    log('  newsnab: HTTP ' + res.status + ' ' + res.statusText);
    return { ok: false, error: 'HTTP ' + res.status, results: [], count: 0, query };
  }

  let body;
  try { body = await res.text(); } catch (err) {
    log('  newsnab: bad body: ' + err.message);
    return { ok: false, error: 'bad-body', results: [], count: 0, query };
  }

  const parsed = parseResponse(body);
  return { ok: true, results: parsed, count: parsed.length, query };
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

  for (const q of queries) {
    log('  newsnab: query "' + q + '"');
    const r = await search(q, { ...opts, log });
    perQueryStats.push({ query: q, ok: r.ok, count: r.count, error: r.error });
    if (!r.ok) { log('    -> ' + (r.error || 'failed')); continue; }
    log('    -> ' + r.count + ' raw results');
    for (const item of r.results) {
      const key = item.nzbUrl || item.guid || item.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    if (queries.length > 1) await delay(opts.queryDelayMs || 1100);
  }

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

// Return true if this title looks like ACTUAL event content (prelims, main
// card, PPV, fight night rip) — false if it's vlog/interview/promo noise.
function isLikelyEventContent(title) {
  if (!title) return false;
  for (const re of NOISE_PATTERNS) if (re.test(title)) return false;
  return true;
}

// Drop noise items from a results array. Returns the surviving items and
// a count of what was filtered for logging.
function filterSportsNoise(results, log) {
  if (!Array.isArray(results)) return { results: [], dropped: 0 };
  const out = [];
  let dropped = 0;
  for (const r of results) {
    if (isLikelyEventContent(r.title)) out.push(r);
    else {
      dropped++;
      if (log) log('  newsnab: noise-filter drop: ' + r.title);
    }
  }
  return { results: out, dropped };
}

module.exports = { search, multiSearch, isLikelyEventContent, filterSportsNoise };
