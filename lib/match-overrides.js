// 0.35.0 — Match override store.
//
// Persists admin edits to per-promotion matching rules without touching code.
// Two override types per promotion:
//   - locationAliases: extra alias entries for location-based promotions
//     (MotoGP, F1) — TSDB location -> list of release-name variants. Added
//     ON TOP of the hardcoded defaults; you cannot remove a default.
//   - noisePatterns: extra rejection regex patterns applied during the noise
//     filter stage of /stream (e.g. promotion-specific show formats that
//     pollute results). Compiled at read-time with safe error handling.
//
// Schema (data/match-overrides.json):
//   {
//     version: 1,
//     overrides: {
//       motogp: {
//         locationAliases: {
//           "united kingdom": ["united kingdom", "british", "silverstone"],
//           "australia":      ["australia", "australian", "phillip island"]
//         },
//         noisePatterns: [
//           "\\bgrandstand\\b"
//         ]
//       },
//       f1: { ... }
//     },
//     updatedAt: ISO
//   }
//
// Reads are uncached on each call — file is tiny (<1KB typical) and only
// hit a few times per /stream call. Hot-reload is automatic: any /admin
// save writes the file, and the next /stream call sees the new overrides
// without a container restart. Atomic .tmp+rename pattern mirrors lib/users.js.

const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = (config && config.matchOverridesFile) || './data/match-overrides.json';
const VERSION = 1;

// Read the override file. Returns the empty default if missing / corrupted.
// Never throws — callers can rely on getting a valid shape.
function load() {
  try {
    if (!fs.existsSync(FILE)) return emptyState();
    const raw = fs.readFileSync(FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.overrides) return emptyState();
    return data;
  } catch (err) {
    console.error('[match-overrides] load failed: ' + err.message);
    return emptyState();
  }
}

function emptyState() {
  return { version: VERSION, overrides: {}, updatedAt: null };
}

// Atomic write — same pattern as lib/users.js.
function save(state) {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const toWrite = {
    version: VERSION,
    overrides: (state && state.overrides) || {},
    updatedAt: new Date().toISOString(),
  };
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(toWrite, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

// Get the merged alias map for a promotion. Returns a fresh object — safe to
// pass to a caller that mutates it (e.g. for case-insensitive lookups).
//
// Merge rules:
//   - All default keys appear verbatim.
//   - Override entries with the same key APPEND extras (de-duped, lowercased).
//   - Override entries with NEW keys add them as standalone aliases lists.
//
// Defaults can be extended but not removed via the UI.
function getMergedAliases(promotionId, defaults) {
  const all = load();
  const pOver = (all.overrides && all.overrides[promotionId]) || {};
  const locOver = pOver.locationAliases || {};
  const merged = {};
  // Copy defaults first (preserving their lists).
  if (defaults && typeof defaults === 'object') {
    for (const [k, v] of Object.entries(defaults)) {
      merged[k.toLowerCase()] = Array.isArray(v) ? v.slice() : [];
    }
  }
  // Apply overrides on top.
  for (const [rawKey, extras] of Object.entries(locOver)) {
    if (!rawKey || !Array.isArray(extras)) continue;
    const lc = String(rawKey).toLowerCase();
    const base = merged[lc] ? merged[lc].slice() : [];
    for (const a of extras) {
      const al = String(a || '').toLowerCase().trim();
      if (!al) continue;
      if (!base.includes(al)) base.push(al);
    }
    merged[lc] = base;
  }
  return merged;
}

// Get the merged noise-rejection pattern list for a promotion. Returns a
// concatenated array of (defaults + override strings). Caller compiles to
// regex with their own error handling (bad UI input shouldn't crash filter).
function getMergedNoisePatterns(promotionId, defaults) {
  const all = load();
  const pOver = (all.overrides && all.overrides[promotionId]) || {};
  const extra = Array.isArray(pOver.noisePatterns) ? pOver.noisePatterns : [];
  const base = Array.isArray(defaults) ? defaults.slice() : [];
  for (const p of extra) {
    const s = String(p || '').trim();
    if (s) base.push(s);
  }
  return base;
}

// Compile an override pattern to RegExp, with safe error handling. Returns
// null for bad input so callers can skip silently.
function compileOverridePattern(s, flags) {
  try { return new RegExp(s, flags || 'i'); }
  catch (_) { return null; }
}

// Mutators — used by the /admin/match-editor route handlers.

// Replace a promotion's overrides entirely (or remove if patch is null/empty).
function setPromotionOverrides(promotionId, overrides) {
  if (!promotionId) throw new Error('promotionId required');
  const state = load();
  if (!state.overrides) state.overrides = {};
  if (!overrides || (
    (!overrides.locationAliases || Object.keys(overrides.locationAliases).length === 0) &&
    (!overrides.noisePatterns   || overrides.noisePatterns.length === 0)
  )) {
    delete state.overrides[promotionId];
  } else {
    // Defensive normalization — locationAliases keys lowercased + de-duped lists.
    const normLoc = {};
    if (overrides.locationAliases && typeof overrides.locationAliases === 'object') {
      for (const [k, v] of Object.entries(overrides.locationAliases)) {
        const lk = String(k || '').toLowerCase().trim();
        if (!lk || !Array.isArray(v)) continue;
        const seen = new Set();
        const list = [];
        for (const a of v) {
          const al = String(a || '').toLowerCase().trim();
          if (al && !seen.has(al)) { seen.add(al); list.push(al); }
        }
        if (list.length) normLoc[lk] = list;
      }
    }
    const normNoise = [];
    if (Array.isArray(overrides.noisePatterns)) {
      for (const p of overrides.noisePatterns) {
        const s = String(p || '').trim();
        if (s) normNoise.push(s);
      }
    }
    state.overrides[promotionId] = {
      locationAliases: normLoc,
      noisePatterns: normNoise,
    };
  }
  save(state);
  return state.overrides[promotionId] || null;
}

// Surface the raw per-promotion overrides (for the editor to display the
// current override state — distinct from the merged-with-defaults view).
function getPromotionOverrides(promotionId) {
  const all = load();
  return (all.overrides && all.overrides[promotionId]) || { locationAliases: {}, noisePatterns: [] };
}

module.exports = {
  load,
  save,
  getMergedAliases,
  getMergedNoisePatterns,
  compileOverridePattern,
  setPromotionOverrides,
  getPromotionOverrides,
};
