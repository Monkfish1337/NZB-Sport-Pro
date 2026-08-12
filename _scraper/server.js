// SeriousSportSync Scraper — entry point.
//
// Two surfaces:
//   1. Operator GUI at /  — dashboard, sources, logs, history, settings,
//      manual search probe. Server-rendered HTML with minimal client JS
//      (SSE for live logs, fetch() for source-test buttons).
//   2. /scrape JSON API   — protocol the metadata addon hits.
//
// No login wall on the GUI in v0.1 — operator runs this internally and
// fronts it with their own reverse-proxy auth if exposed.

const express = require('express');
const config = require('./config');
const log = require('./lib/log-buffer');
const auth = require('./lib/auth');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use('/public', express.static('public'));

// --------------------------- GUI routes ---------------------------
// All return server-rendered HTML. View modules live under views/.
app.get('/',           (req, res) => require('./views/dashboard').render(req, res));
app.get('/sources',    (req, res) => require('./views/sources').render(req, res));
app.post('/sources',   (req, res) => require('./views/sources').save(req, res));
app.post('/sources/:id/delete',  (req, res) => require('./views/sources').remove(req, res));
app.post('/sources/:id/enable',  (req, res) => require('./views/sources').enable(req, res));
app.post('/sources/:id/disable', (req, res) => require('./views/sources').disable(req, res));
app.post('/sources/:id/test',    (req, res) => require('./views/sources').test(req, res));
app.get('/logs',        (req, res) => require('./views/logs').render(req, res));
app.get('/logs/stream', (req, res) => require('./views/logs').sse(req, res));
app.get('/history',     (req, res) => require('./views/history').render(req, res));
app.get('/search',      (req, res) => require('./views/search').render(req, res));
app.post('/search',     (req, res) => require('./views/search').run(req, res));
app.get('/settings',    (req, res) => require('./views/settings').render(req, res));
app.post('/settings/clear-history', (req, res) => require('./views/settings').clearHistory(req, res));
app.post('/settings/clear-logs',    (req, res) => require('./views/settings').clearLogs(req, res));
app.get('/settings/export-sources', (req, res) => require('./views/settings').exportSources(req, res));
app.post('/settings/import-sources',(req, res) => require('./views/settings').importSources(req, res));

// 0.2.0 — Grabber GUI (independent sources + search + downloaders).
//
// Grabber Sources: separate indexer list from the sport scraper (different
// JSON store at data/grabber-sources.json). Sport-side /sources is untouched.
app.get('/grabber/sources',                 (req, res) => require('./views/grabber-sources').render(req, res));
app.post('/grabber/sources',                (req, res) => require('./views/grabber-sources').save(req, res));
app.post('/grabber/sources/:id/delete',     (req, res) => require('./views/grabber-sources').remove(req, res));
app.post('/grabber/sources/:id/enable',     (req, res) => require('./views/grabber-sources').enable(req, res));
app.post('/grabber/sources/:id/disable',    (req, res) => require('./views/grabber-sources').disable(req, res));
app.post('/grabber/sources/:id/test',       (req, res) => require('./views/grabber-sources').test(req, res));

// Grabber Search: operator-side UI for the same /api/general-search endpoint
// SSS calls via /admin/search.
app.get('/grabber/search',                  (req, res) => require('./views/grabber-search').render(req, res));
app.post('/grabber/search/run',             (req, res) => require('./views/grabber-search').run(req, res));
app.post('/grabber/grab',                   (req, res) => require('./views/grabber-search').grab(req, res));

// Grabber Downloaders (moved from /downloaders).
app.get('/grabber/downloaders',             (req, res) => require('./views/grabber-downloaders').render(req, res));
app.post('/grabber/downloaders/qbit',       (req, res) => require('./views/grabber-downloaders').saveQbit(req, res));
app.post('/grabber/downloaders/sab',        (req, res) => require('./views/grabber-downloaders').saveSab(req, res));
app.post('/grabber/downloaders/qbit/test',  (req, res) => require('./views/grabber-downloaders').testQbit(req, res));
app.post('/grabber/downloaders/sab/test',   (req, res) => require('./views/grabber-downloaders').testSab(req, res));
// 0.2.2 — TorBox routes.
app.post('/grabber/downloaders/torbox',      (req, res) => require('./views/grabber-downloaders').saveTorbox(req, res));
app.post('/grabber/downloaders/torbox/test', (req, res) => require('./views/grabber-downloaders').testTorbox(req, res));

// 301 backward-compat: anything that hit the old top-level /downloaders/*
// (including bookmarks) gets redirected into the new Grabber namespace.
app.all(/^\/downloaders(\/.*)?$/, (req, res) => {
  const tail = req.params[0] || '';
  res.redirect(301, '/grabber/downloaders' + tail);
});

// --------------------------- JSON API ---------------------------
// Protocol expected by the metadata addon's companion-scraper.js client.
app.post('/scrape', auth.requireBearer, async (req, res) => {
  const search = require('./lib/search');
  try {
    const result = await search.scrape(req.body || {});
    res.json(result);
  } catch (err) {
    log.error('http', '/scrape failed: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

// 0.1.4 — General search across all enabled prowlarr-type sources.
// Used by SSS's /admin/search admin page.
// 0.2.1 — Honors a `relevance` body param ('strict'|'loose'|'off') so the
// SSS-side proxy can opt out of filtering if it wants raw results. Default
// 'strict' to match the operator GUI default.
app.post('/api/general-search', auth.requireBearer, async (req, res) => {
  const generalSearch = require('./lib/general-search');
  const b = req.body || {};
  const q = String(b.query || '').trim();
  if (!q) return res.status(400).json({ error: 'no query' });
  const relevance = String(b.relevance || 'strict');
  try {
    const out = await generalSearch.search(q, {
      limit: b.limit || 100,
      relevance,
    });
    res.json(out);
  } catch (err) {
    log.error('http', '/api/general-search failed: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

// 0.1.4 — Send a grabbed result to qBit or SAB.
// Body: { downloader: 'qbit'|'sab', type: 'torrent'|'usenet', url, title?, category? }
app.post('/api/grab', auth.requireBearer, async (req, res) => {
  const b = req.body || {};
  const downloader = String(b.downloader || '').toLowerCase();
  const url = String(b.url || '');
  const title = String(b.title || '');
  const category = b.category !== undefined ? String(b.category) : undefined;
  if (!url) return res.status(400).json({ ok: false, error: 'no url' });

  const downloadersStore = require('./lib/downloaders');
  try {
    if (downloader === 'qbit') {
      const qbit = require('./lib/downloaders/qbittorrent');
      const cfg = downloadersStore.getQbit();
      const out = await qbit.addTorrent({ config: cfg, url, category, title });
      if (out.ok) log.info('http', 'grab → qbit: ' + title);
      else log.warn('http', 'grab → qbit failed: ' + out.error);
      return res.json(out);
    }
    if (downloader === 'sab') {
      const sab = require('./lib/downloaders/sabnzbd');
      const cfg = downloadersStore.getSab();
      const out = await sab.addUrl({ config: cfg, url, category, title });
      if (out.ok) log.info('http', 'grab → sab: ' + title);
      else log.warn('http', 'grab → sab failed: ' + out.error);
      return res.json(out);
    }
    if (downloader === 'torbox') {
      // 0.2.2 — TorBox: routes torrent-flavored URLs (magnet / .torrent) to the
      // torrents/createtorrent endpoint and NZB URLs to usenet/createusenetdownload.
      // Client hints via body.type ('torrent'|'usenet'); if absent we sniff by the
      // URL prefix / extension.
      const tb = require('./lib/downloaders/torbox');
      const cfg = downloadersStore.getTorbox();
      const hint = String(b.type || '').toLowerCase();
      const looksMagnet = /^magnet:/i.test(url);
      const looksNzb = /\.nzb(\?|$)/i.test(url) || /nzb/i.test(url) && /(nzbgeek|usenet|drunkenslug|nzbfinder)/i.test(url);
      const isUsenet = hint === 'usenet' || (hint !== 'torrent' && looksNzb && !looksMagnet);
      const out = isUsenet
        ? await tb.addUsenet({ config: cfg, url, title })
        : await tb.addTorrent({ config: cfg, url, title });
      if (out.ok) log.info('http', 'grab → torbox (' + (isUsenet ? 'usenet' : 'torrent') + '): ' + title);
      else log.warn('http', 'grab → torbox failed: ' + out.error);
      return res.json(out);
    }
    return res.status(400).json({ ok: false, error: 'unknown downloader: ' + downloader });
  } catch (err) {
    log.error('http', '/api/grab error: ' + err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Health check — for docker / uptime monitoring.
app.get('/health', (req, res) => {
  res.json({ ok: true, version: require('./package.json').version });
});

// --------------------------- Boot ---------------------------
const port = parseInt(process.env.PORT, 10) || config.port || 8080;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  log.info('system', 'SeriousSportSync Scraper listening on http://' + host + ':' + port);
  log.info('system', 'GUI: http://' + host + ':' + port + '/');
  log.info('system', 'API: POST http://' + host + ':' + port + '/scrape');
  log.info('system', '/scrape requires Authorization: Bearer <token>');
});
