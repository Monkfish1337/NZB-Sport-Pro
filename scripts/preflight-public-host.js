'use strict';

// Read-only production preflight. Values are never printed.
const fs = require('fs');
const path = require('path');

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split < 1) continue;
    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

const envPath = path.resolve(process.argv[2] || '.env');
const fileEnv = parseEnvFile(envPath);
const value = (name) => Object.prototype.hasOwnProperty.call(process.env, name)
  ? String(process.env[name] || '') : String(fileEnv[name] || '');
const errors = [];
const warnings = [];
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line && !line.startsWith('#') && /^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)) {
      errors.push('.env line ' + (index + 1) + ' must use KEY=value syntax, not KEY: value.');
    }
  });
}
const requireLength = (name, minimum) => {
  if (value(name).length < minimum) errors.push(name + ' must contain at least ' + minimum + ' characters.');
};

requireLength('SESSION_SECRET', 32);
requireLength('SETUP_TOKEN', 24);
requireLength('ADMIN_USER', 1);
requireLength('ADMIN_PASSWORD', 12);
const secrets = ['SESSION_SECRET', 'SETUP_TOKEN', 'ADMIN_PASSWORD'].map(value);
if (secrets.every(Boolean) && new Set(secrets).size !== secrets.length) {
  errors.push('SESSION_SECRET, SETUP_TOKEN, and ADMIN_PASSWORD must be distinct.');
}

try {
  const parsed = new URL(value('PUBLIC_URL'));
  if (parsed.protocol !== 'https:') errors.push('PUBLIC_URL must use HTTPS.');
  if (parsed.username || parsed.password) errors.push('PUBLIC_URL must not contain credentials.');
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    errors.push('PUBLIC_URL must be an origin only, without a path, query, or fragment.');
  }
} catch (_) { errors.push('PUBLIC_URL must be a valid absolute URL.'); }

if (value('TRUST_PROXY_HEADERS').toLowerCase() !== 'cloudflare') {
  errors.push('TRUST_PROXY_HEADERS must be cloudflare for the documented tunnel topology.');
}
for (const name of [
  'ALLOW_INSECURE_SECRET', 'NATIVE_NEWZNAB_ALLOW_PRIVATE',
  'NATIVE_NEWZNAB_ALLOW_HTTP', 'NATIVE_NEWZNAB_ALLOW_PROXY',
]) {
  if (/^(1|true|yes|on)$/i.test(value(name))) errors.push(name + ' must be disabled for public hosting.');
}

const composePath = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
  .map((name) => path.resolve(name)).find((file) => fs.existsSync(file));
if (!composePath
    || !/127\.0\.0\.1:[0-9]{1,5}:7000/.test(fs.readFileSync(composePath, 'utf8'))) {
  errors.push('The Compose file must bind container port 7000 to a 127.0.0.1 host port only.');
}
if (fs.existsSync(envPath) && process.platform !== 'win32') {
  const mode = fs.statSync(envPath).mode & 0o777;
  if ((mode & 0o077) !== 0) warnings.push('.env should be restricted with chmod 600.');
}

warnings.forEach((item) => console.warn('WARN: ' + item));
if (errors.length) {
  errors.forEach((item) => console.error('FAIL: ' + item));
  process.exitCode = 1;
} else console.log('PASS: public-host environment and loopback origin checks succeeded.');
