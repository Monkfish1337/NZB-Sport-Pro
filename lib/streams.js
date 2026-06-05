// 0.32.0 — Stream handler.
//
// Dual-pipeline architecture that mirrors how Cinemeta + Comet + a debrid
// integration work for movies/TV, applied to sports.
//
//   Pipeline A (admin-configured, primary):
//     promotion.searchTitles -> admin-configured Torznab (Prowlarr) ->
//     filter -> sort -> emit Stremio infoHash stream rows. Whatever the
//     client is configured to do with infoHash rows (native debrid resolve,
//     check a Nuvio TorBox cache, fall through to peer-to-peer, etc.)
//     happens entirely on the client side. The addon never sees a debrid
//     key, never resolves a URL, never holds state.
//
//   Pipeline B (per-user, optional, parallel):
//     promotion.searchTitles -> admin-configured Newsnab -> filter -> sort
//     -> emit URL rows pointing at the user's Usenet Ultimate manifest
//     (existing 0.30.0/0.31.1 behaviour). Only runs if the user has set a
//     uuManifestUrl in /account.
//
// Both pipelines share the same noise + relevance + sort logic. Results
// are merged at the end.

const store = require('./store');
const { getByEventId } = require('./promotions');
const newsnab = require('./sources/newsnab');
const uu = require('./sources/usenet-ultimate');
const prowlarr = require('./sources/prowlarr');
const trackers = require('./trackers');

const MAX_ROWS = parseInt(process.env.STREAM_MAX_ROWS || '20', 10);

function resRank(title) {
  if (!title) return 0;
  if (/\b(2160p|4k|uhd)\b/i.test(title)) return 4;
  if (/\b1080p|fhd\b/i.test(title)) return 3;
  if (/\b720p\b/i.test(title)) return 2;
  if (/\b480p|sd\b/i.test(title)) return 1;
  return 0;
}

function detectResolution(t) {
  if (!t) return '';
  if (/\b(2160p|4k|uhd)\b/i.test(t)) return '2160p';
  if (/\b1080p|fhd\b/i.test(t)) return '1080p';
  if (/\b720p\b/i.test(t)) return '720p';
  if (/\b480p|sd\b/i.test(t)) return '480p';
  return '';
}

function detectSource(t) {
  if (!t) return '';
  if (/\bWEB[\s._-]*DL\b/i.test(t)) return 'WEB-DL';
  if (/\bWEBRip\b/i.test(t)) return 'WEBRip';
  if (/\bWEB\b/i.test(t)) return 'WEB';
  if (/\bHDTV\b/i.test(t)) return 'HDTV';
  if (/\bBluRay\b/i.test(t)) return 'BluRay';
  return '';
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return Math.round(bytes / 1e6) + ' MB';
  return '';
}

// Sort by resolution rank desc -> size desc -> publishDate desc / seeders desc.
function sortResults(results, sizeField, dateField, seedersField) {
  results.sort((a, b) => {
    const rb = resRank(b.title) - resRank(a.title);
    if (rb !== 0) return rb;
    const sb = (Number(b[sizeField]) || 0) - (Number(a[sizeField]) || 0);
    if (sb !== 0) return sb;
    if (seedersField) {
      const seed = (Number(b[seedersField]) || 0) - (Number(a[seedersField]) || 0);
      if (seed !== 0) return seed;
    }
    return (Date.parse(b[dateField]) || 0) - (Date.parse(a[dateField]) || 0);
  });
}

// Apply the noise filter and per-promotion relevance check to a result list.
// Shared between Prowlarr and Newsnab pipelines.
function filterResults(label, results, log, promo, event) {
  const noise = newsnab.filterSportsNoise(results, log);
  const relevant = [];
  const rejectReasons = {};
  for (const r of noise.results) {
    const verdict = promo.isRelevantStreamTitle(r.title, event);
    if (verdict.ok) relevant.push(r);
    else rejectReasons[verdict.reason] = (rejectReasons[verdict.reason] || 0) + 1;
  }
  const breakdown = Object.entries(rejectReasons)
    .map(([k, v]) => v + ' ' + k).join(' / ') || 'none';
  log(label + ' SUMMARY: ' + results.length + ' raw -> '
    + noise.results.length + ' post-noise -> '
    + relevant.length + ' post-relevance (rejected: ' + breakdown + ')');
  return relevant;
}

// Build a Stremio infoHash stream row from a Prowlarr result.
// Layout matches the Torrentio/Comet convention so clients render it
// consistently next to other infoHash-emitting addons.
function buildInfoHashRow(r) {
  if (!r || !r.infoHash) return null;
  const resolution = detectResolution(r.title);
  const sourceTag = detectSource(r.title);
  const qualityLine = [resolution, sourceTag].filter(Boolean).join(' ') || 'Torrent';
  const sizeLabel = formatSize(r.size);
  const seederTag = (Number(r.seeders) || 0) > 0 ? '\u{1F465} ' + r.seeders : '';   // 👥
  const indexerTag = r.indexer || '';
  const metaLine = [
    sizeLabel ? '\u{1F4BE} ' + sizeLabel : '',   // 💾
    seederTag,
    indexerTag,
  ].filter(Boolean).join(' · ');
  const releaseTitle = r.title || 'Untitled';
  const magnetTrackers = trackers.extractTrackersFromMagnet(r.magnetUrl);
  return {
    name: '\u{1F9F2} Torrent\n' + qualityLine,        // 🧲 Torrent\n1080p WEB
    title: releaseTitle + (metaLine ? '\n' + metaLine : ''),
    infoHash: r.infoHash.toLowerCase(),
    sources: trackers.buildSources(r.infoHash, magnetTrackers),
    behaviorHints: {
      bingeGroup: 'serioussportsync-torrent',
    },
  };
}

function buildInfoHashRows(results) {
  const rows = [];
  for (const r of results) {
    const row = buildInfoHashRow(r);
    if (row) rows.push(row);
  }
  return rows;
}

async function handleStream(params) {
  const log = makeLogger(params);
  const id = params.id;
  if (params.type !== 'movie' || !id || !id.includes(':')) {
    return { streams: [] };
  }

  // 1. Lookup event + promotion.
  const data = store.loadFromDisk();
  const event = (data.events || []).find((e) => e.id === id);
  if (!event) { log('no event in store for ' + id); return { streams: [] }; }
  const promo = getByEventId(id);
  if (!promo || typeof promo.searchTitles !== 'function') {
    log('no promotion / no searchTitles for ' + id);
    return { streams: [] };
  }

  // 2. Search titles.
  const titles = promo.searchTitles(event);
  if (titles.length === 0) {
    log('no searchTitles for ' + id + ' (' + event.name + ')');
    return { streams: [] };
  }

  // 3. User backends.
  const userConfig = params.userConfig || {};
  const uuManifest = (userConfig.uuManifestUrl || '').trim();
  const uuConfig = uuManifest ? uu.parseManifestUrl(uuManifest) : null;

  // 4. Both pipelines run in parallel. Either or both may return zero rows.
  const tasks = [];

  // Pipeline A — Prowlarr (Torznab) emits infoHash rows. Always runs if the
  // admin has Prowlarr configured. The client handles whatever it wants to
  // do with infoHash rows (debrid lookup, peer-to-peer, ignore).
  tasks.push((async () => {
    try {
      log('torznab: querying ' + titles.length + ' title variant(s)');
      const raw = await prowlarr.multiSearch(titles, { log });
      if (raw.length === 0) return [];
      const relevant = filterResults('torznab', raw, log, promo, event);
      sortResults(relevant, 'size', 'publishDate', 'seeders');
      return buildInfoHashRows(relevant.slice(0, MAX_ROWS));
    } catch (err) { log('torznab pipeline failed: ' + err.message); return []; }
  })());

  // Pipeline B — Newsnab + Usenet Ultimate URL builder. Only runs if the
  // user has a UU manifest URL set.
  if (uuConfig) {
    tasks.push((async () => {
      try {
        log('newsnab: querying ' + titles.length + ' title variant(s)');
        const searchOut = await newsnab.multiSearch(titles, { log });
        if (searchOut.results.length === 0) return [];
        const relevant = filterResults('newsnab', searchOut.results, log, promo, event);
        sortResults(relevant, 'size', 'publishedAt', null);
        return uu.buildStreamRows(relevant.slice(0, MAX_ROWS), uuConfig, event.name);
      } catch (err) { log('newsnab/uu pipeline failed: ' + err.message); return []; }
    })());
  }

  const rowSets = await Promise.all(tasks);

  // 5. Merge with light deduplication by release title (the same release
  // might appear via both pipelines).
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

function makeLogger(params) {
  const tag = '[stream' + (params.username ? ' ' + params.username : '') + ']';
  return (msg) => console.log(tag + ' ' + msg);
}

// Legacy export retained so the old /resolve route in addon.js still returns
// 404 cleanly without throwing on import.
async function resolvePlay() {
  return { ok: false, error: 'debrid-resolution-removed-in-0.30.0' };
}

module.exports = { handleStream, resolvePlay };
