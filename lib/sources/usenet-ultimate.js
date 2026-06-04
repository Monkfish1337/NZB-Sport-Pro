// 0.30.0 — Usenet Ultimate URL builder.
//
// Constructs the `/stremio/<config>/nzbdav/stream/...` URL that UU's playback
// endpoint understands. We do NOT call UU's API ourselves; we just produce
// the URL Stremio/Nuvio will hit when the user clicks play. UU then resolves
// the token, submits the NZB to NzbDAV, and serves the playable file.
//
// Token format (reverse-engineered from a working UU stream link):
//   {
//     "sk": "<configHash>:movie::",          // routing key — IMDb portion optional
//     "ty": "movie",                          // type
//     "url": "<NZB download URL from indexer>",
//     "title": "<scene release title>",
//     "indexer": "NZBGeek"
//   }
// Base64-encoded (URL-safe, no padding) into the ?t= query param.
//
// IMDb IDs are optional — UU's Ultimate Text Search mode treats `sk` as an
// analytics key, not a content lookup. Sports events have no IMDb entry, so
// we leave that portion empty.

// Parse a UU manifest URL into the bits we need to construct stream URLs.
//   https://monkfish1337-usenet-ultimate.elfhosted.com/stremio/<config>/manifest.json
//     -> { base: 'https://...elfhosted.com', configHash: '<config>' }
function parseManifestUrl(manifestUrl) {
  if (!manifestUrl || typeof manifestUrl !== 'string') return null;
  // Accept either the manifest URL or the bare config path.
  const m = manifestUrl.match(/^(https?:\/\/[^/]+)\/stremio\/([^/]+)(?:\/manifest\.json)?(?:\?.*)?$/i);
  if (!m) return null;
  return { base: m[1], configHash: m[2] };
}

// Base64-url-encode (no padding, no + or /).
function b64url(s) {
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Build a single stream URL for one NZB result against a user's UU instance.
//   nzb       — a result from lib/sources/newsnab.js (needs .nzbUrl + .title)
//   uu        — { base, configHash } from parseManifestUrl()
//   displayName — human-readable title used in the URL path (just for display)
//   type      — 'movie' | 'series'  (defaults to 'movie')
//   indexer   — indexer label that goes in the token (default 'NZBGeek')
function buildStreamUrl(nzb, uu, displayName, type, indexer) {
  if (!nzb || !nzb.nzbUrl || !uu || !uu.base || !uu.configHash) return null;
  const ty = type || 'movie';
  const tokenObj = {
    sk: uu.configHash + ':' + ty + '::',     // no IMDb component for sports
    ty,
    url: nzb.nzbUrl,
    title: nzb.title || displayName || '',
    indexer: indexer || 'NZBGeek',
  };
  const tokenB64 = b64url(JSON.stringify(tokenObj));
  const titleSeg = encodeURIComponent(displayName || nzb.title || 'stream');
  return uu.base.replace(/\/+$/, '') +
    '/stremio/' + uu.configHash +
    '/nzbdav/stream/' + titleSeg +
    '?t=' + tokenB64;
}

// Build a Stremio stream row from one NZB result. The row shape matches
// what Stremio's stream addon protocol expects: a `url` the client opens,
// plus display fields.
function buildStreamRow(nzb, uu, displayName, options) {
  const opts = options || {};
  const url = buildStreamUrl(nzb, uu, displayName, opts.type, opts.indexer);
  if (!url) return null;
  // Format size for display. NzbDAV files stream on demand, so size is
  // primarily a quality signal here.
  let sizeLabel = '';
  if (nzb.size && nzb.size > 0) {
    if (nzb.size >= 1e9) sizeLabel = (nzb.size / 1e9).toFixed(2) + ' GB';
    else if (nzb.size >= 1e6) sizeLabel = (nzb.size / 1e6).toFixed(0) + ' MB';
  }
  const title = nzb.title || displayName || 'Usenet release';
  const description = [
    sizeLabel,
    nzb.indexer || 'Newsnab',
    nzb.publishedAt ? new Date(nzb.publishedAt).toISOString().slice(0, 10) : null,
  ].filter(Boolean).join(' · ');
  return {
    name: '\u{1F5DE}️ Usenet',   // 🗞️ marker — visually distinguishes from debrid rows
    title,
    description,
    url,
    behaviorHints: {
      bingeGroup: 'usenet-ultimate',
      notWebReady: false,
    },
  };
}

// Build an array of Stremio stream rows from multiple NZB results.
function buildStreamRows(nzbResults, uu, displayName, options) {
  if (!Array.isArray(nzbResults)) return [];
  const out = [];
  for (const nzb of nzbResults) {
    const row = buildStreamRow(nzb, uu, displayName, options);
    if (row) out.push(row);
  }
  return out;
}

module.exports = {
  parseManifestUrl,
  buildStreamUrl,
  buildStreamRow,
  buildStreamRows,
};
