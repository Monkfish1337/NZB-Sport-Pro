'use strict';

// Persistent public configuration store.
//
// Installed addon URLs receive a use-only token (pc1.<id>.<signature>). The
// separate edit token is carried in a URL fragment, so it is not sent in HTTP
// request paths or recorded by reverse-proxy access logs. Configuration values
// remain AES-GCM encrypted through public-config.js while at rest.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const publicConfig = require('./public-config');

const FILE = config.publicConfigsFile || './data/public-configs.json';
const VERSION = 1;
const ACCESS_PREFIX = 'pc1';
const EDIT_PREFIX = 'pe1';
const parsedMaxRecords = parseInt(process.env.PUBLIC_CONFIG_MAX_RECORDS || '10000', 10);
const MAX_RECORDS = Number.isFinite(parsedMaxRecords) ? Math.max(100, parsedMaxRecords) : 10000;
let healthCache = null;

function masterKey(purpose) {
  return crypto.createHmac('sha256', String(config.sessionSecret || ''))
    .update('nzb-sport-pro:public-config-store:' + purpose)
    .digest();
}

function digestEditSecret(secret) {
  return crypto.createHmac('sha256', masterKey('edit'))
    .update(String(secret || ''))
    .digest('base64url');
}

function accessSecret(id, nonce) {
  return crypto.createHmac('sha256', masterKey('access'))
    // Records created before access rotation existed had no nonce. Preserve
    // their original token until the owner deliberately rotates it.
    .update(String(id || '') + (nonce ? ':' + String(nonce) : ''))
    .digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function emptyState() { return { version: VERSION, records: [] }; }

function loadAll(strict) {
  try {
    if (!fs.existsSync(FILE)) return emptyState();
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.records)) {
      if (strict) throw new Error('Public configuration store has an unsupported format; refusing to overwrite it.');
      return emptyState();
    }
    return parsed;
  } catch (err) {
    console.error('[public-config-store] failed to load:', err.message);
    if (strict) throw new Error('Public configuration store is unreadable; refusing to overwrite it.');
    return emptyState();
  }
}

function saveAll(state) {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  healthCache = null;
}

function health() {
  if (!fs.existsSync(FILE)) {
    return { ok: true, exists: false, records: 0, readable: 0, unreadable: 0, maxRecords: MAX_RECORDS };
  }
  try {
    const stat = fs.statSync(FILE);
    const cacheKey = String(stat.size) + ':' + String(stat.mtimeMs);
    if (healthCache && healthCache.key === cacheKey) return Object.assign({}, healthCache.value);
    const state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!state || state.version !== VERSION || !Array.isArray(state.records)) {
      throw new Error('unsupported-format');
    }
    let readable = 0;
    let unreadable = 0;
    let updatedAt = null;
    for (const record of state.records) {
      try { publicConfig.decode(record && record.encryptedConfig); readable += 1; }
      catch (_) { unreadable += 1; }
      const timestamp = String(record && record.updatedAt || '');
      if (timestamp && (!updatedAt || timestamp > updatedAt)) updatedAt = timestamp;
    }
    const value = {
      ok: unreadable === 0,
      exists: true,
      records: state.records.length,
      readable,
      unreadable,
      maxRecords: MAX_RECORDS,
      updatedAt,
    };
    healthCache = { key: cacheKey, value };
    return Object.assign({}, value);
  } catch (_) {
    return {
      ok: false, exists: true, records: 0, readable: 0, unreadable: 0,
      maxRecords: MAX_RECORDS, error: 'store-unreadable',
    };
  }
}

function parseToken(token, prefix) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== prefix) return null;
  if (!/^[A-Za-z0-9_-]{16}$/.test(parts[1])) return null;
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(parts[2])) return null;
  return { id: parts[1], secret: parts[2] };
}

function buildAccessToken(record) {
  return ACCESS_PREFIX + '.' + record.id + '.' + accessSecret(record.id, record.accessNonce);
}

function create(input) {
  const state = loadAll(true);
  if (state.records.length >= MAX_RECORDS) throw new Error('Public configuration capacity reached.');
  let id;
  do { id = crypto.randomBytes(12).toString('base64url'); }
  while (state.records.some((record) => record.id === id));
  const editSecret = crypto.randomBytes(24).toString('base64url');
  const now = new Date().toISOString();
  state.records.push({
    id,
    accessNonce: crypto.randomBytes(16).toString('base64url'),
    editHash: digestEditSecret(editSecret),
    encryptedConfig: publicConfig.encode(input),
    createdAt: now,
    updatedAt: now,
  });
  saveAll(state);
  return {
    accessToken: buildAccessToken(state.records[state.records.length - 1]),
    editToken: EDIT_PREFIX + '.' + id + '.' + editSecret,
  };
}

function resolveAccess(token) {
  const parsed = parseToken(token, ACCESS_PREFIX);
  if (!parsed) return null;
  const record = loadAll().records.find((item) => item.id === parsed.id);
  if (!record || record.disabledAt
      || !safeEqual(parsed.secret, accessSecret(record.id, record.accessNonce))) return null;
  try { return publicConfig.decode(record.encryptedConfig); }
  catch (_) { return null; }
}

function listSummaries() {
  return loadAll().records.map((record) => {
    let decoded = null;
    try { decoded = publicConfig.decode(record && record.encryptedConfig); } catch (_) {}
    return {
      id: String(record && record.id || ''),
      createdAt: String(record && record.createdAt || ''),
      updatedAt: String(record && record.updatedAt || ''),
      disabledAt: String(record && record.disabledAt || ''),
      readable: Boolean(decoded),
      indexerCount: decoded && Array.isArray(decoded.newznabIndexers)
        ? decoded.newznabIndexers.length : 0,
      catalogCount: decoded && Array.isArray(decoded.catalogs)
        ? decoded.catalogs.length : 0,
      allCatalogs: Boolean(decoded && Array.isArray(decoded.catalogs) && decoded.catalogs.length === 0),
      maxStreams: decoded ? Number(decoded.maxStreams || 0) : 0,
      maxResultSizeGb: decoded ? Number(decoded.maxResultSizeGb || 0) : 0,
      excludePreShows: Boolean(decoded && decoded.excludePreShows),
    };
  }).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function setDisabledById(id, disabled) {
  id = String(id || '');
  if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return false;
  const state = loadAll(true);
  const record = state.records.find((item) => item.id === id);
  if (!record) return false;
  if (disabled) record.disabledAt = new Date().toISOString();
  else delete record.disabledAt;
  record.updatedAt = new Date().toISOString();
  saveAll(state);
  return true;
}

function removeById(id) {
  id = String(id || '');
  if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return false;
  const state = loadAll(true);
  const before = state.records.length;
  state.records = state.records.filter((record) => record.id !== id);
  if (state.records.length === before) return false;
  saveAll(state);
  return true;
}

function findByEdit(token, strict) {
  const parsed = parseToken(token, EDIT_PREFIX);
  if (!parsed) return null;
  const state = loadAll(strict);
  const record = state.records.find((item) => item.id === parsed.id);
  if (!record || !safeEqual(record.editHash, digestEditSecret(parsed.secret))) return null;
  return { state, record, parsed };
}

function resolveEdit(token) {
  const found = findByEdit(token, false);
  if (!found) return null;
  try {
    return {
      config: publicConfig.decode(found.record.encryptedConfig),
      accessToken: buildAccessToken(found.record),
    };
  } catch (_) {
    return null;
  }
}

function update(token, input) {
  const found = findByEdit(token, true);
  if (!found) return null;
  found.record.encryptedConfig = publicConfig.encode(input);
  found.record.updatedAt = new Date().toISOString();
  saveAll(found.state);
  return {
    accessToken: buildAccessToken(found.record),
    editToken: token,
  };
}

function rotateAccess(token) {
  const found = findByEdit(token, true);
  if (!found) return null;
  found.record.accessNonce = crypto.randomBytes(16).toString('base64url');
  found.record.updatedAt = new Date().toISOString();
  saveAll(found.state);
  return { accessToken: buildAccessToken(found.record), editToken: token };
}

function remove(token) {
  const found = findByEdit(token, true);
  if (!found) return false;
  found.state.records = found.state.records.filter((record) => record.id !== found.record.id);
  saveAll(found.state);
  return true;
}

module.exports = {
  create, resolveAccess, resolveEdit, update, rotateAccess, remove, health,
  listSummaries, setDisabledById, removeById,
  ACCESS_PREFIX, EDIT_PREFIX, MAX_RECORDS,
};
