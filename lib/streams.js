// 0.31.0 — Stream handler with TorBox + Usenet Ultimate backend support.
//
// Both backends are optional and independent. /stream branches on the user's
// /account config:
//
//   torboxApiKey set     → search TorBox's Newznab endpoint (per-user) and
//                          return rows pointing at TorBox's CDN URLs.
//   uuManifestUrl set    → search admin's shared NZBgeek (Newsnab config in
//                          settings/env) and return rows pointing at the
//                          user's Usenet Ultimate instance (NzbDAV bridge).
//   both set             → run both pipelines, merge rows.
//   neither set          → return a help row pointing to /account.
//
// The pipeline (search → noise filter → relevance filter → sort → row build)
// is identical for both; only the indexer endpoint and the row builder differ.

const store = require('./store');
const { getByEventId } = require('./promotions');
const newsnab = require('./sources/newsnab');
const uu = require('./sources/usenet-ultimate');
const torbox = require('./sources/torbox-usenet');

const MAX_ROWS = parseInt(process.env.STREAM_MAX_ROWS || '20', 10);

function resRank(title) {
  if (!title) return 0;
  if (/\b(2160p|4k|uhd)\b/i.test(title)) return 4;
  if (/\b1080p|fhd\b/i.test(title)) return 3;
  if (/\b720p\b/i.test(title)) return 2;
  if (/\b480p|sd\b/i.test(title)) return 1;
  return 0;
}

// Search the given Newsnab endpoint, apply noise + relevance filters, sort
// by quality. Returns the surviving NZB result array. Pure pipeline — caller
// supplies the row builder. `searchConfig` is what gets passed to
// newsnab.multiSearch's options.config (use undefined to fall back to the
// admin's settings.getNewsnab()).
async function searchAndFilter(label, titles, searchConfig, log, event, promo, extraOpts) {
  log(label + ': querying ' + titles.length + ' title variant(s): ' + JSON.stringify(titles));
  const searchOut = await newsnab.multiSearch(titles, Object.assign(
    { log, config: searchConfig },
    extraOpts || {}
  ));
  const noise = newsnab.filterSportsNoise(searchOut.results, log);
  const relevant = [];
  const rejectReasons = {};
  for (const r of noise.results) {
    const verdict = promo.isRelevantStreamTitle(r.title, event);
    if (verdict.ok) relevant.push(r);
    else rejectReasons[verdict.reason] = (rejectReasons[verdict.reason] || 0) + 1;
  }
  const rejBreakdown = Object.entries(rejectReasons)
    .map(([k, v]) => v + ' ' + k).join(' / ') || 'none';
  log(label + ' SUMMARY: ' + searchOut.results.length + ' raw -> '
    + noise.results.length + ' post-noise -> '
    + relevant.length + ' post-relevance (rejected: ' + rejBreakdown + ')');
  relevant.sort((a, b) => {
    const rb = resRank(b.title) - resRank(a.title);
    if (rb !== 0) return rb;
    const sb = (Number(b.size) || 0) - (Number(a.size) || 0);
    if (sb !== 0) return sb;
    return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);
  });
  return relevant;
}

async function handleStream(params) {
  const log = makeLogger(params);
  const id = params.id;
  if (params.type !== 'movie' || !id || !id.includes(':')) {
    return { streams: [] };
  }

  // 1. Look up the event.
  const data = store.loadFromDisk();
  const event = (data.events || []).find((e) => e.id === id);
  if (!event) { log('no event in store for ' + id); return { streams: [] }; }
  const promo = getByEventId(id);
  if (!promo || typeof promo.searchTitles !== 'function') {
    log('no promotion / no searchTitles for ' + id);
    return { streams: [] };
  }

  // 2. Per-user backend config.
  const userConfig = params.userConfig || {};
  const torboxKey = (userConfig.torboxApiKey || '').trim();
  const uuManifest = (userConfig.uuManifestUrl || '').trim();
  if (!torboxKey && !uuManifest) {
    return { streams: [helpRow(
      'No Usenet backend configured',
      'Add a TorBox API key OR a Usenet Ultimate manifest URL on /account.'
    )] };
  }

  // 3. Search titles.
  const titles = promo.searchTitles(event);
  if (titles.length === 0) {
    log('no searchTitles for ' + id + ' (' + event.name + ')');
    return { streams: [helpRow(
      'No search aliases for this event',
      'The metadata layer could not derive a search query — please report this event.'
    )] };
  }

  // 4. Run each configured backend in parallel, build rows from its results.
  const tasks = [];
  if (torboxKey) {
    tasks.push((async () => {
      try {
        const results = await searchAndFilter('torbox', titles,
          torbox.newsnabConfig(torboxKey), log, event, promo,
          torbox.searchOptions());
        return torbox.buildStreamRows(results.slice(0, MAX_ROWS), event.name);
      } catch (err) { log('torbox path failed: ' + err.message); return []; }
    })());
  }
  if (uuManifest) {
    tasks.push((async () => {
      const uuConfig = uu.parseManifestUrl(uuManifest);
      if (!uuConfig) {
        log('uu: invalid manifest URL');
        return [helpRow(
          'Invalid UU manifest URL',
          'Expected https://<host>/stremio/<config>/manifest.json — check /account.'
        )];
      }
      try {
        const results = await searchAndFilter('uu', titles,
          undefined /* admin NZBgeek via settings */, log, event, promo);
        return uu.buildStreamRows(results.slice(0, MAX_ROWS), uuConfig, event.name);
      } catch (err) { log('uu path failed: ' + err.message); return []; }
    })());
  }
  const rowSets = await Promise.all(tasks);

  // 5. Merge, dedupe by title (same release may surface from both backends).
  const seen = new Set();
  const merged = [];
  for (const set of rowSets) {
    for (const row of set) {
      const key = row && row.title ? row.title.split('\n')[0] : null;
      if (!key) { merged.push(row); continue; }
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
  }
  log('returning ' + merged.length + ' stream row(s) total');
  return { streams: merged };
}

function helpRow(name, description) {
  return {
    name: '\u{2139}\u{FE0F} ' + name,
    title: name,
    description,
    externalUrl: 'about:blank',
    behaviorHints: { notWebReady: true },
  };
}

function makeLogger(params) {
  const tag = '[stream' + (params.username ? ' ' + params.username : '') + ']';
  return (msg) => console.log(tag + ' ' + msg);
}

// Legacy export — addon.js still imports this. With debrid resolution removed,
// every call returns the sentinel so the old /resolve route returns 404.
async function resolvePlay() {
  return { ok: false, error: 'debrid-resolution-removed-in-0.30.0' };
}

module.exports = { handleStream, resolvePlay };
