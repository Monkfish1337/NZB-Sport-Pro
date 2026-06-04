// 0.31.1 — Stream handler. UU-only after rolling back the failed TorBox
// direct integration (see lib/sources/torbox-usenet.js header for why).
//
// Flow:
//   1. Look up the catalog event from the metadata cache.
//   2. Generate optimised short search titles via promotion.searchTitles().
//   3. Query the admin's configured Newsnab indexer (settings + env).
//   4. Drop sports noise (vlogs, weigh-ins, etc) and apply per-promotion
//      relevance check.
//   5. Sort: resolution rank -> file size -> publish date.
//   6. Build Stremio rows pointing at the user's Usenet Ultimate instance.
//
// The user's account.config must include uuManifestUrl. Without it we
// return a hint row pointing them back to /account.

const store = require('./store');
const { getByEventId } = require('./promotions');
const newsnab = require('./sources/newsnab');
const uu = require('./sources/usenet-ultimate');

const MAX_ROWS = parseInt(process.env.STREAM_MAX_ROWS || '20', 10);

function resRank(title) {
  if (!title) return 0;
  if (/\b(2160p|4k|uhd)\b/i.test(title)) return 4;
  if (/\b1080p|fhd\b/i.test(title)) return 3;
  if (/\b720p\b/i.test(title)) return 2;
  if (/\b480p|sd\b/i.test(title)) return 1;
  return 0;
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

  // 2. Per-user UU config.
  const userConfig = params.userConfig || {};
  const manifestUrl = (userConfig.uuManifestUrl || '').trim();
  if (!manifestUrl) {
    return { streams: [helpRow(
      'No Usenet Ultimate URL set',
      'Add your UU manifest URL on /account to enable streams.'
    )] };
  }
  const uuConfig = uu.parseManifestUrl(manifestUrl);
  if (!uuConfig) {
    return { streams: [helpRow(
      'Invalid UU manifest URL',
      'Expected https://<host>/stremio/<config>/manifest.json — check /account.'
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
  log('querying newsnab for ' + titles.length + ' title variant(s): ' + JSON.stringify(titles));

  // 4. Newsnab + filters + sort.
  const searchOut = await newsnab.multiSearch(titles, { log });
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
  log('SUMMARY: ' + searchOut.results.length + ' raw -> '
    + noise.results.length + ' post-noise -> '
    + relevant.length + ' post-relevance (rejected: ' + rejBreakdown + ')');

  relevant.sort((a, b) => {
    const rb = resRank(b.title) - resRank(a.title);
    if (rb !== 0) return rb;
    const sb = (Number(b.size) || 0) - (Number(a.size) || 0);
    if (sb !== 0) return sb;
    return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);
  });

  // 5. Build UU rows.
  const top = relevant.slice(0, MAX_ROWS);
  const rows = uu.buildStreamRows(top, uuConfig, event.name);
  log('returning ' + rows.length + ' stream row(s)');
  return { streams: rows };
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

// Legacy export — kept so addon.js's old /resolve route (left in place)
// continues to return 404 instead of crashing the require chain.
async function resolvePlay() {
  return { ok: false, error: 'debrid-resolution-removed-in-0.30.0' };
}

module.exports = { handleStream, resolvePlay };
