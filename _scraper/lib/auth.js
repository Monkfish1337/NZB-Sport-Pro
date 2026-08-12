// Optional bearer-token auth for /scrape.
//
// When SCRAPER_AUTH_TOKEN is empty, the endpoint is open. When set,
// every /scrape request must carry `Authorization: Bearer <token>`.
// Constant-time compare prevents timing leaks.

const crypto = require('crypto');
const config = require('../config');
const log = require('./log-buffer');

function safeEqual(a, b) {
  if (!a || !b) return false;
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function requireBearer(req, res, next) {
  if (!config.authToken) return next();
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m || !safeEqual(m[1], config.authToken)) {
    log.warn('http', 'auth: rejected /scrape from ' + (req.ip || '?'));
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

module.exports = { requireBearer };
