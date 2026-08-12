// SeriousSportSync Scraper — config
//
// All config is env-driven with sensible defaults. Indexer source endpoints
// live in data/sources.json (managed via the GUI), not in env, because they
// change frequently and the GUI is the source of truth.

function num(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }

const config = {
  port: num(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',

  // Bearer token required on inbound /scrape calls. Optional — if blank,
  // the endpoint is open. Set when exposed to the internet.
  authToken: process.env.SCRAPER_AUTH_TOKEN || '',

  // Per-source default timeout (ms). Individual sources can override.
  defaultSourceTimeoutMs: num(process.env.SOURCE_TIMEOUT_MS, 10000),

  // Hard ceiling on /scrape response time. Slow sources beyond this point
  // contribute nothing.
  scrapeBudgetMs: num(process.env.SCRAPE_BUDGET_MS, 25000),

  // In-memory log ring buffer size.
  logBufferMax: num(process.env.LOG_BUFFER_MAX, 4000),

  // Recent /scrape calls retained for the History page.
  historyMax: num(process.env.HISTORY_MAX, 200),

  // Outbound HTTP proxy (e.g. http://gluetun:8888). Empty = direct.
  httpsProxy: process.env.HTTPS_PROXY || '',
  noProxy: (process.env.NO_PROXY || '').split(',').map((s) => s.trim()).filter(Boolean),

  // Where on-disk state lives.
  dataDir: process.env.DATA_DIR || './data',
};

module.exports = config;
