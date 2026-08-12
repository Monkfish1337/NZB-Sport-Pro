// Manual search probe. Operator enters one title (or several, one per line)
// and gets per-source results side-by-side. Useful for debugging
// "why did this event come back thin" without driving the metadata addon.

const { layout, escapeHtml } = require('./layout');
const settings = require('../lib/settings');
const registry = require('../lib/sources/registry');
const log = require('../lib/log-buffer');

function fmtBytes(n) {
  if (!n) return '';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return Math.round(n / 1e6) + ' MB';
  return n + ' B';
}

function render(req, res) {
  const sources = settings.enabledSources();
  let body = '';
  body += '<h1>Search probe</h1>';
  body += '<p class="hint">Run search titles directly against every enabled source. No filtering, no merging — raw per-source results.</p>';

  body += '<form method="POST" action="/search">';
  body += '<div class="card">';
  body += '<label class="lbl" for="titles">Search titles (one per line)</label>';
  body += '<textarea id="titles" name="titles" rows="4" class="inp mono" placeholder="UFC 291&#10;F1 2026 Canada Race">'
    + escapeHtml(req.body && req.body.titles || '') + '</textarea>';
  body += '<div class="hint">' + sources.length + ' enabled source(s) will be queried in parallel.</div>';
  body += '<div style="margin-top:14px;"><button class="btn">Run probe</button></div>';
  body += '</div>';
  body += '</form>';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(layout(req, { title: 'Search', body, active: 'search' }));
}

async function run(req, res) {
  const raw = String((req.body && req.body.titles) || '');
  const titles = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const sources = settings.enabledSources();

  let body = '';
  body += '<h1>Search probe</h1>';
  body += '<form method="POST" action="/search">';
  body += '<div class="card">';
  body += '<label class="lbl" for="titles">Search titles (one per line)</label>';
  body += '<textarea id="titles" name="titles" rows="4" class="inp mono">' + escapeHtml(raw) + '</textarea>';
  body += '<div style="margin-top:14px;"><button class="btn">Re-run</button></div>';
  body += '</div></form>';

  if (titles.length === 0) {
    body += '<div class="card"><p class="dim">Enter at least one title above.</p></div>';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(layout(req, { title: 'Search', body, active: 'search' }));
  }
  if (sources.length === 0) {
    body += '<div class="card"><p class="dim">No sources enabled — nothing to query.</p></div>';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(layout(req, { title: 'Search', body, active: 'search' }));
  }

  log.info('system', 'manual probe: ' + JSON.stringify(titles));

  const perSource = await Promise.all(sources.map(async (s) => {
    const mod = registry.get(s.type);
    if (!mod) return { name: s.name, candidates: [], error: 'unknown type', latencyMs: 0 };
    const start = Date.now();
    const tlog = {
      info: (c, m) => log.info(c, m, s.name),
      warn: (c, m) => log.warn(c, m, s.name),
      error: (c, m) => log.error(c, m, s.name),
      debug: (c, m) => log.debug(c, m, s.name),
    };
    try {
      const candidates = await mod.multiSearch(titles, s.config || {}, tlog);
      return { name: s.name, candidates, latencyMs: Date.now() - start };
    } catch (err) {
      return { name: s.name, candidates: [], error: err.message, latencyMs: Date.now() - start };
    }
  }));

  body += '<div class="card-row">';
  for (const ps of perSource) {
    body += '<div class="card">';
    body += '<h3 style="margin-top:0;">' + escapeHtml(ps.name)
      + ' <span class="dim" style="font-weight:400;font-size:13px;">'
      + ps.candidates.length + ' result(s) · ' + ps.latencyMs + 'ms</span></h3>';
    if (ps.error) body += '<p><span class="pill bad">ERR</span> ' + escapeHtml(ps.error) + '</p>';
    if (ps.candidates.length === 0) {
      body += '<p class="dim">No candidates.</p>';
    } else {
      body += '<div style="max-height:420px;overflow-y:auto;">';
      body += '<table class="t"><thead><tr><th>Title</th><th>Size</th><th>S</th></tr></thead><tbody>';
      for (const c of ps.candidates.slice(0, 50)) {
        body += '<tr>'
          + '<td class="mono" style="font-size:12px;word-break:break-all;">' + escapeHtml(c.title) + '</td>'
          + '<td class="dim">' + escapeHtml(fmtBytes(c.size)) + '</td>'
          + '<td>' + (c.seeders || 0) + '</td>'
          + '</tr>';
      }
      body += '</tbody></table>';
      if (ps.candidates.length > 50) {
        body += '<p class="hint">Showing first 50 of ' + ps.candidates.length + '</p>';
      }
      body += '</div>';
    }
    body += '</div>';
  }
  body += '</div>';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(layout(req, { title: 'Search', body, active: 'search' }));
}

module.exports = { render, run };
