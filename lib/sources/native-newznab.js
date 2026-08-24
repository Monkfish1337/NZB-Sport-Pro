// Experimental per-user Newznab discovery for the hosted SSS architecture.
//
// The stable UU pipeline remains untouched. This module queries only indexers
// explicitly configured by the current user, normalises their RSS results,
// and keeps credential-bearing NZB links in a short-lived in-memory store.
// Stream rows receive only an opaque random token; API keys and download URLs
// are never returned to Stremio/Nuvio.

const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const fetch = require('node-fetch');
const httpAgent = require('../http-agent');
const { redact } = require('../redact');

const MAX_INDEXERS = 5;
const MAX_RESULTS_PER_QUERY = 100;
const MAX_SEARCH_BYTES = Math.max(64 * 1024,
  parseInt(process.env.NATIVE_NEWZNAB_MAX_SEARCH_BYTES || String(3 * 1024 * 1024), 10));
const MAX_NZB_BYTES = Math.max(256 * 1024,
  parseInt(process.env.NATIVE_NEWZNAB_MAX_NZB_BYTES || String(10 * 1024 * 1024), 10));
const CANDIDATE_TTL_MS = Math.max(5 * 60 * 1000,
  parseInt(process.env.NATIVE_NEWZNAB_CANDIDATE_TTL_MINUTES || '240', 10) * 60 * 1000);
const CANDIDATE_MAX = Math.max(100, parseInt(process.env.NATIVE_NEWZNAB_CANDIDATE_MAX || '5000', 10));
const ALLOW_PRIVATE = /^(1|true|yes|on)$/i.test(String(process.env.NATIVE_NEWZNAB_ALLOW_PRIVATE || ''));
const ALLOW_HTTP = /^(1|true|yes|on)$/i.test(String(process.env.NATIVE_NEWZNAB_ALLOW_HTTP || ''));
const DEFAULT_MAX_QUERIES = Math.max(1,
  Math.min(12, parseInt(process.env.NATIVE_NEWZNAB_MAX_QUERIES || '4', 10)));

const candidates = new Map(); // token -> { userId, eventId, result, expiresAt }

function privateIpv4(address) {
  const p = String(address).split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 10
    || p[0] === 127
    || p[0] === 0
    || (p[0] === 169 && p[1] === 254)
    || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    || (p[0] === 192 && p[1] === 168)
    || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    || p[0] >= 224;
}

function privateIp(address) {
  const kind = net.isIP(address);
  if (kind === 4) return privateIpv4(address);
  if (kind !== 6) return true;
  const value = String(address).toLowerCase();
  if (value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd')
      || /^fe[89ab]/.test(value)) return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? privateIpv4(mapped[1]) : false;
}

function validateEndpoint(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || '').trim()); }
  catch (_) { throw new Error('Newznab URL must be a valid absolute URL'); }
  if (url.protocol !== 'https:' && !(ALLOW_HTTP && url.protocol === 'http:')) {
    throw new Error('Newznab URL must use HTTPS');
  }
  if (url.username || url.password) throw new Error('Newznab URL must not contain basic-auth credentials');
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    if (!ALLOW_PRIVATE) throw new Error('Private/local Newznab hosts are disabled');
  }
  if (net.isIP(host) && privateIp(host) && !ALLOW_PRIVATE) {
    throw new Error('Private/local Newznab addresses are disabled');
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/api';
  return url.toString().replace(/\/+$/, '');
}

function normalizeIndexerConfig(value, index) {
  const item = value || {};
  const url = validateEndpoint(item.url);
  const apiKey = String(item.apiKey || '').trim();
  if (!apiKey) throw new Error('Newznab API key is required');
  const parsed = new URL(url);
  const name = String(item.name || '').trim().slice(0, 60) || parsed.hostname;
  return { name, url, apiKey, order: Number(index) || 0 };
}

function normalizeIndexerConfigs(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const [index, raw] of values.slice(0, MAX_INDEXERS).entries()) {
    const item = raw || {};
    if (!String(item.url || '').trim() && !String(item.apiKey || '').trim()
        && !String(item.name || '').trim()) continue;
    out.push(normalizeIndexerConfig(item, index));
  }
  return out;
}

function keyFingerprint(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 24);
}

function candidateStillConfigured(candidate, indexers) {
  if (!candidate || !candidate.indexerUrl || !candidate.indexerKeyFingerprint) return false;
  let current;
  try { current = normalizeIndexerConfigs(indexers); } catch (_) { return false; }
  return current.some((indexer) => indexer.url === candidate.indexerUrl
    && keyFingerprint(indexer.apiKey) === candidate.indexerKeyFingerprint);
}

async function assertPublicHost(urlValue) {
  if (ALLOW_PRIVATE) return;
  const host = new URL(urlValue).hostname;
  if (net.isIP(host)) {
    if (privateIp(host)) throw new Error('private-address-blocked');
    return;
  }
  const resolved = await dns.lookup(host, { all: true, verbatim: true });
  if (!resolved.length || resolved.some((entry) => privateIp(entry.address))) {
    throw new Error('private-address-blocked');
  }
}

function decodeXml(value) {
  const input = String(value || '').replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, '$1');
  return input.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, entity) => {
    const e = entity.toLowerCase();
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : all;
  }).trim();
}

function tagText(xml, tag) {
  const escaped = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml).match(new RegExp('<' + escaped + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + escaped + '>', 'i'));
  return match ? decodeXml(match[1]) : '';
}

function parseAttributes(fragment) {
  const out = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(String(fragment || '')))) {
    out[match[1].toLowerCase()] = decodeXml(match[2] !== undefined ? match[2] : match[3]);
  }
  return out;
}

function safeResultLink(raw, endpoint) {
  if (!raw) return '';
  let link;
  try { link = new URL(decodeXml(raw), endpoint); }
  catch (_) { return ''; }
  const base = new URL(endpoint);
  if (link.protocol !== base.protocol || link.hostname.toLowerCase() !== base.hostname.toLowerCase()) return '';
  if (link.username || link.password) return '';
  return link.toString();
}

function parseNewznabXml(xml, indexer) {
  const text = String(xml || '');
  const errorMatch = text.match(/<error\b([^>]*)\/?\s*>/i);
  if (errorMatch) {
    const attrs = parseAttributes(errorMatch[1]);
    throw new Error('indexer-error-' + String(attrs.code || 'unknown'));
  }
  const items = text.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  const results = [];
  for (const item of items) {
    const attrs = {};
    const attrRe = /<(?:newznab|torznab|nzbhydra):attrs?\b([^>]*)\/?\s*>/gi;
    let attrMatch;
    while ((attrMatch = attrRe.exec(item))) {
      const a = parseAttributes(attrMatch[1]);
      if (a.name && a.value !== undefined && attrs[a.name.toLowerCase()] === undefined) {
        attrs[a.name.toLowerCase()] = a.value;
      }
    }
    const enclosure = item.match(/<enclosure\b([^>]*)\/?\s*>/i);
    const enclosureAttrs = enclosure ? parseAttributes(enclosure[1]) : {};
    const rawLink = tagText(item, 'link') || enclosureAttrs.url || tagText(item, 'guid');
    const nzbUrl = safeResultLink(rawLink, indexer.url);
    const title = tagText(item, 'title');
    if (!title || !nzbUrl) continue;
    results.push({
      title,
      nzbUrl,
      size: Number(attrs.size || enclosureAttrs.length || 0) || 0,
      publishedAt: tagText(item, 'pubDate') || null,
      indexer: indexer.name,
      indexerUrl: indexer.url,
      indexerKeyFingerprint: keyFingerprint(indexer.apiKey),
      attrs,
      guid: tagText(item, 'guid') || '',
    });
  }
  return results;
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers && response.headers.get('content-length')) || 0;
  if (declared > maxBytes) throw new Error('response-too-large');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      if (response.body && typeof response.body.destroy === 'function') response.body.destroy();
      throw new Error('response-too-large');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}

async function safeFetch(url, options) {
  const opts = options || {};
  const baseHost = new URL(url).hostname.toLowerCase();
  let current = url;
  for (let redirect = 0; redirect <= 2; redirect += 1) {
    await assertPublicHost(current);
    const response = await (opts.fetchImpl || fetch)(current, httpAgent.fetchOpts({
      headers: opts.headers || { Accept: 'application/rss+xml, application/xml, text/xml' },
      timeout: Number(opts.timeoutMs || 7000),
      redirect: 'manual',
    }, current));
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers && response.headers.get('location');
    if (!location) throw new Error('redirect-without-location');
    const next = new URL(location, current);
    if (next.hostname.toLowerCase() !== baseHost || next.protocol !== new URL(url).protocol) {
      throw new Error('cross-host-redirect-blocked');
    }
    current = next.toString();
  }
  throw new Error('too-many-redirects');
}

function buildSearchUrl(indexer, query) {
  const url = new URL(indexer.url);
  url.searchParams.set('t', 'search');
  url.searchParams.set('q', String(query || '').trim());
  url.searchParams.set('apikey', indexer.apiKey);
  url.searchParams.set('extended', '1');
  url.searchParams.set('limit', String(MAX_RESULTS_PER_QUERY));
  return url.toString();
}

async function searchOne(indexer, query, options) {
  const opts = options || {};
  const log = opts.log || (() => {});
  const url = buildSearchUrl(indexer, query);
  try {
    const response = await safeFetch(url, opts);
    if (!response.ok) {
      log('  native-newznab ' + indexer.name + ': HTTP ' + response.status);
      return [];
    }
    const body = await readLimited(response, MAX_SEARCH_BYTES);
    const results = parseNewznabXml(body.toString('utf8'), indexer);
    log('  native-newznab ' + indexer.name + ': ' + results.length + ' result(s)');
    return results;
  } catch (err) {
    log('  native-newznab ' + indexer.name + ': ' + redact(err.message));
    return [];
  }
}

async function multiSearch(searchTitles, indexers, options) {
  const opts = options || {};
  const log = opts.log || (() => {});
  const requestedMax = parseInt(opts.maxQueries, 10);
  const maxQueries = Math.max(1, Math.min(DEFAULT_MAX_QUERIES,
    Number.isFinite(requestedMax) && requestedMax > 0 ? requestedMax : DEFAULT_MAX_QUERIES));
  const queries = Array.from(new Set((searchTitles || [])
    .map((title) => String(title || '').trim()).filter(Boolean))).slice(0, maxQueries);
  const cleanIndexers = normalizeIndexerConfigs(indexers);
  if (!queries.length || !cleanIndexers.length) return [];
  log('native-newznab: searching ' + queries.length + ' title variant(s) across '
    + cleanIndexers.length + ' user indexer(s)');
  const tasks = [];
  for (const indexer of cleanIndexers) {
    for (const query of queries) tasks.push(() => searchOne(indexer, query, opts));
  }
  const lists = [];
  const concurrency = Math.max(1, Math.min(12, parseInt(opts.concurrency, 10) || 8));
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      lists[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  const byKey = new Map();
  for (const list of lists) {
    for (const result of (list || [])) {
      const key = (result.guid || '') + '|' + result.title.toLowerCase() + '|' + result.size;
      if (!byKey.has(key)) byKey.set(key, result);
    }
  }
  const out = Array.from(byKey.values());
  log('native-newznab: ' + out.length + ' unique candidate(s)');
  return out;
}

function pruneCandidates() {
  const now = Date.now();
  for (const [key, entry] of candidates) {
    if (entry.expiresAt <= now) candidates.delete(key);
  }
  while (candidates.size >= CANDIDATE_MAX) {
    const oldest = candidates.keys().next().value;
    if (!oldest) break;
    candidates.delete(oldest);
  }
}

function storeCandidate(userId, eventId, result) {
  pruneCandidates();
  const token = crypto.randomBytes(20).toString('hex');
  candidates.set(token, {
    userId: String(userId || ''),
    eventId: String(eventId || ''),
    result: Object.assign({}, result),
    expiresAt: Date.now() + CANDIDATE_TTL_MS,
  });
  return token;
}

function getCandidate(token, userId, eventId) {
  const key = String(token || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(key)) return null;
  const entry = candidates.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { candidates.delete(key); return null; }
  if (entry.userId !== String(userId || '') || entry.eventId !== String(eventId || '')) return null;
  return Object.assign({}, entry.result);
}

async function fetchNzb(candidate, options) {
  if (!candidate || !candidate.nzbUrl) throw new Error('candidate-not-found');
  const response = await safeFetch(candidate.nzbUrl, Object.assign({}, options, {
    headers: { Accept: 'application/x-nzb, application/xml, text/xml, application/octet-stream' },
    timeoutMs: (options && options.timeoutMs) || 10000,
  }));
  if (!response.ok) throw new Error('nzb-http-' + response.status);
  const body = await readLimited(response, MAX_NZB_BYTES);
  const prefix = body.subarray(0, Math.min(body.length, 2048)).toString('utf8');
  if (!/<nzb\b/i.test(prefix) && !/<\?xml\b/i.test(prefix)) throw new Error('invalid-nzb-response');
  return body;
}

module.exports = {
  MAX_INDEXERS,
  validateEndpoint,
  normalizeIndexerConfig,
  normalizeIndexerConfigs,
  keyFingerprint,
  candidateStillConfigured,
  buildSearchUrl,
  parseNewznabXml,
  multiSearch,
  storeCandidate,
  getCandidate,
  fetchNzb,
  _test: { candidates, decodeXml, privateIp, safeResultLink, readLimited },
};
