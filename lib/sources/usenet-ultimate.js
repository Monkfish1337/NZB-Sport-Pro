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

// Pull the visible resolution token (4K/2160p/1080p/720p/480p) from a release
// title so we can surface it as the second line of `name` for quick scanning.
function detectResolution(t) {
  if (!t) return '';
  if (/\b(2160p|4k|uhd)\b/i.test(t)) return '2160p';
  if (/\b1080p|fhd\b/i.test(t)) return '1080p';
  if (/\b720p\b/i.test(t)) return '720p';
  if (/\b480p|sd\b/i.test(t)) return '480p';
  return '';
}

// Pull a codec/source token (WEB-DL / WEB / HDTV / BluRay / WEBRip) for the
// quality line. Optional sugar — defaults to empty if nothing recognisable.
function detectSource(t) {
  if (!t) return '';
  if (/\bWEB[\s._-]*DL\b/i.test(t)) return 'WEB-DL';
  if (/\bWEBRip\b/i.test(t)) return 'WEBRip';
  if (/\bWEB\b/i.test(t)) return 'WEB';
  if (/\bHDTV\b/i.test(t)) return 'HDTV';
  if (/\bBluRay\b/i.test(t)) return 'BluRay';
  return '';
}

// Format bytes as "X.YZ GB" / "X MB" for display.
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return Math.round(bytes / 1e6) + ' MB';
  return '';
}

// 0.38.1: Subtitle-language detector.
//
// Sources searched, in order of confidence:
//   1. nzb.attrs.subs     (e.g. "english", "english,spanish") — when Newsnab
//                          exposes it. NZBgeek does. Some don't.
//   2. release title      — looks for tokens like "ENG SUB", "MULTI SUBS",
//                          "SUB ESP", "SUBS:EN/ES", standalone ISO codes
//                          (EN, ES, FR, DE, IT, PT, RU) flagged as subs.
//
// Returns a small array of human-friendly language labels (e.g. ['ENG'],
// ['ENG','ESP'], ['MULTI']). UI uses this as a hint only — we don't serve
// .srt files (Stremio's subtitles field needs URLs we don't have; UU extracts
// any embedded subs at playback time).
function detectSubtitleLanguages(nzb) {
  const out = new Set();

  // 1. Explicit attrs.subs (Newznab/Torznab extension)
  const attrs = nzb && nzb.attrs;
  if (attrs && attrs.subs) {
    const raw = String(attrs.subs).toUpperCase();
    raw.split(/[,;|/+ ]+/).filter(Boolean).forEach((token) => {
      const code = token.slice(0, 3);
      if (code) out.add(code);
    });
  }

  // 2. Title-based detection. Look for explicit "SUB" markers + nearby
  //    language tokens. Avoid false-positives on common scene tokens (SUBS
  //    inside a release group name etc.).
  const title = String((nzb && nzb.title) || '');
  const upper = title.toUpperCase();
  // MULTI / MULTi suffix is a common shorthand for many subs / dub variants.
  if (/\bMULTI\b/i.test(title)) out.add('MULTI');
  // "ENG SUB" / "ENGLISH SUBS" / "SUBS:EN" patterns.
  const patterns = [
    [/\bENG(?:LISH)?\s*SUB(?:S|TITLES?)?\b/i, 'ENG'],
    [/\bSUB(?:S)?\s*(?:[-:]\s*)?ENG?\b/i, 'ENG'],
    [/\bES(?:PA[NÑ]OL)?\s*SUB(?:S|TITLES?)?\b/i, 'ESP'],
    [/\bSUB(?:S)?\s*(?:[-:]\s*)?ESP?\b/i, 'ESP'],
    [/\bFR(?:ENCH|ANCAIS)?\s*SUB(?:S|TITLES?)?\b/i, 'FRA'],
    [/\bGER(?:MAN)?\s*SUB(?:S|TITLES?)?\b/i, 'GER'],
    [/\bIT(?:ALIAN(?:O)?)?\s*SUB(?:S|TITLES?)?\b/i, 'ITA'],
    [/\bPT[- ]?BR\s*SUB(?:S|TITLES?)?\b/i, 'POR'],
  ];
  patterns.forEach(([re, lang]) => { if (re.test(upper)) out.add(lang); });

  return Array.from(out).slice(0, 4);
}

// Build a Stremio stream row from one NZB result.
//
// Layout convention — same as Torrentio / Comet, two newline-joined strings:
//   name  = "🗞️ Usenet\n<resolution> <source>"      (e.g. "🗞️ Usenet\n1080p WEB")
//   title = "<release.title>\n💾 <size> · 📝 <subs> · <indexer> · <date>"
// Nuvio shows `name` as the big header and `title` as the secondary block;
// Stremio Web/Desktop renders both fields concatenated. Newlines keep the
// per-field text scannable on both.
function buildStreamRow(nzb, uu, displayName, options) {
  const opts = options || {};
  const url = buildStreamUrl(nzb, uu, displayName, opts.type, opts.indexer);
  if (!url) return null;
  const sizeLabel = formatSize(nzb.size);
  const resolution = detectResolution(nzb.title);
  const sourceTag = detectSource(nzb.title);
  const qualityLine = [resolution, sourceTag].filter(Boolean).join(' ') || 'Usenet';
  const datePart = nzb.publishedAt ? new Date(nzb.publishedAt).toISOString().slice(0, 10) : '';
  // 0.38.1: surface detected subtitle languages as a meta hint.
  const subs = detectSubtitleLanguages(nzb);
  const subsLabel = subs.length ? '\u{1F4DD} ' + subs.join('/') : '';      // 📝 ENG/ESP
  const metaLine = [
    sizeLabel ? '\u{1F4BE} ' + sizeLabel : '',   // 💾
    subsLabel,
    nzb.indexer || 'Newsnab',
    datePart,
  ].filter(Boolean).join(' · ');             //  ·
  const releaseTitle = nzb.title || displayName || 'Usenet release';
  return {
    name: '\u{1F5DE}\u{FE0F} Usenet\n' + qualityLine,                 // 🗞️ Usenet\n1080p WEB
    title: releaseTitle + (metaLine ? '\n' + metaLine : ''),
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

// 0.42.9 — Text-search playback row (per GitHub README).
//
// SSS builds a UU handoff URL embedding just the search title (no pre-found
// NZB URL). UU's Ultimate Text Search picks the best match and streams it via
// NzbDAV when the user presses play. UU does the whole search + play dance
// itself — SSS never touches indexers directly.
//
// The token structure mirrors buildStreamUrl but leaves `url` blank so UU
// knows to text-search by title instead of playing a specific NZB.
function buildSearchStreamRow(searchTitle, uuConfig, displayName, options) {
  const opts = options || {};
  if (!searchTitle || !uuConfig || !uuConfig.base || !uuConfig.configHash) return null;
  const ty = opts.type || 'movie';
  const tokenObj = {
    sk: uuConfig.configHash + ':' + ty + '::',
    ty,
    url: '',                             // empty → UU text-searches by title
    title: String(searchTitle).trim(),
    indexer: opts.indexer || 'UltimateTextSearch',
  };
  const tokenB64 = b64url(JSON.stringify(tokenObj));
  const titleSeg = encodeURIComponent(displayName || searchTitle);
  const url = uuConfig.base.replace(/\/+$/, '') +
    '/stremio/' + uuConfig.configHash +
    '/nzbdav/stream/' + titleSeg +
    '?t=' + tokenB64;
  return {
    name: '\u{1F5DE}\u{FE0F} Usenet Ultimate\nSearch',
    title: (displayName || searchTitle) + '\n\u{1F50D} ' + searchTitle,
    url,
    behaviorHints: {
      bingeGroup: 'usenet-ultimate',
      notWebReady: false,
    },
  };
}

// Build one search row per unique title variant. UU handles dedup + ranking
// internally when the user presses play, so we just emit rows // internally when the user presses play, so we just emit rows and let UU pick.
function buildSearchStreamRows(searchTitles, uuConfig, displayName, options) {
  if (!Array.isArray(searchTitles)) return [];
  const seen = new Set();
  const out = [];
  for (const t of searchTitles) {
    const s = String(t || '').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const row = buildSearchStreamRow(s, uuConfig, displayName, options);
    if (row) out.push(row);
  }
  return out;
}

module.exports = {
  parseManifestUrl,
  buildStreamUrl,
  detectSubtitleLanguages,
  buildStreamRow,
  buildStreamRows,
  buildSearchStreamRow,
  buildSearchStreamRows,
};
