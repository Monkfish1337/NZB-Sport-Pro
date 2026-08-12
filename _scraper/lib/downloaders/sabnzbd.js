// SABnzbd API client.
//
// Used by /api/grab when the operator clicks "SAB" on a general-search row.
// Simpler than qBit — no session, just an API key on each request.
//
// Add by URL:
//   GET <base>/api?mode=addurl&name=<nzb_url>&nzbname=<title>
//       &apikey=<key>&cat=<cat>&output=json
//   Returns { status: true, nzo_ids: [...] } on success.

const fetch = require('node-fetch');
const httpAgent = require('../http-agent');
const log = require('../log-buffer');

const DEFAULT_TIMEOUT_MS = 10000;
function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

// Add an NZB to SAB by URL. Returns { ok, error?, nzoIds? }.
async function addUrl(opts) {
  const cfg = opts && opts.config;
  if (!cfg || !cfg.url) return { ok: false, error: 'sab not configured' };
  if (!cfg.apiKey) return { ok: false, error: 'sab api key not set' };
  if (!opts.url) return { ok: false, error: 'no nzb url provided' };

  const base = trimSlash(cfg.url);
  const category = (opts.category != null ? opts.category : cfg.category) || 'general';

  const params = new URLSearchParams({
    mode: 'addurl',
    name: opts.url,
    apikey: cfg.apiKey,
    output: 'json',
    cat: category,
  });
  if (opts.title) params.append('nzbname', opts.title);

  const url = base + '/api?' + params.toString();
  let res;
  try {
    res = await fetch(url, httpAgent.fetchOpts({
      method: 'GET',
      timeout: DEFAULT_TIMEOUT_MS,
    }, url));
  } catch (err) {
    log.warn('http', 'sab grab error: ' + err.message);
    return { ok: false, error: 'sab: ' + err.message };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: 'sab http ' + res.status + ' ' + body.slice(0, 200) };
  }
  let json;
  try { json = await res.json(); }
  catch (err) { return { ok: false, error: 'sab: json parse: ' + err.message }; }

  if (json && json.status === true) {
    return { ok: true, nzoIds: Array.isArray(json.nzo_ids) ? json.nzo_ids : [] };
  }
  return { ok: false, error: (json && (json.error || json.message)) || 'unknown sab failure' };
}

async function testConnection(cfg) {
  if (!cfg || !cfg.url) return { ok: false, error: 'sab not configured' };
  if (!cfg.apiKey) return { ok: false, error: 'sab api key not set' };
  const base = trimSlash(cfg.url);
  const params = new URLSearchParams({ mode: 'version', apikey: cfg.apiKey, output: 'json' });
  const url = base + '/api?' + params.toString();
  try {
    const res = await fetch(url, httpAgent.fetchOpts({ method: 'GET', timeout: DEFAULT_TIMEOUT_MS }, url));
    if (!res.ok) return { ok: false, error: 'sab http ' + res.status };
    const j = await res.json();
    return { ok: true, version: (j && j.version) || 'unknown' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { addUrl, testConnection };
