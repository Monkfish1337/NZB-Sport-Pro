'use strict';

const crypto = require('crypto');
const config = require('../config');
const nativeNewznab = require('./sources/native-newznab');
const { CURRENT_DEFAULTS_VERSION } = require('./catalog-selection');

const VERSION = 'v1';
const MAX_TOKEN_LENGTH = 24000;

function key() {
  return crypto.createHash('sha256')
    .update('nzb-sport-pro:public-config:' + String(config.sessionSecret || ''))
    .digest();
}

function normaliseInput(input) {
  input = input && typeof input === 'object' ? input : {};
  const torboxApiKey = String(input.torboxApiKey || '').trim().slice(0, 512);
  const rawIndexers = Array.isArray(input.newznabIndexers) ? input.newznabIndexers : [];
  const indexers = nativeNewznab.normalizeIndexerConfigs(
    rawIndexers.map((item) => ({
      name: String((item && item.name) || '').slice(0, 60),
      url: String((item && item.url) || '').slice(0, 1024),
      apiKey: String((item && item.apiKey) || '').slice(0, 512),
    }))
  );
  if (!torboxApiKey) throw new Error('TorBox API key is required.');
  if (indexers.length === 0) throw new Error('Add at least one Newznab indexer.');

  const catalogs = Array.isArray(input.catalogs)
    ? Array.from(new Set(input.catalogs.map((value) => String(value || '').trim()).filter(Boolean))).slice(0, 100)
    : [];
  const maxStreamsRaw = parseInt(String(input.maxStreams || '0'), 10);
  const maxStreams = Number.isFinite(maxStreamsRaw) && maxStreamsRaw >= 0 && maxStreamsRaw <= 20
    ? maxStreamsRaw : 0;
  const maxResultSizeRaw = Number.parseFloat(String(input.maxResultSizeGb || '0'));
  const maxResultSizeGb = Number.isFinite(maxResultSizeRaw)
    && maxResultSizeRaw >= 0 && maxResultSizeRaw <= 100
    ? Math.round(maxResultSizeRaw * 10) / 10 : 0;
  const excludePreShows = input.excludePreShows === true || input.excludePreShows === 'true';

  return {
    torboxApiKey,
    newznabIndexers: indexers,
    catalogs,
    showCatalogsOnHome: input.showCatalogsOnHome !== false && input.showCatalogsOnHome !== 'false',
    maxStreams,
    maxResultSizeGb,
    excludePreShows,
  };
}

function compact(input) {
  const value = normaliseInput(input);
  return {
    v: 1,
    tb: value.torboxApiKey,
    ix: value.newznabIndexers.map((item) => [item.name, item.url, item.apiKey]),
    c: value.catalogs,
    h: value.showCatalogsOnHome,
    m: value.maxStreams,
    z: value.maxResultSizeGb,
    x: value.excludePreShows,
  };
}

function expand(payload) {
  if (!payload || payload.v !== 1 || !Array.isArray(payload.ix)) {
    throw new Error('Unsupported configuration token.');
  }
  const value = normaliseInput({
    torboxApiKey: payload.tb,
    newznabIndexers: payload.ix.map((item) => ({
      name: Array.isArray(item) ? item[0] : '',
      url: Array.isArray(item) ? item[1] : '',
      apiKey: Array.isArray(item) ? item[2] : '',
    })),
    catalogs: payload.c,
    showCatalogsOnHome: payload.h,
    maxStreams: payload.m,
    maxResultSizeGb: payload.z,
    excludePreShows: payload.x,
  });
  return {
    torboxApiKey: value.torboxApiKey,
    torboxEnabled: false,
    uuEnabled: false,
    easynewsEnabled: false,
    nativeNewznabEnabled: true,
    newznabIndexers: value.newznabIndexers,
    catalogs: value.catalogs,
    catalogDefaultsVersion: CURRENT_DEFAULTS_VERSION,
    showCatalogsOnHome: value.showCatalogsOnHome,
    promotionOrder: [],
    catalogOrder: [],
    maxStreams: value.maxStreams,
    maxResultSizeGb: value.maxResultSizeGb,
    excludePreShows: value.excludePreShows,
    showWarmRows: false,
  };
}

function encode(input) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const plaintext = Buffer.from(JSON.stringify(compact(input)), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const token = [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  if (token.length > MAX_TOKEN_LENGTH) throw new Error('Configuration is too large.');
  return token;
}

function decode(token) {
  token = String(token || '');
  if (!token || token.length > MAX_TOKEN_LENGTH) throw new Error('Invalid configuration token.');
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Invalid configuration token.');
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error('shape');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return expand(JSON.parse(plaintext.toString('utf8')));
  } catch {
    throw new Error('Invalid or expired configuration token.');
  }
}

function identity(token) {
  return 'cfg-' + crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 20);
}

function configuredUser(token) {
  const id = identity(token);
  return {
    id,
    username: id,
    role: 'user',
    apiToken: '',
    config: decode(token),
  };
}

module.exports = { encode, decode, identity, configuredUser, normaliseInput, MAX_TOKEN_LENGTH };
