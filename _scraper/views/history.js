// History page — last N /scrape calls. Click a row to expand and see the
// per-source breakdown (which source returned what, latency, errors).
// Newest first.

const { layout, escapeHtml } = require('./layout');
const history = require('../lib/history');

function fmtRelative(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)    return Math.floor(ms / 1000) + 's ago';
  if (ms < 3600_000)  return Math.floor(ms / 60_000) + 'm ago';
  if (ms < 86400_000) return Math.floor(ms / 3600_000) + 'h ago';
  return Math.floor(ms / 86400_000) + 'd ago';
}

function pill(text, kind) {
  return '<span class="pill ' + kind + '">' + escapeHtml(text) + '</span>';
}

function renderRow(entry, idx) {
  const ok = entry.sourceResults.filter((r) => !r.error && !r.timedOut).length;
  const total = entry.sourceResults.length;
  const merged = entry.mergedCount || 0;
  const titles = (entry.searchTitles || []).slice(0, 2).join(', ')
    + (entry.searchTitles && entry.searchTitles.length > 2 ? ', +' + (entry.searchTitles.length - 2) + ' more' : '');

  let out = '<tr data-history-row="' + idx + '" style="cursor:pointer;">'
    + '<td class="dim">' + escapeHtml(fmtRelative(entry.requestedAt)) + '</td>'
    + '<td><strong>' + escapeHtml(entry.eventLabel || '?') + '</strong>'
    +   '<div class="dim mono" style="font-size:12px;">' + escapeHtml(titles) + '</div></td>'
    + '<td>' + ok + ' / ' + total + '</td>'
    + '<td>' + (merged > 0 ? pill(String(merged), 'good') : pill('0', 'muted')) + '</td>'
    + '<td class="dim mono" style="font-size:12px;">click to expand</td>'
    + '</tr>';

  // Hidden detail row.
  out += '<tr class="history-detail" style="display:none;"><td colspan="5">';
  out += '<div class="card" style="margin:0;background:var(--bg);">';
  out += '<h3>Per-source breakdown</h3>';
  out += '<table class="t"><thead><tr>'
    + '<th>Source</th><th>Latency</th><th>Returned</th><th>Status</th>'
    + '</tr></thead><tbody>';
  for (const r of entry.sourceResults) {
    let status;
    if (r.timedOut)    status = pill('timeout', 'warn');
    else if (r.error)  status = pill(r.error.slice(0, 60), 'bad');
    else if (r.count === 0) status = pill('empty', 'muted');
    else status = pill('ok', 'good');
    out += '<tr>'
      + '<td><strong>' + escapeHtml(r.sourceName) + '</strong></td>'
      + '<td>' + (r.latencyMs || 0) + 'ms</td>'
      + '<td>' + (r.count || 0) + '</td>'
      + '<td>' + status + '</td>'
      + '</tr>';
  }
  out += '</tbody></table>';
  out += '<h3 style="margin-top:14px;">Search titles fired</h3>';
  out += '<ul class="mono" style="font-size:12px;">';
  for (const t of (entry.searchTitles || [])) {
    out += '<li>' + escapeHtml(t) + '</li>';
  }
  out += '</ul>';
  out += '</div></td></tr>';
  return out;
}

function render(req, res) {
  const entries = history.list();
  let body = '';
  body += '<h1>History</h1>';
  body += '<p class="hint">Most recent /scrape calls first. Click any row to see the per-source breakdown.</p>';

  if (entries.length === 0) {
    body += '<div class="card"><p class="dim">No /scrape calls recorded yet.</p></div>';
  } else {
    body += '<style>.history-detail.expanded { display: table-row !important; }</style>';
    body += '<table class="t"><thead><tr>'
      + '<th>When</th><th>Event &amp; titles</th><th>Sources ok</th>'
      + '<th>Merged</th><th></th></tr></thead><tbody>';
    for (let i = 0; i < entries.length; i++) body += renderRow(entries[i], i);
    body += '</tbody></table>';
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(layout(req, { title: 'History', body, active: 'history' }));
}

module.exports = { render };
