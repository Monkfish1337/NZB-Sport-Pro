// Generic Torznab source — talks directly to one indexer's Torznab feed.
//
// Useful for operators who want to query a single specific tracker without
// the Prowlarr aggregation layer (faster, less hop chain). The operator
// adds one of these per indexer they care about.
//
// Torznab is XML-only by spec (it's an RSS extension). We parse with a
// minimal regex extractor — same approach as the metadata addon's
// Newznab XML parser since the wire format is identical.

const fetch = require('node-fetch');
const httpAgent = require('../http-agent');

function normHash(h) {
  if (!h || typeof h !== 'string') return '';
  return /^[A-Fa-f0-9]{40}$/.test(h) ? h.toLowerCase() : '';
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
  const re = /<(?:torznab:|newznab:)attr\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi;
  const out = {};
  let m;
  while ((m = re.exec(xml))) out[m[1].toLowerCase()] = m[2];
  return out;
}
function extractEnclosureLength(itemXml) {
  const m = itemXml.match(/<enclosure\b[^>]*length="(\d+)"/i);
  return m ? Number(m[1]) || 0 : 0;
}
function extractMagnetTrackers(magnetUrl) {
  if (!magnetUrl) return [];
  const out = [];
  const re = /[?&]tr=([^&]+)/g;
  let m;
  while ((m = re.exec(magnetUrl))) {
    try { out.push(decodeURIComponent(m[1])); } catch (_) { out.push(m[1]); }
  }
  return out;
}

async function singleSearch(query, sourceConfig, log) {
  if (!sourceConfig.url) return [];
  const base = sourceConfig.url.replace(/\/+$/, '');
  const params = new URLSearchParams({
    t: 'search',
    apikey: sourceConfig.apiKey || '',
    q: query,
    limit: String(sourceConfig.limit || 100),
  });
  const cats = (sourceConfig.categories || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (cats.length) params.set('cat', cats.join(','));
  const path = sourceConfig.apiPath || '/api';
  const url = base + path + '?' + params.toString();
  let res;
  try {
    res = await fetch(url, httpAgent.fetchOpts({
      headers: { Accept: 'application/rss+xml, application/xml' },
      timeout: sourceConfig.timeoutMs || 12000,
    }, url));
  } catch (err) { log.error('source', 'torznab network error: ' + err.message); return []; }
  if (!res.ok) { log.warn('source', 'torznab HTTP ' + res.status); return []; }
  let xml = '';
  try { xml = await res.text(); }
  catch (err) { log.warn('source', 'torznab read error: ' + err.message); return []; }

  const out = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const inner = m[1];
    const attrs = extractAttrs(inner);
    const title = cdataOrText(extractTag(inner, 'title')) || '';
    const link  = cdataOrText(extractTag(inner, 'link'))  || '';
    const seeders = Number(attrs.seeders || 0) || 0;
    const size = Number(attrs.size || extractEnclosureLength(inner) || 0) || 0;
    const magnetUrl = attrs.magneturl || link || '';
    let hash = normHash(attrs.infohash);
    if (!hash) {
      const mh = magnetUrl.match(/urn:btih:([A-Fa-f0-9]{40})/i);
      if (mh) hash = mh[1].toLowerCase();
    }
    if (!hash) continue;
    out.push({
      infoHash: hash,
      title,
      size,
      seeders,
      indexer: sourceConfig.label || 'Torznab',
      magnetTrackers: extractMagnetTrackers(magnetUrl),
      publishDate: cdataOrText(extractTag(inner, 'pubDate')),
    });
  }
  return out;
}

async function multiSearch(queries, sourceConfig, log) {
  const seen = new Set();
  const out = [];
  for (const q of queries) {
    log.info('source', (sourceConfig.label || 'torznab') + ' query "' + q + '"');
    const results = await singleSearch(q, sourceConfig, log);
    log.info('source', '  -> ' + results.length + ' hits');
    for (const r of results) {
      if (seen.has(r.infoHash)) continue;
      seen.add(r.infoHash);
      out.push(r);
    }
  }
  return out;
}

async function test(sourceConfig, log) {
  if (!sourceConfig.url || !sourceConfig.apiKey) {
    return { ok: false, message: 'URL or API key not configured' };
  }
  const start = Date.now();
  try {
    // t=caps is the Torznab capabilities call — cheap and tells us the
    // indexer is reachable + the API key is accepted.
    const url = sourceConfig.url.replace(/\/+$/, '')
      + (sourceConfig.apiPath || '/api')
      + '?t=caps&apikey=' + encodeURIComponent(sourceConfig.apiKey);
    const res = await fetch(url, httpAgent.fetchOpts({ timeout: 6000 }, url));
    const latencyMs = Date.now() - start;
    if (!res.ok) return { ok: false, latencyMs, message: 'HTTP ' + res.status };
    return { ok: true, latencyMs, message: 'Torznab caps reachable' };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, message: err.message };
  }
}

module.exports = {
  type: 'torznab',
  label: 'Torznab (direct)',
  description: 'Direct Torznab feed for a single indexer — bypass Prowlarr.',
  schema: [
    { name: 'label',      label: 'Display name', type: 'text', required: true,
      placeholder: 'e.g. MagnetDL', hint: 'How this source appears in the GUI and on results.' },
    { name: 'url',        label: 'Base URL',     type: 'url',  required: true,
      placeholder: 'https://example.indexer/torznab' },
    { name: 'apiKey',     label: 'API key',      type: 'secret', required: true },
    { name: 'apiPath',    label: 'API path',     type: 'text',
      default: '/api', hint: 'Usually /api; sometimes /torznab/api.' },
    { name: 'categories', label: 'Categories',   type: 'csv',
      placeholder: '5070,5080', hint: 'Optional. Comma-separated indexer-specific category IDs.' },
    { name: 'limit',      label: 'Limit per query', type: 'number', default: 100 },
    { name: 'timeoutMs',  label: 'Timeout (ms)', type: 'number', default: 12000 },
  ],
  multiSearch,
  test,
};
