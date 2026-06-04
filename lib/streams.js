// 0.30.0 — Stream handler.
//
// MAJOR PIVOT from earlier versions: this addon no longer resolves debrid
// streams (Real-Debrid / TorBox / Premiumize). All the warming, denylists,
// cached-hash verification, signed-URL play-time resolution etc. are gone.
//
// New flow:
//   1. Lookup event by id from the metadata cache.
//   2. Generate optimised short search titles via promotion.searchTitles(event).
//   3. Query the configured Newsnab/Torznab indexer (admin-wide config).
//   4. Filter sports noise (vlogs, weigh-ins, press conferences, etc).
//   5. Apply the per-promotion isRelevantStreamTitle relevance check.
//   6. Build Stremio stream rows pointing at the USER'S Usenet Ultimate
//      instance — UU resolves to NzbDAV's mounted file on play.
//
// Per-user requirement: the user's account.config must include uuManifestUrl
// (their Usenet Ultimate manifest URL). Without it we return a hint row.

const store = require('./store');
const { getByEventId } = require('./promotions');
const newsnab = require('./sources/newsnab');
const uu = require('./sources/usenet-ultimate');

// Top-N cap on returned rows so the Stremio UI stays scannable.
const MAX_ROWS = parseInt(process.env.STREAM_MAX_ROWS || '20', 10);

async function handleStream(params) {
  const log = makeLogger(params);
  const id = params.id;
  if (params.type !== 'movie' || !id || !id.includes(':')) {
    return { streams: [] };
  }

  // 1. Look up the event.
  const data = store.loadFromDisk();
  const event = (data.events || []).find((e) => e.id === id);
  if (!event) {
    log('no event in store for ' + id);
    return { streams: [] };
  }
  const promo = getByEventId(id);
  if (!promo || typeof promo.searchTitles !== 'function') {
    log('no promotion / no searchTitles for ' + id);
    return { streams: [] };
  }

  // 2. Per-user UU config sanity check.
  const userConfig = params.userConfig || {};
  const manifestUrl = (userConfig.uuManifestUrl || '').trim();
  if (!manifestUrl) {
    return { streams: [helpRow(
      'No Usenet Ultimate URL set',
      'Add your UU manifest URL on /account to enable Usenet streams.'
    )] };
  }
  const uuConfig = uu.parseManifestUrl(manifestUrl);
  if (!uuConfig) {
    return { streams: [helpRow(
      'Invalid UU manifest URL',
      'Expected https://<host>/stremio/<config>/manifest.json — check /account.'
    )] };
  }

  // 3. Search Newsnab.
  const titles = promo.searchTitles(event);
  if (titles.length === 0) {
    log('no searchTitles for ' + id + ' (' + event.name + ')');
    return { streams: [helpRow(
      'No search aliases for this event',
      'The metadata layer could not derive a search query — please report this event.'
    )] };
  }
  log('querying newsnab for ' + titles.length + ' title variant(s): ' + JSON.stringify(titles));
  const searchOut = await newsnab.multiSearch(titles, { log });
  log('newsnab returned ' + searchOut.results.length + ' merged result(s)');

  // 4. Filter sports noise (vlogs, weigh-ins, press conferences, etc).
  const noise = newsnab.filterSportsNoise(searchOut.results, log);
  log('noise filter kept ' + noise.results.length + ' / dropped ' + noise.dropped);

  // 5. Per-promotion relevance check (event-number / matchup / year).
  const relevant = [];
  let rejected = 0;
  for (const r of noise.results) {
    const verdict = promo.isRelevantStreamTitle(r.title, event);
    if (verdict.ok) relevant.push(r);
    else { rejected++; log('  rel-filter drop (' + verdict.reason + '): ' + r.title); }
  }
  log('relevance filter kept ' + relevant.length + ' / rejected ' + rejected);

  // 6. Sort: largest size first (proxy for quality), then newest first.
  relevant.sort((a, b) => (b.size || 0) - (a.size || 0)
    || (Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)));

  // 7. Build UU stream rows.
  const top = relevant.slice(0, MAX_ROWS);
  const rows = uu.buildStreamRows(top, uuConfig, event.name);
  log('returning ' + rows.length + ' stream row(s) (max ' + MAX_ROWS + ')');

  return { streams: rows };
}

// Helper pseudo-stream — a row that explains a setup issue to the user.
// Stremio renders the name + description; URL is about:blank so clicking it
// doesn't crash the player (most clients skip non-playable rows, that's fine).
function helpRow(name, description) {
  return {
    name: '\u{2139}\u{FE0F} ' + name,   // ℹ️ marker
    title: name,
    description,
    externalUrl: 'about:blank',
    behaviorHints: { notWebReady: true },
  };
}

// Username-tagged logger for traceability across concurrent requests.
function makeLogger(params) {
  const tag = '[stream' + (params.username ? ' ' + params.username : '') + ']';
  return (msg) => console.log(tag + ' ' + msg);
}

// Legacy export — addon.js still imports this. With debrid resolution removed,
// every call returns the sentinel so the old /resolve route returns 404. The
// route will be dropped entirely in a follow-up cleanup pass once /account
// has been migrated; leaving it here keeps the import a no-op for now.
async function resolvePlay() {
  return { ok: false, error: 'debrid-resolution-removed-in-0.30.0' };
}

module.exports = { handleStream, resolvePlay };
