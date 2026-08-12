// Live logs page. Server-renders the recent buffer for initial paint,
// then a Server-Sent Events stream feeds new entries to the client which
// appends them via public/app.js.

const { layout, escapeHtml } = require('./layout');
const log = require('../lib/log-buffer');
const settings = require('../lib/settings');

function render(req, res) {
  const sources = settings.listSources();
  const seedEntries = log.recent(200);

  let body = '';
  body += '<h1>Live logs</h1>';
  body += '<div class="card">';
  body += '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">';

  body += '<div style="flex:1 1 130px;"><label class="lbl">Level</label>'
    + '<select id="filter-level"><option value="">all</option>'
    + '<option value="info">info</option><option value="warn">warn</option>'
    + '<option value="error">error</option><option value="debug">debug</option>'
    + '</select></div>';

  body += '<div style="flex:1 1 130px;"><label class="lbl">Category</label>'
    + '<select id="filter-category"><option value="">all</option>'
    + '<option value="scrape">scrape</option><option value="source">source</option>'
    + '<option value="http">http</option><option value="system">system</option>'
    + '</select></div>';

  body += '<div style="flex:1 1 180px;"><label class="lbl">Source</label>'
    + '<select id="filter-source"><option value="">all</option>';
  for (const s of sources) {
    body += '<option value="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</option>';
  }
  body += '</select></div>';

  body += '<div style="flex:2 1 200px;"><label class="lbl">Text contains</label>'
    + '<input class="inp" id="filter-text" placeholder="grep over message text"></div>';

  body += '<div><button id="pause-btn">Pause</button>'
    + ' <button id="clear-btn" class="btn-ghost">Clear view</button></div>';
  body += '</div></div>';

  body += '<div id="log-stream" class="log-stream">';
  for (const e of seedEntries) {
    const ts = e.ts.slice(11, 19);
    body += '<div class="log-line" data-source="' + escapeHtml(e.source || '')
      + '" data-level="' + escapeHtml(e.level)
      + '" data-category="' + escapeHtml(e.category) + '">'
      + '<span class="ts">' + escapeHtml(ts) + '</span>'
      + '<span class="lvl-' + escapeHtml(e.level) + '">[' + e.level.toUpperCase() + ']</span> '
      + '<span class="dim">[' + escapeHtml(e.category) + ']</span> '
      + (e.source ? '<span class="src">[' + escapeHtml(e.source) + ']</span>' : '')
      + escapeHtml(e.message)
      + '</div>';
  }
  body += '</div>';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(layout(req, { title: 'Logs', body, active: 'logs' }));
}

// SSE stream — keeps connection open and pushes each new log entry as JSON.
function sse(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  // Heartbeat so intermediaries don't close idle connections.
  const heartbeat = setInterval(() => { try { res.write(': hb\n\n'); } catch (_) {} }, 25_000);

  function onEntry(entry) {
    try {
      res.write('event: entry\ndata: ' + JSON.stringify(entry) + '\n\n');
    } catch (_) { /* connection probably dead — will be cleaned up on close */ }
  }
  log.on('entry', onEntry);

  req.on('close', () => {
    clearInterval(heartbeat);
    log.off('entry', onEntry);
  });
}

module.exports = { render, sse };
