// Stremio UFC Metadata Addon — entry point
const config = require('./config');
const APP_VERSION = require('./package.json').version || '?';

// 0.27.0: capture every console line into an in-memory ring buffer so the
// admin /logs page can render recent activity without SSH. Wrap BEFORE other
// modules load so their boot-time logs are captured too.
const logBuffer = require('./lib/log-buffer');
logBuffer.wrapConsole(console);

const { createApp } = require('./addon');
const store = require('./lib/store');
const { runRefresh } = require('./scripts/refresh');

// SESSION_SECRET hard-fail (0.22.2). If unset or too short, sessions fall back
// to a derived secret that can be guessed across default-config instances,
// which is unsafe for any deployment that lets other people log in. Refuse to
// boot instead of silently using the weak fallback. Dev-only escape hatch:
// ALLOW_INSECURE_SECRET=1 (use only when iterating locally).
(function enforceSessionSecret() {
  const secret = process.env.SESSION_SECRET || '';
  const allowInsecure = process.env.ALLOW_INSECURE_SECRET === '1';
  if (secret.length >= 32) return;
  if (allowInsecure) {
    console.warn('[nzb-sport-pro] WARNING: weak/missing SESSION_SECRET allowed via ALLOW_INSECURE_SECRET=1 — dev only, never use in production.');
    return;
  }
  console.error('[nzb-sport-pro] FATAL: SESSION_SECRET must be set to a random string of at least 32 characters.');
  console.error('  Generate one with:  openssl rand -hex 32');
  console.error('  Then set it in your .env (or docker-compose env block) and restart.');
  console.error('  (Set ALLOW_INSECURE_SECRET=1 to bypass this check for local development ONLY.)');
  process.exit(1);
})();

const app = createApp();

// Warm the cache on boot so the first request is fast.
const initial = store.loadFromDisk();
const initialCount = (initial.events || []).length;
console.log(`[nzb-sport-pro] version ${APP_VERSION}`);
console.log(`[nzb-sport-pro] loaded ${initialCount} events from cache (${config.dataFile})`);

// Start HTTP first, then handle background work.
const server = app.listen(config.port, config.host, () => {
  console.log(`[nzb-sport-pro] listening on http://${config.host}:${config.port}`);
  scheduleBackgroundWork(initialCount);
});

function scheduleBackgroundWork(currentCount) {
  // Empty cache: refresh right away in the background.
  if (config.refreshOnEmptyCache && currentCount === 0) {
    console.log('[nzb-sport-pro] cache empty — kicking off initial refresh in background');
    runRefresh({ log: (m) => console.log(m) }).catch((err) => {
      console.error('[nzb-sport-pro] initial refresh failed:', err.message);
    });
  } else if (currentCount === 0) {
    console.log('[nzb-sport-pro] cache empty — run `npm run refresh` to populate.');
  }

  // Periodic refresh.
  const hours = config.refreshIntervalHours;
  if (hours > 0) {
    const ms = Math.round(hours * 60 * 60 * 1000);
    console.log(`[nzb-sport-pro] scheduling refresh every ${hours}h`);
    const t = setInterval(() => {
      runRefresh({ log: (m) => console.log(m) }).catch((err) => {
        console.error('[nzb-sport-pro] scheduled refresh failed:', err.message);
      });
    }, ms);
    if (typeof t.unref === 'function') t.unref();
  } else {
    console.log('[nzb-sport-pro] periodic refresh disabled (REFRESH_INTERVAL_HOURS=0)');
  }

}

// Graceful shutdown so Docker's SIGTERM closes connections cleanly.
function shutdown(signal) {
  console.log(`[nzb-sport-pro] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
