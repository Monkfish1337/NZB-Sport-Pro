// 0.31.0 — TorBox Usenet integration.
//
// TorBox runs a public Newznab-compatible search endpoint at
//   https://search-api.torbox.app/newznab/api?apikey=<key>&t=search&q=<query>
// which is a drop-in for any Newznab indexer. We don't need a separate HTTP
// client — `lib/sources/newsnab.js` already handles the wire format. This
// module just provides:
//   1. `newsnabConfig(apiKey)` — the {url, apiKey, categories} shape that
//      `newsnab.search(query, { config })` consumes.
//   2. `buildStreamRow(nzb, displayName)` — Stremio row using the link that
//      TorBox's response includes (their CDN-streamable download URL),
//      so no NzbDAV bridge is needed.
//
// User config: per-user `torboxApiKey` on /account. If set, /stream uses
// TorBox both as the indexer AND as the playback backend. Decoupled from
// the UU path; users can configure either or both.

// TorBox namespaces their Newznab + Torznab endpoints under `/newznab` and
// `/torznab` rather than serving them at the API root. The Newsnab client
// appends `/api?...` to the base URL we pass in, so the base must end at
// the `/newznab` segment to produce the correct `/newznab/api?...` URL.
const TORBOX_NEWZNAB_BASE = 'https://search-api.torbox.app/newznab';

// Drop-in config object for newsnab.search() / newsnab.multiSearch().
// Categories match the defaults we use elsewhere (TV-Other + TV-Sport + Other).
function newsnabConfig(apiKey) {
  return {
    url: TORBOX_NEWZNAB_BASE,
    apiKey,
    categories: ['5000', '5080', '8000'],
  };
}

// Per-call options tuned for TorBox's search-api throttle. Their search
// endpoint is more restrictive than the main API's 300/min, so we space
// queries more generously and give the 429 backoff longer to clear.
function searchOptions() {
  return {
    queryDelayMs: 3000,
    rateLimitBackoffMs: 8000,
  };
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

// Build a Stremio stream row from a TorBox-sourced NZB result. The `nzbUrl`
// field (from the Newznab response's <link>) already points at TorBox's
// CDN-streamable endpoint — no bridge needed. UU users get a similar shape
// from `lib/sources/usenet-ultimate.js`; the difference is just the URL.
function buildStreamRow(nzb, displayName) {
  if (!nzb || !nzb.nzbUrl) return null;
  const sizeLabel = formatSize(nzb.size);
  const resolution = detectResolution(nzb.title);
  const sourceTag = detectSource(nzb.title);
  const qualityLine = [resolution, sourceTag].filter(Boolean).join(' ') || 'Usenet';
  const datePart = nzb.publishedAt ? new Date(nzb.publishedAt).toISOString().slice(0, 10) : '';
  const metaLine = [
    sizeLabel ? '\u{1F4BE} ' + sizeLabel : '',   // 💾
    'TorBox',
    datePart,
  ].filter(Boolean).join(' · ');
  const releaseTitle = nzb.title || displayName || 'Usenet release';
  return {
    name: '\u{2601}\u{FE0F} TorBox\n' + qualityLine,          // ☁️ TorBox\n1080p WEB
    title: releaseTitle + (metaLine ? '\n' + metaLine : ''),
    url: nzb.nzbUrl,
    behaviorHints: {
      bingeGroup: 'torbox-usenet',
      notWebReady: false,
    },
  };
}

function buildStreamRows(nzbResults, displayName) {
  if (!Array.isArray(nzbResults)) return [];
  const out = [];
  for (const nzb of nzbResults) {
    const row = buildStreamRow(nzb, displayName);
    if (row) out.push(row);
  }
  return out;
}

module.exports = { newsnabConfig, searchOptions, buildStreamRow, buildStreamRows };
