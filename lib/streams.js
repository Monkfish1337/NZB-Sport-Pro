// 0.33.0 — Stream handler. Companion-scraper architecture.
//
// Two pipelines, run in parallel:
//
//   Pipeline A (debrid path): companion scraper -> noise + relevance
//     filter -> sort -> TorBox cache check (per-user key) -> request
//     playable URL for each cached hash -> URL stream rows.
//     Uncached hashes are silently dropped — no infoHash rows ever leave
//     /stream, so the client can't fall through to peer-to-peer.
//
//   Pipeline B (Usenet path): admin-Newsnab -> noise + relevance filter
//     -> sort -> user's UU URL builder (existing 0.30.x behaviour).
//
// Per-user requirements:
//   - At least one of `torboxApiKey` or `uuManifestUrl` on /account.
//
// Admin requirements:
//   - Companion scraper URL (for Pipeline A).
//   - Newsnab URL + API key (for Pipeline B).

const store = require('./store');
const { getByEventId } = require('./promotions');
const newsnab = require('./sources/newsnab');
const uu = require('./sources/usenet-ultimate');
const companion = require('./sources/companion-scraper');
const torbox = require('./sources/torbox-resolver');
const settings = require('./settings');

const MAX_ROWS = parseInt(process.env.STREAM_MAX_ROWS || '20', 10);
const TORBOX_RESOLVE_PARALLEL = parseInt(process.env.TORBOX_RESOLVE_PARALLEL || '4', 10);

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

function sortCandidates(results, sizeField, dateField) {
  results.sort((a, b) => {
    const rb = resRank(b.title) - resRank(a.title);
    if (rb !== 0) return rb;
    const sb = (Number(b[sizeField]) || 0) - (Number(a[sizeField]) || 0);
    if (sb !== 0) return sb;
    return (Date.parse(b[dateField]) || 0) - (Date.parse(a[dateField]) || 0);
  });
}

function filterCandidates(label, results, log, promo, event) {
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

// Build a TorBox-resolved stream row. Same multi-line name/title pattern
// as the UU rows so both render consistently in Stremio / Nuvio.
function buildTorboxRow(candidate, playableUrl) {
  const resolution = detectResolution(candidate.title);
  const sourceTag = detectSource(candidate.title);
  const qualityLine = [resolution, sourceTag].filter(Boolean).join(' ') || 'TorBox';
  const sizeLabel = formatSize(candidate.size);
  const datePart = candidate.publishDate
    ? new Date(candidate.publishDate).toISOString().slice(0, 10) : '';
  const metaLine = [
    sizeLabel ? '\u{1F4BE} ' + sizeLabel : '',
    candidate.indexer || 'TorBox',
    datePart,
  ].filter(Boolean).join(' · ');
  return {
    name: '\u{2601}\u{FE0F} TorBox\n' + qualityLine,
    title: candidate.title + (metaLine ? '\n' + metaLine : ''),
    url: playableUrl,
    behaviorHints: { bingeGroup: 'serioussportsync-torbox', notWebReady: false },
  };
}

// Pipeline A — companion + TorBox.
async function pipelineCompanionTorbox({ promo, event, titles, torboxKey, log }) {
  const companionCfg = settings.getCompanion();
  if (!companionCfg.url) { log('companion: not configured — skipping pipeline A'); return []; }
  if (!torboxKey) { log('torbox: no user key — skipping pipeline A'); return []; }

  // 1. Scrape.
  log('companion: scraping ' + titles.length + ' title variant(s)');
  const candidates = await companion.scrape({ promotion: promo, event, searchTitles: titles, log });
  if (candidates.length === 0) return [];

  // 2. Filter + sort (top N).
  const relevant = filterCandidates('companion', candidates, log, promo, event);
  sortCandidates(relevant, 'size', 'publishDate');
  const top = relevant.slice(0, MAX_ROWS);
  if (top.length === 0) return [];

  // 3. Batch TorBox cache check.
  log('torbox: checking cache for ' + top.length + ' hash(es)');
  const cachedSet = await torbox.checkCachedBatch(top.map((c) => c.infoHash), torboxKey, log);
  log('torbox: ' + cachedSet.size + ' cached / ' + (top.length - cachedSet.size) + ' uncached');
  const cached = top.filter((c) => cachedSet.has(c.infoHash));
  if (cached.length === 0) return [];

  // 4. Resolve each cached hash to a playable URL. Bounded concurrency.
  const rows = [];
  let i = 0;
  async function worker() {
    while (i < cached.length) {
      const myIdx = i++;
      const c = cached[myIdx];
      const magnet = torbox.buildMagnet(c.infoHash, c.magnetTrackers);
      const url = await torbox.resolveCached(c.infoHash, magnet, torboxKey, log);
      if (url) rows[myIdx] = buildTorboxRow(c, url);
    }
  }
  const N = Math.max(1, Math.min(TORBOX_RESOLVE_PARALLEL, cached.length));
  await Promise.all(Array.from({ length: N }, worker));
  // rows[] may be sparse (resolution failures) — compact and return.
  const out = rows.filter(Boolean);
  log('torbox: built ' + out.length + ' resolved row(s)');
  return out;
}

// Pipeline B — Newsnab + Usenet Ultimate (unchanged from 0.31.1).
async function pipelineNewsnabUU({ promo, event, titles, uuConfig, log }) {
  if (!uuConfig) { log('uu: not configured — skipping pipeline B'); return []; }
  log('newsnab: searching ' + titles.length + ' title variant(s)');
  const searchOut = await newsnab.multiSearch(titles, { log });
  if (searchOut.results.length === 0) return [];
  const relevant = filterCandidates('newsnab', searchOut.results, log, promo, event);
  // Newsnab's date field is publishedAt (vs companion's publishDate).
  relevant.sort((a, b) => {
    const rb = resRank(b.title) - resRank(a.title);
    if (rb !== 0) return rb;
    const sb = (Number(b.size) || 0) - (Number(a.size) || 0);
    if (sb !== 0) return sb;
    return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);
  });
  return uu.buildStreamRows(relevant.slice(0, MAX_ROWS), uuConfig, event.name);
}

async function handleStream(params) {
  const log = makeLogger(params);
  const id = params.id;
  if (params.type !== 'movie' || !id || !id.includes(':')) {
    return { streams: [] };
  }

  const data = store.loadFromDisk();
  const event = (data.events || []).find((e) => e.id === id);
  if (!event) { log('no event in store for ' + id); return { streams: [] }; }
  const promo = getByEventId(id);
  if (!promo || typeof promo.searchTitles !== 'function') {
    log('no promotion / no searchTitles for ' + id);
    return { streams: [] };
  }

  const titles = promo.searchTitles(event);
  if (titles.length === 0) {
    log('no searchTitles for ' + id + ' (' + event.name + ')');
    return { streams: [] };
  }

  const userConfig = params.userConfig || {};
  const torboxKey = (userConfig.torboxApiKey || '').trim();
  const uuManifest = (userConfig.uuManifestUrl || '').trim();
  const uuConfig = uuManifest ? uu.parseManifestUrl(uuManifest) : null;

  // Both pipelines run in parallel. Either or both may return zero rows.
  const [torboxRows, uuRows] = await Promise.all([
    pipelineCompanionTorbox({ promo, event, titles, torboxKey, log })
      .catch((err) => { log('pipeline A failed: ' + err.message); return []; }),
    pipelineNewsnabUU({ promo, event, titles, uuConfig, log })
      .catch((err) => { log('pipeline B failed: ' + err.message); return []; }),
  ]);

  // Merge with title-based dedupe (same release surfaced via both backends).
  const seen = new Set();
  const merged = [];
  for (const set of [torboxRows, uuRows]) {
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

// Legacy export — kept so addon.js's old /resolve route still 404s cleanly
// instead of crashing the require chain.
async function resolvePlay() {
  return { ok: false, error: 'debrid-resolution-removed-in-0.30.0' };
}

module.exports = { handleStream, resolvePlay };
