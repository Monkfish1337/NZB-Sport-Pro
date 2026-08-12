// Dashboard — at-a-glance status. Stats tiles, per-source cards, recent
// activity tail. Auto-refreshes on page load only (live updates are on
// the Logs page).

const { layout, escapeHtml } = require('./layout');
const settings = require('../lib/settings');
const stats = require('../lib/stats');
const history = require('../lib/history');
const log = require('../lib/log-buffer');
const registry = require('../lib/sources/registry');

function fmtRelative(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)    return Math.floor(ms / 1000) + 's ago';
  if (ms < 3600_000)  return Math.floor(ms / 60_000) + 'm ago';
  if (ms < 86400_000) return Math.floor(ms / 3600_000) + 'h ago';
  return Math.floor(ms / 86400_000) + 'd ago';
}

function pill(text, kind) { return '<span class="pill ' + kind + '">' + escapeHtml(text) + '</span>'; }

function render(req, res) {
  const sources = settings.listSources();
  const enabled = sources.filter((s) => s.enabled !== false);
  const recent = history.list().slice(0, 10);
  const tailLogs = log.recent(15);
  const snap = stats.snapshot();

  // Aggregate stats across all sources.
  let totalQueries = 0, totalOk = 0, totalErr = 0, totalCandidates = 0;
  for (const s of sources) {
    const st = snap[s.id];
    if (!st) continue;
    totalQueries += st.queries; totalOk += st.ok; totalErr += st.errors;
    totalCandidates += st.totalCandidates;
  }
  const aggRate = totalQueries > 0 ? Math.round((totalOk / totalQueries) * 100) : 0;

  // --- top stat tiles ---
  let body = '';
  body += '<h1>Dashboard</h1>';
  body += '<div class="card-row">'
    + '<div class="card stat"><div class="stat-label">Sources</div><div class="stat-value">'
    +   enabled.length + ' <span class="dim" style="font-size:14px;font-weight:400;">/ '
    +   sources.length + '</span></div><div class="stat-foot">enabled / total</div></div>'
    + '<div class="card stat"><div class="stat-label">Source calls</div><div class="stat-value">'
    +   totalQueries + '</div><div class="stat-foot">since start</div></div>'
    + '<div class="card stat"><div class="stat-label">Candidates returned</div><div class="stat-value">'
    +   totalCandidates + '</div><div class="stat-foot">across all sources</div></div>'
    + '<div class="card stat"><div class="stat-label">Source success rate</div><div class="stat-value '
    +   (aggRate >= 90 ? 'good' : aggRate >= 50 ? 'warn' : 'bad')
    +   '">' + aggRate + '%</div><div class="stat-foot">'
    +   totalOk + ' ok / ' + totalErr + ' err</div></div>'
    + '</div>';

  // --- configured sources ---
  body += '<h2>Configured sources</h2>';
  if (sources.length === 0) {
    body += '<div class="card"><p class="dim">No sources configured yet. <a href="/sources">Add one</a> to start serving /scrape responses.</p></div>';
  } else {
    body += '<table class="t"><thead><tr>'
      +   '<th>Name</th><th>Type</th><th>Status</th><th>Last call</th>'
      +   '<th>Avg latency</th><th>Success rate</th><th>Candidates</th><th></th>'
      + '</tr></thead><tbody>';
    for (const s of sources) {
      const mod = registry.get(s.type);
      const st  = snap[s.id] || { queries: 0, ok: 0, errors: 0, avgLatencyMs: 0,
        successRatePct: 0, totalCandidates: 0, lastSuccessAt: null, lastErrorAt: null };
      const lastCall = st.lastSuccessAt || st.lastErrorAt || null;
      let statusPill;
      if (s.enabled === false) statusPill = pill('disabled', 'muted');
      else if (st.queries === 0) statusPill = pill('idle', 'info');
      else if (st.successRatePct >= 90) statusPill = pill('healthy', 'good');
      else if (st.successRatePct >= 50) statusPill = pill('degraded', 'warn');
      else statusPill = pill('unhealthy', 'bad');
      body += '<tr>'
        + '<td><strong>' + escapeHtml(s.name) + '</strong></td>'
        + '<td>' + escapeHtml((mod && mod.label) || s.type) + '</td>'
        + '<td>' + statusPill + '</td>'
        + '<td class="dim">' + escapeHtml(fmtRelative(lastCall)) + '</td>'
        + '<td>' + (st.avgLatencyMs ? st.avgLatencyMs + 'ms' : '—') + '</td>'
        + '<td>' + (st.queries ? st.successRatePct + '%' : '—') + '</td>'
        + '<td>' + st.totalCandidates + '</td>'
        + '<td><a href="/sources">edit</a></td>'
        + '</tr>';
    }
    body += '</tbody></table>';
  }

  // --- recent activity ---
  body += '<h2>Recent /scrape calls</h2>';
  if (recent.length === 0) {
    body += '<div class="card"><p class="dim">No /scrape calls yet. The metadata addon hits this endpoint when a user clicks an event.</p></div>';
  } else {
    body += '<table class="t"><thead><tr>'
      + '<th>Time</th><th>Event</th><th>Sources hit</th><th>Merged</th>'
      + '</tr></thead><tbody>';
    for (const h of recent) {
      const merged = h.mergedCount || 0;
      const okSources = h.sourceResults.filter((r) => !r.error && !r.timedOut).length;
      const totalSources = h.sourceResults.length;
      body += '<tr>'
        + '<td class="dim">' + escapeHtml(fmtRelative(h.requestedAt)) + '</td>'
        + '<td>' + escapeHtml(h.eventLabel) + '</td>'
        + '<td>' + okSources + ' / ' + totalSources + '</td>'
        + '<td>' + (merged > 0 ? pill(String(merged), 'good') : pill('0', 'muted')) + '</td>'
        + '</tr>';
    }
    body += '</tbody></table>';
    body += '<p class="hint"><a href="/history">See full history</a></p>';
  }

  // --- tail of activity log ---
  body += '<h2>Activity tail</h2>';
  body += '<div class="card" style="padding:0;">';
  body += '<div class="log-stream" style="border:none;max-height:300px;">';
  for (const e of tailLogs) {
    const ts = e.ts.slice(11, 19);
    body += '<div class="log-line">'
      + '<span class="ts">' + escapeHtml(ts) + '</span>'
      + '<span class="lvl-' + e.level + '">[' + e.level.toUpperCase() + ']</span> '
      + (e.source ? '<span class="src">[' + escapeHtml(e.source) + ']</span>' : '')
      + escapeHtml(e.message)
      + '</div>';
  }
  body += '</div></div>';
  body += '<p class="hint"><a href="/logs">Open live log viewer</a></p>';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(layout(req, { title: 'Dashboard', body, active: 'dashboard' }));
}

module.exports = { render };
