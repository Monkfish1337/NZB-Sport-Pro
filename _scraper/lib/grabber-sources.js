// 0.2.0 — Grabber sources config persistence.
//
// Separate from lib/settings.js (which holds sport-scraping sources used by
// /scrape). The Grabber is a totally independent feature for general-purpose
// search + grab; operators want to enable a different set of indexers there
// (e.g. broader Prowlarr instances) without affecting the sport scraper.
//
// data/grabber-sources.json shape — identical to data/sources.json so we can
// reuse the source-type registry without changes:
//   {
//     "sources": [
//       { "id": "<short-id>", "type": "prowlarr"|"zilean"|"knaben"|"torznab",
//         "name": "<display>", "enabled": true, "config": {...source-specific...} },
//       ...
//     ],
//     "updatedAt": "ISO timestamp"
//   }
//
// Starts empty by design — no migration from sport sources. Operator
// explicitly populates via the new /grabber/sources GUI. This is the whole
// point of the split: clean separation of indexer config between contexts.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const FILE = path.join(config.dataDir, 'grabber-sources.json');

function ensureDir() {
  const d = path.dirname(FILE);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function loadAll() {
  try {
    if (!fs.existsSync(FILE)) return { sources: [] };
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return (j && Array.isArray(j.sources)) ? j : { sources: [] };
  } catch (_) { return { sources: [] }; }
}

function saveAll(state) {
  ensureDir();
  state.updatedAt = new Date().toISOString();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

function genId(type) {
  return type + '-' + crypto.randomBytes(2).toString('hex');
}

function listSources()    { return loadAll().sources.slice(); }
function enabledSources() { return loadAll().sources.filter((s) => s.enabled !== false); }
function getSource(id)    { return loadAll().sources.find((s) => s.id === id) || null; }

function addSource({ type, name, config: sourceConfig, enabled }) {
  if (!type) throw new Error('type required');
  const st = loadAll();
  const entry = {
    id: genId(type),
    type,
    name: (name || type).trim(),
    enabled: enabled !== false,
    config: sourceConfig || {},
    createdAt: new Date().toISOString(),
  };
  st.sources.push(entry);
  saveAll(st);
  return entry;
}

function updateSource(id, patch) {
  const st = loadAll();
  const s = st.sources.find((x) => x.id === id);
  if (!s) throw new Error('source not found');
  if (patch.name !== undefined)    s.name = String(patch.name).trim();
  if (patch.enabled !== undefined) s.enabled = !!patch.enabled;
  if (patch.config !== undefined)  s.config = Object.assign({}, s.config, patch.config);
  saveAll(st);
  return s;
}

function deleteSource(id) {
  const st = loadAll();
  const before = st.sources.length;
  st.sources = st.sources.filter((s) => s.id !== id);
  if (st.sources.length === before) return false;
  saveAll(st);
  return true;
}

function replaceAll(entries) {
  if (!Array.isArray(entries)) throw new Error('entries must be an array');
  const cleaned = entries.map((e) => {
    if (!e || typeof e !== 'object') throw new Error('entry is not an object');
    if (!e.type) throw new Error('entry missing type');
    return {
      id: e.id || genId(e.type),
      type: String(e.type),
      name: String(e.name || e.type).trim(),
      enabled: e.enabled !== false,
      config: e.config && typeof e.config === 'object' ? e.config : {},
      createdAt: e.createdAt || new Date().toISOString(),
    };
  });
  saveAll({ sources: cleaned });
  return cleaned;
}

module.exports = {
  listSources, enabledSources, getSource,
  addSource, updateSource, deleteSource, replaceAll,
};
