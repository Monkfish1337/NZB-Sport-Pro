'use strict';

// Dependency-free request guards for the single-process Compose build.
// Cloudflare limits remain useful at the edge; these application controls also
// protect indexer/TorBox quotas when the origin is reached directly.

const buckets = new Map();
const activeByGroup = new Map();
const activeByKey = new Map();
const parsedMaxBuckets = parseInt(process.env.REQUEST_GUARD_MAX_KEYS || '20000', 10);
const MAX_BUCKETS = Number.isFinite(parsedMaxBuckets) ? Math.max(1000, parsedMaxBuckets) : 20000;

function positiveInt(value, fallback, min, max) {
  const parsed = parseInt(String(value == null ? '' : value), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function pruneBuckets(now) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
    if (buckets.size < MAX_BUCKETS) break;
  }
}

function fixedWindow(options) {
  const opts = options || {};
  const name = String(opts.name || 'request');
  const windowMs = positiveInt(opts.windowMs, 60000, 1000, 24 * 60 * 60 * 1000);
  const max = positiveInt(opts.max, 10, 1, 100000);
  const keyFn = typeof opts.key === 'function' ? opts.key : (() => 'global');
  return (req, res, next) => {
    const now = Date.now();
    pruneBuckets(now);
    const subject = String(keyFn(req) || 'unknown').slice(0, 256);
    const mapKey = name + ':' + subject;
    let bucket = buckets.get(mapKey);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(mapKey, bucket);
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      const retry = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retry));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(429).json({ ok: false, error: 'Too many requests. Try again shortly.' });
    }
    return next();
  };
}

function concurrency(options) {
  const opts = options || {};
  const group = String(opts.name || 'request');
  const globalMax = positiveInt(opts.globalMax, 20, 1, 10000);
  const perKeyMax = positiveInt(opts.perKeyMax, 2, 1, 1000);
  const keyFn = typeof opts.key === 'function' ? opts.key : (() => 'global');
  return (req, res, next) => {
    const subject = String(keyFn(req) || 'unknown').slice(0, 256);
    const keyed = group + ':' + subject;
    const globalActive = activeByGroup.get(group) || 0;
    const keyActive = activeByKey.get(keyed) || 0;
    if (globalActive >= globalMax || keyActive >= perKeyMax) {
      res.setHeader('Retry-After', '5');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(429).json({ ok: false, error: 'This service is busy. Try again shortly.' });
    }
    activeByGroup.set(group, globalActive + 1);
    activeByKey.set(keyed, keyActive + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const nextGlobal = Math.max(0, (activeByGroup.get(group) || 1) - 1);
      const nextKey = Math.max(0, (activeByKey.get(keyed) || 1) - 1);
      if (nextGlobal) activeByGroup.set(group, nextGlobal); else activeByGroup.delete(group);
      if (nextKey) activeByKey.set(keyed, nextKey); else activeByKey.delete(keyed);
    };
    res.once('finish', release);
    res.once('close', release);
    return next();
  };
}

module.exports = { fixedWindow, concurrency, _test: { buckets, activeByGroup, activeByKey } };
