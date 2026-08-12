// 0.2.0 — Grabber Search page (operator-side).
//
// Same UX as SSS's /admin/search but native to the scraper GUI. The form
// POSTs to /grabber/search/run which internally calls lib/general-search.js
// (which now reads from lib/grabber-sources). Send-to-qBit / Send-to-SAB
// buttons POST to /grabber/grab which dispatches via lib/downloaders/*.
//
// No auth on the scraper GUI by design (operator-only, behind reverse proxy
// if exposed); auth bearer doesn't apply here unlike the /api/* endpoints.

const { layout, escapeHtml } = require('./layout');
const grabberSources = require('../lib/grabber-sources');
const downloadersStore = require('../lib/downloaders');
const generalSearch = require('../lib/general-search');
const qbit = require('../lib/downloaders/qbittorrent');
const sab  = require('../lib/downloaders/sabnzbd');
const torbox = require('../lib/downloaders/torbox');   // 0.2.2
const log = require('../lib/log-buffer');

function render(req, res) {
  const initialQ = String(req.query.q || '');
  const enabledIndexers = grabberSources.enabledSources().filter((s) => s.type === 'prowlarr');
  const qbitCfg = downloadersStore.getQbit();
  const sabCfg  = downloadersStore.getSab();

  function pill(label, configured) {
    const cls = configured ? 'good' : 'bad';
    return '<span class="pill ' + cls + '">' + escapeHtml(label) + (configured ? ' OK' : ' missing') + '</span>';
  }

  let body = '';
  body += '<h1>Grabber Search</h1>';
  body += '<p class="hint">Free-text search across every enabled Grabber Source in parallel. Results merged, no relevance filter. Click qBit / SAB to send a release to the configured downloader.</p>';

  // Status bar — confirms config at a glance
  body += '<div class="card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">';
  body += '<strong>Status:</strong>';
  body += pill('Indexers (' + enabledIndexers.length + ')', enabledIndexers.length > 0);
  body += pill('qBit', !!(qbitCfg.url && qbitCfg.username));
  body += pill('SAB', !!(sabCfg.url && sabCfg.apiKey));
  body += '<span class="dim">Configure under '
       +   '<a href="/grabber/sources">Sources</a> / '
       +   '<a href="/grabber/downloaders">Downloaders</a>.</span>';
  body += '</div>';

  // Search form
  body += '<div class="card">';
  body += '<form id="search-form" onsubmit="return false;" style="display:flex;gap:10px;align-items:flex-end;">';
  body += '<div style="flex:1;">';
  body += '<label class="lbl" for="q">Search</label>';
  body += '<input class="inp" type="text" id="q" name="q" autofocus value="' + escapeHtml(initialQ) + '" placeholder="e.g. half-life 2, white zombie 1932, etc.">';
  body += '</div>';
  // 0.2.1 — Relevance dropdown is sent server-side per-search. Strict drops
  // any result whose title doesn't contain every query word. Use it to mute
  // bitmagnet\'s FTS noise.
  body += '<div style="width:160px;">';
  body += '<label class="lbl" for="relevance">Relevance</label>';
  body += '<select class="inp" id="relevance">';
  body += '<option value="strict" selected>Strict (all words)</option>';
  body += '<option value="loose">Loose (≥ half)</option>';
  body += '<option value="off">Off</option>';
  body += '</select>';
  body += '</div>';
  body += '<button id="search-btn" class="btn" type="submit">Search</button>';
  body += '</form>';
  body += '</div>';

  body += '<div id="source-status" class="dim" style="margin:8px 0;"></div>';

  // Filter strip — applied client-side over the fetched batch
  body += '<div id="filter-strip" class="card" style="display:none;">';
  body += '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">';
  body += '<div><label class="lbl" for="filter-q">Filter title (regex)</label>'
       +    '<input class="inp" id="filter-q" type="text" placeholder=""></div>';
  body += '<div><label class="lbl" for="filter-type">Type</label>'
       +    '<select class="inp" id="filter-type">'
       +      '<option value="">All</option>'
       +      '<option value="torrent">Torrent</option>'
       +      '<option value="usenet">Usenet</option>'
       +    '</select></div>';
  // 0.2.1 — populated client-side from unique indexers in the batch.
  body += '<div><label class="lbl" for="filter-indexer">Indexer</label>'
       +    '<select class="inp" id="filter-indexer">'
       +      '<option value="">All</option>'
       +    '</select></div>';
  body += '<div><label class="lbl" for="filter-seed">Min seeders</label>'
       +    '<input class="inp" id="filter-seed" type="number" min="0" value="0" style="width:80px;"></div>';
  body += '<div><label class="lbl" for="filter-sort">Sort by</label>'
       +    '<select class="inp" id="filter-sort">'
       +      '<option value="seeders">Seeders</option>'
       +      '<option value="size">Size</option>'
       +      '<option value="date">Newest</option>'
       +    '</select></div>';
  body += '<div><span id="result-count" class="dim"></span></div>';
  body += '</div></div>';

  // Result area
  body += '<div id="results" class="card" style="display:none;">';
  body += '<table class="t responsive" style="font-size:12px;">';   // 0.2.7 — cards on mobile
  body += '<thead><tr>'
       +   '<th>Title</th>'
       +   '<th>Type</th>'
       +   '<th>Source</th>'
       +   '<th>Indexer</th>'
       +   '<th style="text-align:right;">Size</th>'
       +   '<th style="text-align:right;">Seeders</th>'
       +   '<th>Age</th>'
       +   '<th style="text-align:right;">Send</th>'
       + '</tr></thead>';
  body += '<tbody id="result-tbody"></tbody>';
  body += '</table>';
  body += '</div>';

  body += '<div id="empty-state" class="dim" style="display:none;padding:24px;text-align:center;">No results.</div>';

  body += buildClientJs(initialQ);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(layout(req, { title: 'Grabber Search', body, active: 'grabber-search' }));
}

function buildClientJs(initialQuery) {
  const initialQ = JSON.stringify(initialQuery || '');
  return `<script>
(function () {
  var batch = [];
  var $results   = document.getElementById('results');
  var $empty     = document.getElementById('empty-state');
  var $status    = document.getElementById('source-status');
  var $strip     = document.getElementById('filter-strip');
  var $tbody     = document.getElementById('result-tbody');
  var $count     = document.getElementById('result-count');
  var $btn       = document.getElementById('search-btn');
  var $form      = document.getElementById('search-form');
  var $q         = document.getElementById('q');
  var $relevance = document.getElementById('relevance');     // 0.2.1
  var $fQ        = document.getElementById('filter-q');
  var $fType     = document.getElementById('filter-type');
  var $fIndexer  = document.getElementById('filter-indexer'); // 0.2.1
  var $fSeed     = document.getElementById('filter-seed');
  var $fSort     = document.getElementById('filter-sort');

  function fmtSize(b) {
    if (!b || b <= 0) return '';
    if (b >= 1e12) return (b / 1e12).toFixed(2) + ' TB';
    if (b >= 1e9)  return (b / 1e9).toFixed(2) + ' GB';
    if (b >= 1e6)  return Math.round(b / 1e6) + ' MB';
    return Math.round(b / 1e3) + ' KB';
  }
  function fmtAge(ts) {
    if (!ts) return '';
    var d = new Date(ts); if (isNaN(d.getTime())) return '';
    var diff = Date.now() - d.getTime(); if (diff < 0) return d.toISOString().slice(0, 10);
    var h = diff / 3600e3;
    if (h < 1) return Math.round(diff / 60e3) + 'm';
    if (h < 24) return Math.round(h) + 'h';
    var days = h / 24;
    if (days < 30) return Math.round(days) + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return Math.round(days / 365) + 'y';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function showStatus(sources) {
    if (!sources || !sources.length) { $status.innerHTML = ''; return; }
    var parts = sources.map(function (s) {
      if (s.ok) {
        // 0.2.1 — show "12 / 256" when relevance filter dropped a chunk
        var dropped = s.droppedCount || 0;
        var label = s.count;
        if (dropped > 0) label = s.count + ' / ' + (s.rawCount || (s.count + dropped));
        return '<span class="pill good">' + esc(s.name) + ' (' + s.type + '): ' + label + '</span>';
      }
      return '<span class="pill bad">' + esc(s.name) + ': ' + esc(s.error || 'failed') + '</span>';
    });
    $status.innerHTML = parts.join(' ');
  }

  // 0.2.1 — repopulate the Indexer dropdown from the current batch. Preserves
  // selection if the same indexer appears in the new batch.
  function refreshIndexerOptions() {
    var prev = $fIndexer.value;
    var names = {};
    for (var i = 0; i < batch.length; i++) {
      var n = batch[i].indexer || '(unknown)';
      names[n] = (names[n] || 0) + 1;
    }
    var sorted = Object.keys(names).sort();
    $fIndexer.innerHTML = '<option value="">All</option>' + sorted.map(function (n) {
      return '<option value="' + esc(n) + '">' + esc(n) + ' (' + names[n] + ')</option>';
    }).join('');
    if (sorted.indexOf(prev) !== -1) $fIndexer.value = prev;
  }

  function filterSort(batch) {
    var q = ($fQ.value || '').trim();
    var re = null; if (q) { try { re = new RegExp(q, 'i'); } catch (e) {} }
    var t = $fType.value || '';
    var ix = $fIndexer.value || '';                            // 0.2.1
    var min = parseInt($fSeed.value || '0', 10) || 0;
    var sort = $fSort.value || 'seeders';
    var rows = batch.filter(function (r) {
      if (t && r.type !== t) return false;
      if (ix && (r.indexer || '(unknown)') !== ix) return false;  // 0.2.1
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

  function render() {
    var rows = filterSort(batch);
    $count.textContent = rows.length + ' / ' + batch.length + ' shown';
    if (!rows.length) {
      $tbody.innerHTML = '';
      $results.style.display = 'none';
      $empty.style.display = 'block';
      return;
    }
    $empty.style.display = 'none';
    $results.style.display = 'block';
    var html = rows.map(function (r, i) {
      var typeBadge = r.type === 'torrent'
        ? '<span class="pill info">torrent</span>'
        : r.type === 'usenet'
        ? '<span class="pill warn">usenet</span>'
        : '<span class="pill muted">' + esc(r.type) + '</span>';
      // 0.2.2 — TorBox accepts both torrent and usenet URLs, so it appears
      // on every row alongside the type-specific downloader.
      var tbBtn = ' <button class="btn-ghost send-btn" data-i="' + i + '" data-downloader="torbox">TorBox</button>';
      var sendBtns = '';
      if (r.type === 'torrent') {
        sendBtns = '<button class="btn-ghost send-btn" data-i="' + i + '" data-downloader="qbit">qBit</button>' + tbBtn;
      } else if (r.type === 'usenet') {
        sendBtns = '<button class="btn-ghost send-btn" data-i="' + i + '" data-downloader="sab">SAB</button>' + tbBtn;
      } else {
        sendBtns = '<button class="btn-ghost send-btn" data-i="' + i + '" data-downloader="qbit">qBit</button> '
                 + '<button class="btn-ghost send-btn" data-i="' + i + '" data-downloader="sab">SAB</button>'
                 + tbBtn;
      }
      var seeders = r.type === 'torrent' ? (r.seeders || 0) : '—';
      // 0.2.7 — data-th + cell-* classes drive the mobile card layout.
      return ''
        + '<tr data-i="' + i + '">'
        +   '<td data-th="" class="cell-title"><span class="mono">' + esc(r.title) + '</span></td>'
        +   '<td data-th="" class="cell-meta">' + typeBadge + '</td>'
        +   '<td data-th="Src" class="dim cell-meta">' + esc(r.sourceName || '') + '</td>'
        +   '<td data-th="Idx" class="dim cell-meta">' + esc(r.indexer || '') + '</td>'
        +   '<td data-th="Size" style="text-align:right;" class="dim cell-meta">' + esc(fmtSize(r.size)) + '</td>'
        +   '<td data-th="Seed" style="text-align:right;" class="dim cell-meta">' + seeders + '</td>'
        +   '<td data-th="Age" class="dim cell-meta">' + esc(fmtAge(r.publishedAt)) + '</td>'
        +   '<td data-th="" class="cell-actions" style="text-align:right;white-space:nowrap;">' + sendBtns + '</td>'
        + '</tr>';
    }).join('');
    $tbody.innerHTML = html;
    $tbody._rows = rows;
  }

  async function runSearch(q) {
    $btn.disabled = true; $btn.textContent = 'Searching…';
    $status.innerHTML = '<span class="dim">Querying enabled Grabber Sources…</span>';
    try {
      var body = new URLSearchParams();
      body.append('q', q);
      body.append('relevance', $relevance.value || 'strict');   // 0.2.1
      var res = await fetch('/grabber/search/run', {
        method: 'POST', body: body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      var j = await res.json();
      if (!res.ok) {
        $status.innerHTML = '<span class="pill bad">' + esc((j && j.error) || 'Search failed') + '</span>';
        batch = []; refreshIndexerOptions(); render(); return;
      }
      batch = j.results || [];
      showStatus(j.sources);
      refreshIndexerOptions();                                   // 0.2.1
      $strip.style.display = batch.length === 0 ? 'none' : 'block';
      render();
    } catch (err) {
      $status.innerHTML = '<span class="pill bad">' + esc(err.message) + '</span>';
    } finally {
      $btn.disabled = false; $btn.textContent = 'Search';
    }
  }

  async function grab(idx, downloader, btnEl) {
    var rows = $tbody._rows || [];
    var row = rows[idx]; if (!row) return;
    btnEl.disabled = true;
    var orig = btnEl.textContent;
    btnEl.textContent = '…';
    try {
      var body = new URLSearchParams();
      body.append('downloader', downloader);
      body.append('type', row.type);
      body.append('url', row.magnetUrl || row.downloadUrl || '');
      body.append('title', row.title || '');
      var res = await fetch('/grabber/grab', {
        method: 'POST', body: body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      var j = await res.json();
      if (res.ok && j.ok) {
        btnEl.textContent = 'Sent';
        setTimeout(function () { btnEl.textContent = '✓'; }, 1500);
      } else {
        btnEl.textContent = 'FAIL';
        btnEl.title = (j && j.error) || ('http ' + res.status);
        setTimeout(function () { btnEl.textContent = orig; btnEl.disabled = false; }, 3000);
      }
    } catch (err) {
      btnEl.textContent = 'ERR'; btnEl.title = err.message;
      setTimeout(function () { btnEl.textContent = orig; btnEl.disabled = false; }, 3000);
    }
  }

  $form.addEventListener('submit', function () {
    var q = ($q.value || '').trim(); if (!q) return;
    runSearch(q);
  });
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.send-btn') : null;
    if (!b) return;
    e.preventDefault();
    grab(parseInt(b.getAttribute('data-i'), 10), b.getAttribute('data-downloader'), b);
  });
  ['input', 'change'].forEach(function (ev) {
    $fQ.addEventListener(ev, render);
    $fType.addEventListener(ev, render);
    $fIndexer.addEventListener(ev, render);                    // 0.2.1
    $fSeed.addEventListener(ev, render);
    $fSort.addEventListener(ev, render);
  });

  var initialQ = ${initialQ};
  if (initialQ && initialQ.trim()) runSearch(initialQ.trim());
})();
</script>`;
}

// POST /grabber/search/run — runs the search and returns JSON. Reused by
// the operator-side GUI; the SSS proxy still hits /api/general-search (which
// internally calls the same generalSearch.search()).
async function run(req, res) {
  const q = String((req.body && req.body.q) || '').trim();
  if (!q) return res.status(400).json({ error: 'no query' });
  // 0.2.1 — relevance filter mode passed through from the UI dropdown.
  const relevance = String((req.body && req.body.relevance) || 'strict');
  try {
    const out = await generalSearch.search(q, { limit: 100, relevance });
    res.json(out);
  } catch (err) {
    log.error('http', '/grabber/search/run failed: ' + err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /grabber/grab — dispatch a single result to the chosen downloader.
// Mirrors POST /api/grab but available from the operator GUI without
// bearer auth (since the GUI is operator-only).
async function grab(req, res) {
  const b = req.body || {};
  const downloader = String(b.downloader || '').toLowerCase();
  const url = String(b.url || '');
  const title = String(b.title || '');
  if (!url) return res.status(400).json({ ok: false, error: 'no url' });

  try {
    if (downloader === 'qbit') {
      const out = await qbit.addTorrent({ config: downloadersStore.getQbit(), url, title });
      if (out.ok) log.info('http', 'grabber-gui → qbit: ' + title);
      else log.warn('http', 'grabber-gui → qbit failed: ' + (out.error || ''));
      return res.json(out);
    }
    if (downloader === 'sab') {
      const out = await sab.addUrl({ config: downloadersStore.getSab(), url, title });
      return res.json(out);
    }
    if (downloader === 'torbox') {
      // 0.2.2 — TorBox handles both torrent and usenet URLs.
      const b2 = req.body || {};
      const hint = String(b2.type || '').toLowerCase();
      const looksMagnet = /^magnet:/i.test(url);
      const looksNzb = /\.nzb(\?|$)/i.test(url) || (/nzb/i.test(url) && /(nzbgeek|usenet|drunkenslug|nzbfinder)/i.test(url));
      const isUsenet = hint === 'usenet' || (hint !== 'torrent' && looksNzb && !looksMagnet);
      const cfg = downloadersStore.getTorbox();
      const out = isUsenet
        ? await torbox.addUsenet({ config: cfg, url, title })
        : await torbox.addTorrent({ config: cfg, url, title });
      if (out.ok) log.info('http', 'grabber-gui → torbox (' + (isUsenet ? 'usenet' : 'torrent') + '): ' + title);
      else log.warn('http', 'grabber-gui → torbox failed: ' + (out.error || ''));
      return res.json(out);
    }
    return res.status(400).json({ ok: false, error: 'unknown downloader: ' + downloader });
  } catch (err) {
    log.error('http', '/grabber/grab error: ' + err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = { render, run, grab };
