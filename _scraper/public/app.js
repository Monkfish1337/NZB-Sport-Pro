// SeriousSportSync Scraper — client JS.
// Vanilla, no build step. Hooks into data-attributes so adding a new
// button or panel server-side doesn't need a JS change.

(function () {
  'use strict';

  // ---------- generic action buttons ----------
  // Any element with data-action="post" and data-url="..." sends a POST,
  // disabling itself while in-flight and showing the result inline.
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action="post"]');
    if (!el) return;
    ev.preventDefault();
    const url = el.dataset.url;
    if (!url) return;
    const confirmMsg = el.dataset.confirm;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    const out = document.querySelector(el.dataset.out || ('#' + el.id + '-out'));
    el.disabled = true;
    if (out) out.textContent = '...';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: el.dataset.body || '{}',
      });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
      if (out) {
        if (body.ok === false || !res.ok) {
          out.innerHTML = '<span class="pill bad">FAIL</span> '
            + (body.message || body.error || ('HTTP ' + res.status));
        } else {
          const lat = body.latencyMs ? ' (' + body.latencyMs + 'ms)' : '';
          out.innerHTML = '<span class="pill good">OK</span> '
            + (body.message || 'done') + lat;
        }
      }
      if (el.dataset.reload) window.location.reload();
    } catch (err) {
      if (out) out.innerHTML = '<span class="pill bad">ERR</span> ' + err.message;
    } finally {
      el.disabled = false;
    }
  });

  // ---------- history row expand ----------
  document.addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-history-row]');
    if (!row) return;
    const detail = row.nextElementSibling;
    if (detail && detail.classList.contains('history-detail')) {
      detail.classList.toggle('expanded');
    }
  });

  // ---------- SSE log stream (live logs page) ----------
  const logViewer = document.getElementById('log-stream');
  if (logViewer) {
    let paused = false;
    let autoScroll = true;
    const pauseBtn = document.getElementById('pause-btn');
    const clearBtn = document.getElementById('clear-btn');
    const filters = {
      level: document.getElementById('filter-level'),
      category: document.getElementById('filter-category'),
      source: document.getElementById('filter-source'),
      text: document.getElementById('filter-text'),
    };

    function passesFilters(entry) {
      if (filters.level    && filters.level.value    && entry.level    !== filters.level.value)    return false;
      if (filters.category && filters.category.value && entry.category !== filters.category.value) return false;
      if (filters.source   && filters.source.value   && (entry.source || '') !== filters.source.value) return false;
      if (filters.text     && filters.text.value) {
        const q = filters.text.value.toLowerCase();
        const haystack = (entry.message + ' ' + (entry.source || '') + ' ' + entry.category).toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }

    function renderLine(entry) {
      const ts = entry.ts.slice(11, 19);
      const src = entry.source ? '<span class="src">[' + entry.source + ']</span>' : '';
      const text = entry.message
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<div class="log-line" data-source="' + (entry.source || '')
        + '" data-level="' + entry.level + '" data-category="' + entry.category + '">'
        + '<span class="ts">' + ts + '</span>'
        + '<span class="lvl-' + entry.level + '">[' + entry.level.toUpperCase() + ']</span> '
        + '<span class="dim">[' + entry.category + ']</span> '
        + src + text
        + '</div>';
    }

    function append(entry) {
      if (paused) return;
      if (!passesFilters(entry)) return;
      logViewer.insertAdjacentHTML('beforeend', renderLine(entry));
      // Trim DOM if it grows past a few thousand entries.
      while (logViewer.children.length > 2000) logViewer.removeChild(logViewer.firstChild);
      if (autoScroll) logViewer.scrollTop = logViewer.scrollHeight;
    }

    // Track whether user has scrolled up — if so, pause auto-scroll.
    logViewer.addEventListener('scroll', () => {
      const atBottom = logViewer.scrollHeight - logViewer.scrollTop - logViewer.clientHeight < 30;
      autoScroll = atBottom;
    });

    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        paused = !paused;
        pauseBtn.textContent = paused ? 'Resume' : 'Pause';
        pauseBtn.classList.toggle('btn-ghost', !paused);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => { logViewer.innerHTML = ''; });
    }

    const es = new EventSource('/logs/stream');
    es.addEventListener('entry', (msg) => {
      try { append(JSON.parse(msg.data)); } catch (_) {}
    });
    es.addEventListener('error', () => {
      // Browser auto-reconnects EventSource; no work needed.
    });
  }
})();
