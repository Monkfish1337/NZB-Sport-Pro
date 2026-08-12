// Settings / tool-hub page. Renders runtime config (read-only since it
// comes from env), plus maintenance buttons: clear history, export
// sources.json, import sources.json.

const { layout, escapeHtml } = require('./layout');
const config = require('../config');
const settings = require('../lib/settings');
const history = require('../lib/history');
const log = require('../lib/log-buffer');

function render(req, res) {
  const flash = req.query.flash || '';
  let body = '';
  body += '<h1>Settings</h1>';
  if (flash) {
    body += '<div class="card" style="border-color:var(--accent);"><strong>'
      + escapeHtml(flash) + '</strong></div>';
  }

  // ---------- runtime config (read-only, set via env / compose) ----------
  body += '<div class="card">';
  body += '<h2 style="margin-top:0;">Runtime configuration</h2>';
  body += '<p class="hint">These values come from environment variables (Docker compose / .env). Edit the compose file and restart the container to change them.</p>';
  body += '<table class="t"><tbody>';
  body += '<tr><td>Bind</td><td class="mono">' + escapeHtml(config.host) + ':' + config.port + '</td></tr>';
  body += '<tr><td>Auth token (<code>SCRAPER_AUTH_TOKEN</code>)</td><td>'
    + (config.authToken ? '<span class="pill good">set</span>' : '<span class="pill warn">unset (endpoint open)</span>')
    + '</td></tr>';
  body += '<tr><td>Default source timeout</td><td class="mono">' + config.defaultSourceTimeoutMs + 'ms</td></tr>';
  body += '<tr><td>Scrape budget</td><td class="mono">' + config.scrapeBudgetMs + 'ms</td></tr>';
  body += '<tr><td>Log buffer size</td><td class="mono">' + config.logBufferMax + ' lines</td></tr>';
  body += '<tr><td>History size</td><td class="mono">' + config.historyMax + ' calls</td></tr>';
  body += '<tr><td>HTTPS_PROXY</td><td class="mono">' + escapeHtml(config.httpsProxy || '(direct)') + '</td></tr>';
  body += '<tr><td>NO_PROXY</td><td class="mono">' + escapeHtml((config.noProxy || []).join(', ') || '(none)') + '</td></tr>';
  body += '<tr><td>Data dir</td><td class="mono">' + escapeHtml(config.dataDir) + '</td></tr>';
  body += '</tbody></table>';
  body += '</div>';

  // ---------- maintenance ----------
  body += '<div class="card">';
  body += '<h2 style="margin-top:0;">Maintenance</h2>';
  body += '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">';
  body += '<form method="POST" action="/settings/clear-history" onsubmit="return confirm(\'Clear all scrape history?\');" style="display:inline;">'
    + '<button class="btn-danger">Clear /scrape history</button></form>';
  body += '<form method="POST" action="/settings/clear-logs" onsubmit="return confirm(\'Clear in-memory log buffer?\');" style="display:inline;">'
    + '<button class="btn-danger">Clear log buffer</button></form>';
  body += '<a class="btn btn-ghost" href="/settings/export-sources" download="sources.json">Export sources.json</a>';
  body += '</div>';

  body += '<h3 style="margin-top:20px;">Import sources.json</h3>';
  body += '<p class="hint">Paste a previously-exported <code>sources.json</code> below to overwrite the current source list.</p>';
  body += '<form method="POST" action="/settings/import-sources" onsubmit="return confirm(\'Replace ALL configured sources with the JSON below?\');">';
  body += '<textarea name="json" rows="8" class="inp mono" placeholder=\'[{"id":"...","type":"prowlarr","name":"Prowlarr","enabled":true,"config":{...}}]\'></textarea>';
  body += '<div style="margin-top:10px;"><button class="btn-danger">Replace sources</button></div>';
  body += '</form>';
  body += '</div>';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(layout(req, { title: 'Settings', body, active: 'settings' }));
}

function clearHistory(req, res) {
  history.clear();
  log.info('system', 'history cleared');
  res.redirect('/settings?flash=' + encodeURIComponent('History cleared.'));
}

function clearLogs(req, res) {
  log.clear && log.clear();
  log.info('system', 'log buffer cleared');
  res.redirect('/settings?flash=' + encodeURIComponent('Log buffer cleared.'));
}

function exportSources(req, res) {
  const sources = settings.listSources();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="sources.json"');
  res.send(JSON.stringify(sources, null, 2));
}

function importSources(req, res) {
  const raw = String((req.body && req.body.json) || '').trim();
  if (!raw) return res.redirect('/settings?flash=' + encodeURIComponent('Nothing to import.'));
  let parsed;
  try {
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('expected an array');
  } catch (err) {
    return res.redirect('/settings?flash=' + encodeURIComponent('Invalid JSON: ' + err.message));
  }
  try {
    settings.replaceAll(parsed);
    log.info('system', 'sources imported: ' + parsed.length + ' entries');
    res.redirect('/settings?flash=' + encodeURIComponent('Imported ' + parsed.length + ' source(s).'));
  } catch (err) {
    res.redirect('/settings?flash=' + encodeURIComponent('Import failed: ' + err.message));
  }
}

module.exports = { render, clearHistory, clearLogs, exportSources, importSources };
