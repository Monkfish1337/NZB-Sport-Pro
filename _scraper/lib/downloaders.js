// Downloaders config persistence.
//
// Separate from sources.json — these are *targets* (where to send grabbed
// content), not sources (where to fetch listings from). The general-search
// feature uses them: an operator clicks "qBit" or "SAB" on a result row and
// /api/grab dispatches via the configured downloader.
//
// data/downloaders.json shape:
//   {
//     "qbit": { "url": "...", "username": "...", "password": "...", "category": "general" },
//     "sab":  { "url": "...", "apiKey": "...", "category": "general" },
//     "updatedAt": "ISO timestamp"
//   }
//
// Env fallbacks (QBIT_URL / QBIT_USERNAME / QBIT_PASSWORD / QBIT_CATEGORY,
// SAB_URL / SAB_APIKEY / SAB_CATEGORY) provide bootstrap defaults — saved
// values override.

const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = path.join(config.dataDir, 'downloaders.json');

function ensureDir() {
  const d = path.dirname(FILE);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function loadAll() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return (j && typeof j === 'object') ? j : {};
  } catch (_) { return {}; }
}

function saveAll(state) {
  ensureDir();
  state.updatedAt = new Date().toISOString();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

function str(v) { return typeof v === 'string' ? v.trim() : ''; }

function getQbit() {
  const q = loadAll().qbit || {};
  return {
    url:      str(q.url)      || (process.env.QBIT_URL || ''),
    username: str(q.username) || (process.env.QBIT_USERNAME || ''),
    password: str(q.password) || (process.env.QBIT_PASSWORD || ''),
    category: str(q.category) || (process.env.QBIT_CATEGORY || 'general'),
  };
}

function setQbit({ url, username, password, category }) {
  const st = loadAll();
  st.qbit = {
    url:      str(url),
    username: str(username),
    password: str(password),
    category: str(category) || 'general',
  };
  saveAll(st);
  return st.qbit;
}

function getSab() {
  const s = loadAll().sab || {};
  return {
    url:      str(s.url)      || (process.env.SAB_URL || ''),
    apiKey:   str(s.apiKey)   || (process.env.SAB_APIKEY || ''),
    category: str(s.category) || (process.env.SAB_CATEGORY || 'general'),
  };
}

function setSab({ url, apiKey, category }) {
  const st = loadAll();
  st.sab = {
    url:      str(url),
    apiKey:   str(apiKey),
    category: str(category) || 'general',
  };
  saveAll(st);
  return st.sab;
}

// 0.2.2 — TorBox as a downloader target. URL is optional (defaults to the
// public TorBox API). "category" is stored for consistency with qBit/SAB but
// TorBox doesn't have categories — it's ignored at grab time.
function getTorbox() {
  const t = loadAll().torbox || {};
  return {
    url:      str(t.url)      || (process.env.TORBOX_URL || 'https://api.torbox.app/v1/api'),
    apiKey:   str(t.apiKey)   || (process.env.TORBOX_APIKEY || ''),
    category: str(t.category) || (process.env.TORBOX_CATEGORY || 'general'),
  };
}

function setTorbox({ url, apiKey, category }) {
  const st = loadAll();
  st.torbox = {
    url:      str(url)      || 'https://api.torbox.app/v1/api',
    apiKey:   str(apiKey),
    category: str(category) || 'general',
  };
  saveAll(st);
  return st.torbox;
}

module.exports = { getQbit, setQbit, getSab, setSab, getTorbox, setTorbox };
