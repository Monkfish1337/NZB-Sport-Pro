// HTTP proxy-aware fetch options.
//
// If HTTPS_PROXY is set (e.g. http://gluetun:8888), outbound requests
// route through it — except hosts listed in NO_PROXY (e.g. localhost,
// the local Prowlarr instance, etc).

const { HttpsProxyAgent } = require('https-proxy-agent');
const config = require('../config');
const log = require('./log-buffer');

let agent = null;
if (config.httpsProxy) {
  agent = new HttpsProxyAgent(config.httpsProxy);
  log.info('system', 'outbound HTTP routed via proxy: ' + config.httpsProxy
    + ' (bypass: ' + config.noProxy.join(',') + ')');
}

function shouldBypass(url) {
  if (!url || !agent) return true;
  try {
    const u = new URL(url);
    const host = u.hostname;
    for (const skip of config.noProxy) {
      if (!skip) continue;
      if (host === skip || host.endsWith('.' + skip)) return true;
    }
    return false;
  } catch (_) { return false; }
}

function fetchOpts(extra, url) {
  const out = Object.assign({}, extra || {});
  if (agent && !shouldBypass(url)) out.agent = agent;
  return out;
}

module.exports = { fetchOpts };
