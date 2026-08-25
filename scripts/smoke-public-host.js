'use strict';

// Non-mutating smoke test for an already deployed public origin.
const fs = require('fs');

function envFromFile(name) {
  if (!fs.existsSync('.env')) return '';
  const prefix = name + '=';
  const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith(prefix));
  if (!line) return '';
  return line.trim().slice(prefix.length).trim().replace(/^(['"])(.*)\1$/, '$2');
}

const rawOrigin = process.argv[2] || process.env.PUBLIC_URL || envFromFile('PUBLIC_URL');
let origin;
try { origin = new URL(rawOrigin).origin; }
catch (_) {
  console.error('Usage: node scripts/smoke-public-host.js https://your-public-origin');
  process.exit(1);
}
if (!origin.startsWith('https://')) {
  console.error('Refusing to smoke-test a non-HTTPS public origin.');
  process.exit(1);
}

function assert(condition, message) { if (!condition) throw new Error(message); }
async function get(route) {
  const response = await fetch(origin + route, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  return { response, text: await response.text() };
}

(async () => {
  const health = await get('/health');
  assert(health.response.status === 200, '/health returned HTTP ' + health.response.status);
  const healthJson = JSON.parse(health.text);
  assert(healthJson.ok === true, '/health did not report ok=true');
  assert(healthJson.configStore && healthJson.configStore.ok === true,
    '/health did not report a healthy configuration store');

  const configure = await get('/configure');
  assert(configure.response.status === 200, '/configure returned HTTP ' + configure.response.status);
  assert(/no-store/i.test(configure.response.headers.get('cache-control') || ''),
    '/configure is missing Cache-Control: no-store');
  assert(/max-age=31536000/i.test(configure.response.headers.get('strict-transport-security') || ''), 'HSTS is missing');
  assert((configure.response.headers.get('x-content-type-options') || '').toLowerCase() === 'nosniff',
    'X-Content-Type-Options is missing');
  assert((configure.response.headers.get('x-frame-options') || '').toUpperCase() === 'DENY',
    'X-Frame-Options is not DENY');
  assert(/default-src 'self'/.test(configure.response.headers.get('content-security-policy') || ''),
    'Content-Security-Policy is missing');

  const login = await get('/login');
  assert(login.response.status === 200, '/login returned HTTP ' + login.response.status);
  const setup = await get('/setup');
  assert(setup.response.status === 410,
    '/setup should be retired by environment admin but returned HTTP ' + setup.response.status);
  console.log('PASS: public HTTPS, health, store, security headers, login, and setup retirement verified.');
})().catch((err) => {
  console.error('FAIL: ' + err.message);
  process.exitCode = 1;
});
