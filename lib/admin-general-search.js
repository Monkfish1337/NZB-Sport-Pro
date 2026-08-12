// 0.39.0 — /admin/search page logic.
//
// "General search" feature. The user types a query, we proxy through to the
// companion scraper's POST /api/general-search, render the merged result table
// inline, and let the admin grab any row via per-row "Send to qBit" / "Send
// to SAB" buttons. The grab POSTs to /admin/search/grab here which forwards
// to the scraper's POST /api/grab.
//
// Architectural note (post-refactor): SSS holds the UI and proxies. The
// scraper holds all the Prowlarr access + downloader (qBit/SAB) clients
// and credentials. SSS knows nothing about which Prowlarrs you have or what
// your qBit password is — that all lives in the scraper's GUI at
// http://<scraper>:8080/sources and /downloaders.
//
// Exports:
//   renderBody({ flash, query }) → string
//   handleScrape(req, res)        → JSON proxy to scraper /api/general-search
//   handleGrab(req, res)          → JSON proxy to scraper /api/grab

const fetch = require('node-fetch');
const settings = require('./settings');
const httpAgent = require('./http-agent');

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// Render the body HTML. Page is interactive — the search form POSTs to a
// JSON endpoint and the result table is built in the browser. The server-
// rendered body sets up the form, the empty result container, and the
// inline JS that talks to /admin/search/scrape + /admin/search/grab.
function renderBody(opts) {
  opts = opts || {};
  const flash = opts.flash || null;
  const initialQuery = escapeHtml(opts.query || '');
  const comp = settings.getCompanion();
  const scraperConfigured = !!comp.url;

  const flashHtml = flash
    ? '<div class="alert alert-info alert-dismissible" role="alert">'
      + '<div>' + escapeHtml(flash) + '</div>'
      + '<a class="btn-close" data-bs-dismiss="alert"></a>'
      + '</div>'
    : '';

  const configHint = scraperConfigured
    ? '<div class="mb-3"><span class="badge bg-green-lt">Scraper: ' + escapeHtml(comp.url) + '</span></div>'
    : '<div class="alert alert-warning">Companion scraper URL not configured. <a href="/admin" class="alert-link">Set it under Admin → Sources</a> first.</div>';

  const body = ''
    + '<div class="page-header"><div class="row align-items-center"><div class="col">'
    +   '<h2 class="page-title">General search</h2>'
    +   '<div class="text-secondary mt-1">'
    +     'Free-text search across every Prowlarr instance the scraper has configured, with one-click send to qBit / SAB. '
    +     'Configure the indexer sources in <a href="' + escapeHtml(comp.url || '#') + '/sources" target="_blank" rel="noopener" class="link-primary">the scraper\'s Sources page</a> and the downloader targets in <a href="' + escapeHtml(comp.url || '#') + '/downloaders" target="_blank" rel="noopener" class="link-primary">Downloaders</a>.'
    +   '</div>'
    + '</div></div></div>'

    + flashHtml
    + configHint

    + '<div class="card mb-3"><div class="card-body">'
    +   '<form id="search-form" class="row g-2 align-items-end" onsubmit="return false;">'
    +     '<div class="col-md-9">'
    +       '<label class="form-label">Search</label>'
    +       '<input id="q" name="q" class="form-control" placeholder="e.g. white zombie 1932, half-life 2 anniversary, etc." value="' + initialQuery + '" autocomplete="off" autofocus>'
    +     '</div>'
    +     '<div class="col-md-3 d-grid">'
    +       '<button id="search-btn" class="btn btn-primary" type="submit">Search</button>'
    +     '</div>'
    +   '</form>'
    + '</div></div>'

    + '<div id="instance-status" class="mb-2"></div>'

    + '<div id="filter-strip" class="d-none mb-2">'
    +   '<div class="row g-2 align-items-end">'
    +     '<div class="col-md-4">'
    +       '<label class="form-label small text-secondary mb-1">Filter title</label>'
    +       '<input id="filter-q" class="form-control form-control-sm" placeholder="extra filter (regex ok)">'
    +     '</div>'
    +     '<div class="col-md-2">'
    +       '<label class="form-label small text-secondary mb-1">Type</label>'
    +       '<select id="filter-type" class="form-select form-select-sm">'
    +         '<option value="">All</option>'
    +         '<option value="torrent">Torrent</option>'
    +         '<option value="usenet">Usenet</option>'
    +       '</select>'
    +     '</div>'
    +     '<div class="col-md-2">'
    +       '<label class="form-label small text-secondary mb-1">Min seeders</label>'
    +       '<input id="filter-min-seed" type="number" min="0" value="0" class="form-control form-control-sm">'
    +     '</div>'
    +     '<div class="col-md-2">'
    +       '<label class="form-label small text-secondary mb-1">Sort by</label>'
    +       '<select id="filter-sort" class="form-select form-select-sm">'
    +         '<option value="seeders">Seeders</option>'
    +         '<option value="size">Size</option>'
    +         '<option value="date">Newest</option>'
    +       '</select>'
    +     '</div>'
    +     '<div class="col-md-2">'
    +       '<span id="result-count" class="text-secondary small"></span>'
    +     '</div>'
    +   '</div>'
    + '</div>'

    + '<div id="results" class="card d-none"><div class="table-responsive">'
    +   '<table class="table table-vcenter card-table">'
    +     '<thead><tr>'
    +       '<th>Title</th>'
    +       '<th>Type</th>'
    +       '<th>Indexer</th>'
    +       '<th class="text-end">Size</th>'
    +       '<th class="text-end">Seeders</th>'
    +       '<th>Age</th>'
    +       '<th class="text-end w-1">Send</th>'
    +     '</tr></thead>'
    +     '<tbody id="result-tbody"></tbody>'
    +   '</table>'
    + '</div></div>'

    + '<div id="empty-state" class="d-none text-center py-4 text-secondary">No results.</div>'

    + buildClientJs(initialQuery);

  return body;
}

function buildClientJs(initialQuery) {
  const initialQ = JSON.stringify(initialQuery || '');
  return `<script>
(function () {
  var resultsBatch = [];
  var resultsEl   = document.getElementById('results');
  var emptyEl     = document.getElementById('empty-state');
  var statusEl    = document.getElementById('instance-status');
  var filterStrip = document.getElementById('filter-strip');
  var tbody       = document.getElementById('result-tbody');
  var countEl     = document.getElementById('result-count');
  var btn         = document.getElementById('search-btn');
  var form        = document.getElementById('search-form');
  var qInput      = document.getElementById('q');
  var fQ          = document.getElementById('filter-q');
  var fType       = document.getElementById('filter-type');
  var fSeed       = document.getElementById('filter-min-seed');
  var fSort       = document.getElementById('filter-sort');

  function fmtSize(b) {
    if (!b || b <= 0) return '';
    if (b >= 1e12) return (b / 1e12).toFixed(2) + ' TB';
    if (b >= 1e9)  return (b / 1e9).toFixed(2) + ' GB';
    if (b >= 1e6)  return Math.round(b / 1e6) + ' MB';
    return Math.round(b / 1e3) + ' KB';
  }
  function fmtAge(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var diff = Date.now() - d.getTime();
    if (diff < 0) return d.toISOString().slice(0, 10);
    var h = diff / 3600e3;
    if (h < 1) return Math.round(diff / 60e3) + 'm';
    if (h < 24) return Math.round(h) + 'h';
    var days = h / 24;
    if (days < 30) return Math.round(days) + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return Math.round(days / 365) + 'y';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function renderSourcesStatus(sources) {
    if (!sources || !sources.length) { statusEl.innerHTML = ''; return; }
    var parts = sources.map(function (s) {
      if (s.ok) {
        return '<span class="badge bg-green-lt me-2">' + escapeHtml(s.name) + ' (' + s.type + '): ' + s.count + '</span>';
      }
      return '<span class="badge bg-red-lt me-2">' + escapeHtml(s.name) + ': ' + escapeHtml(s.error || 'failed') + '</span>';
    });
    statusEl.innerHTML = parts.join('');
  }

  function applyFiltersAndSort(batch) {
    var q = (fQ.value || '').trim();
    var re = null;
    if (q) { try { re = new RegExp(q, 'i'); } catch (e) { re = null; } }
    var t = fType.value || '';
    var min = parseInt(fSeed.value || '0', 10) || 0;
    var sort = fSort.value || 'seeders';

    var rows = batch.filter(function (r) {
      if (t && r.type !== t) return false;
      if (r.type === 'torrent' && (r.seeders || 0) < min) return false;
      if (re && !re.test(r.title)) return false;
      return true;
    });
    rows.sort(function (a, b) {
      if (sort === 'size') return (b.size || 0) - (a.size || 0);
      if (sort === 'date') return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);
      return (b.seeders || 0) - (a.seeders || 0);
    });
    return rows;
  }

  function renderRows() {
    var rows = applyFiltersAndSort(resultsBatch);
    countEl.textContent = rows.length + ' / ' + resultsBatch.length + ' shown';
    if (!rows.length) {
      tbody.innerHTML = '';
      resultsEl.classList.add('d-none');
      emptyEl.classList.remove('d-none');
      return;
    }
    emptyEl.classList.add('d-none');
    resultsEl.classList.remove('d-none');
    var html = rows.map(function (r, i) {
      var typeBadge = r.type === 'torrent'
        ? '<span class="badge bg-azure-lt">torrent</span>'
        : r.type === 'usenet'
        ? '<span class="badge bg-purple-lt">usenet</span>'
        : '<span class="badge bg-secondary-lt">' + escapeHtml(r.type) + '</span>';
      // Scraper 0.2.2 — TorBox handles both torrent and usenet, so it shows
      // on every row alongside the type-specific button.
      var tbBtn = ' <button class="btn btn-sm btn-outline-secondary send-btn" data-i="' + i + '" data-downloader="torbox">TorBox</button>';
      var sendBtns = '';
      if (r.type === 'torrent') {
        sendBtns = '<button class="btn btn-sm btn-primary send-btn" data-i="' + i + '" data-downloader="qbit">qBit</button>' + tbBtn;
      } else if (r.type === 'usenet') {
        sendBtns = '<button class="btn btn-sm btn-primary send-btn" data-i="' + i + '" data-downloader="sab">SAB</button>' + tbBtn;
      } else {
        sendBtns = '<button class="btn btn-sm btn-outline-secondary send-btn" data-i="' + i + '" data-downloader="qbit">qBit</button> '
                 + '<button class="btn btn-sm btn-outline-secondary send-btn" data-i="' + i + '" data-downloader="sab">SAB</button>'
                 + tbBtn;
      }
      var seeders = r.type === 'torrent' ? (r.seeders || 0) : '—';
      return ''
        + '<tr data-i="' + i + '">'
        +   '<td><span class="text-mono small">' + escapeHtml(r.title) + '</span></td>'
        +   '<td>' + typeBadge + '</td>'
        +   '<td class="text-secondary small">' + escapeHtml(r.indexer || '') + '</td>'
        +   '<td class="text-end text-secondary small">' + escapeHtml(fmtSize(r.size)) + '</td>'
        +   '<td class="text-end text-secondary small">' + seeders + '</td>'
        +   '<td class="text-secondary small">' + escapeHtml(fmtAge(r.publishedAt)) + '</td>'
        +   '<td class="text-end text-nowrap">' + sendBtns + '</td>'
        + '</tr>';
    }).join('');
    tbody.innerHTML = html;
    tbody._rows = rows;
  }

  async function runSearch(q) {
    btn.disabled = true;
    btn.textContent = 'Searching…';
    statusEl.innerHTML = '<span class="text-secondary small">Querying scraper…</span>';
    try {
      var body = new URLSearchParams();
      body.append('q', q);
      var res = await fetch('/admin/search/scrape', {
        method: 'POST',
        body: body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      var j = await res.json();
      if (!res.ok) {
        statusEl.innerHTML = '<span class="badge bg-red-lt">' + escapeHtml((j && j.error) || 'Search failed') + '</span>';
        resultsBatch = [];
        renderRows();
        return;
      }
      resultsBatch = j.results || [];
      renderSourcesStatus(j.sources);
      filterStrip.classList.toggle('d-none', resultsBatch.length === 0);
      renderRows();
    } catch (err) {
      statusEl.innerHTML = '<span class="badge bg-red-lt">' + escapeHtml(err.message) + '</span>';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Search';
    }
  }

  async function grab(idx, downloader, btnEl) {
    var rows = tbody._rows || [];
    var row = rows[idx];
    if (!row) return;
    btnEl.disabled = true;
    var orig = btnEl.textContent;
    btnEl.textContent = '…';
    try {
      var body = new URLSearchParams();
      body.append('downloader', downloader);
      body.append('type', row.type);
      body.append('url', row.magnetUrl || row.downloadUrl || '');
      body.append('title', row.title || '');
      var res = await fetch('/admin/search/grab', {
        method: 'POST',
        body: body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      var j = await res.json();
      if (res.ok && j.ok) {
        btnEl.classList.remove('btn-primary', 'btn-outline-secondary');
        btnEl.classList.add('btn-success');
        btnEl.textContent = 'Sent';
        setTimeout(function () { btnEl.textContent = '✓'; }, 1500);
      } else {
        btnEl.classList.remove('btn-primary');
        btnEl.classList.add('btn-danger');
        btnEl.textContent = 'X';
        btnEl.title = (j && j.error) || ('http ' + res.status);
        setTimeout(function () {
          btnEl.classList.remove('btn-danger');
          btnEl.classList.add('btn-primary');
          btnEl.textContent = orig;
          btnEl.disabled = false;
        }, 3000);
      }
    } catch (err) {
      btnEl.textContent = 'X';
      btnEl.title = err.message;
      setTimeout(function () {
        btnEl.textContent = orig;
        btnEl.disabled = false;
      }, 3000);
    }
  }

  form.addEventListener('submit', function () {
    var q = (qInput.value || '').trim();
    if (!q) return;
    runSearch(q);
  });

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.send-btn') : null;
    if (!b) return;
    e.preventDefault();
    var idx = parseInt(b.getAttribute('data-i'), 10);
    var dl  = b.getAttribute('data-downloader');
    grab(idx, dl, b);
  });

  ['input', 'change'].forEach(function (ev) {
    fQ.addEventListener(ev, renderRows);
    fType.addEventListener(ev, renderRows);
    fSeed.addEventListener(ev, renderRows);
    fSort.addEventListener(ev, renderRows);
  });

  var initialQ = ${initialQ};
  if (initialQ && initialQ.trim()) runSearch(initialQ.trim());
})();
</script>`;
}

// Build the per-request fetch options used to talk to the scraper. Mirrors
// companion-scraper.js's auth pattern (Bearer token from settings).
function scraperFetchOpts(extra) {
  const comp = settings.getCompanion();
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (comp.authToken) headers.Authorization = 'Bearer ' + comp.authToken;
  return Object.assign({ headers, timeout: 20000 }, extra || {});
}

function scraperUrl(path) {
  const comp = settings.getCompanion();
  if (!comp.url) return null;
  return comp.url.replace(/\/+$/, '') + path;
}

// POST /admin/search/scrape — proxies to scraper /api/general-search.
async function handleScrape(req, res) {
  const q = String(((req.body || {}).q) || '').trim();
  if (!q) return res.status(400).json({ error: 'no query' });

  const url = scraperUrl('/api/general-search');
  if (!url) return res.status(503).json({ error: 'scraper URL not configured (Admin → Sources → Companion scraper)' });

  const opts = scraperFetchOpts({
    method: 'POST',
    body: JSON.stringify({ query: q, limit: 100 }),
  });

  try {
    const r = await fetch(url, httpAgent.fetchOpts(opts, url));
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'scraper http ' + r.status + ' ' + body.slice(0, 200) });
    }
    const json = await r.json();
    res.json(json);
  } catch (err) {
    res.status(500).json({ error: 'scraper unreachable: ' + err.message });
  }
}

// POST /admin/search/grab — proxies to scraper /api/grab.
async function handleGrab(req, res) {
  const b = req.body || {};
  const downloader = String(b.downloader || '').toLowerCase();
  const url = String(b.url || '');
  if (!url) return res.status(400).json({ ok: false, error: 'no url' });

  const scraper = scraperUrl('/api/grab');
  if (!scraper) return res.status(503).json({ ok: false, error: 'scraper URL not configured' });

  const opts = scraperFetchOpts({
    method: 'POST',
    body: JSON.stringify({
      downloader,
      type: String(b.type || ''),
      url,
      title: String(b.title || ''),
    }),
  });

  try {
    const r = await fetch(scraper, httpAgent.fetchOpts(opts, scraper));
    const json = await r.json().catch(() => ({ ok: false, error: 'scraper returned non-JSON' }));
    res.status(r.status).json(json);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'scraper unreachable: ' + err.message });
  }
}

module.exports = {
  renderBody,
  handleScrape,
  handleGrab,
};
