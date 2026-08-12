// 0.38.0 — Per-user rate limiter for the /warm route.
//
// The warm pseudo-streams let a logged-in user click "🔥 Warm to TorBox" on
// an uncached candidate, which submits the magnet to their TorBox account.
// Without a limiter, a user mashing the button (or several pseudo-streams in
// a row) could fire dozens of createTorrent calls in seconds — which is
// exactly the 0.26.2-era trigger for TorBox 429 cascades. So we cap each
// user to N warms per M seconds.
//
// In-memory, single-process. Multi-instance deployments don't share state —
// fine for single-user / homelab installs which is the primary use case.
//
// Tunable via env: WARM_RATE_LIMIT_COUNT (default 10), WARM_RATE_LIMIT_WINDOW_SEC (default 60).

const COUNT = Math.max(1, parseInt(process.env.WARM_RATE_LIMIT_COUNT || '10', 10));
const WINDOW_MS = Math.max(1000, parseInt(process.env.WARM_RATE_LIMIT_WINDOW_SEC || '60', 10) * 1000);

const buckets = new Map();   // userId -> [timestampMs, ...]

// Returns { ok: true } if the request can proceed, or
// { ok: false, retryAfterSec } if rate-limited.
//
// Side effect: when ok, records this request in the bucket.
function check(userId) {
  if (!userId) return { ok: false, retryAfterSec: 60 };
  const now = Date.now();
  let bucket = buckets.get(userId);
  if (!bucket) { bucket = []; buckets.set(userId, bucket); }
  // Drop entries outside the window.
  while (bucket.length && bucket[0] < now - WINDOW_MS) bucket.shift();
  if (bucket.length >= COUNT) {
    const oldest = bucket[0];
    const retry = Math.ceil((oldest + WINDOW_MS - now) / 1000);
    return { ok: false, retryAfterSec: Math.max(1, retry) };
  }
  bucket.push(now);
  return { ok: true };
}

// Memory hygiene — purge buckets that haven't been touched in 10 windows.
// Called periodically; harmless if called frequently.
function gc() {
  const cutoff = Date.now() - WINDOW_MS * 10;
  for (const [uid, bucket] of buckets) {
    if (!bucket.length || bucket[bucket.length - 1] < cutoff) {
      buckets.delete(uid);
    }
  }
}
setInterval(gc, WINDOW_MS * 5).unref();

module.exports = {
  check,
  // Exposed for tests / health page.
  _bucketCount: () => buckets.size,
  COUNT,
  WINDOW_MS,
};
