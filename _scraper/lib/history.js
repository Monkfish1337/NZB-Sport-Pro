// Persistent /scrape call history. JSON file under data/, ring-buffered
// at config.historyMax. The History page reads this on every load.

const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = path.join(config.dataDir, 'history.json');

function ensureDir() {
  const d = path.dirname(FILE);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function load() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch (_) { return []; }
}

function save(entries) {
  ensureDir();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries.slice(-config.historyMax), null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

function record(entry) {
  const all = load();
  all.push(entry);
  save(all);
}

function list() { return load().slice().reverse(); }   // newest first
function clear() { save([]); }

module.exports = { record, list, clear };
