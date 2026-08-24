// Admin per-event power tool (0.28.0).
//
// Sportarr-style admin actions for a single event: re-run the indexer search
// to refresh its candidate list, warm a chosen torrent onto the admin's TB/PM
// libraries, and verify cache state. Candidate results are short-lived and
// in-memory only; this tool never starts a catalog-wide search.
//
// Uses ADMIN_TB_TOKEN / ADMIN_PM_KEY as optional admin credentials. Never
// touches a user's per-account debrid keys.
//
// All functions are admin-only and assume the caller has already authorised.

const config = require('../config');
const store = require('./store');
const promotions = require('./promotions');
const tb = require('./sources/torbox');
const pm = require('./sources/premiumize');
const prowlarr = require('./sources/prowlarr');
const zilean = require('./sources/zilean');

// 0.28.2: per-admin-user cache of live-search results. The flow is:
//   1. Admin clicks "Search" → /live-search runs prowlarr.multiSearch and
//      stores the (normalised) results here keyed by adminId+eventId.
//   2. Page re-renders showing the live results table with checkboxes.
//   3. Admin ticks rows + clicks "Commit + warm" → /commit reads the hashes
//      from the form and pulls the full candidate objects out of this cache
//      (so we don't have to round-trip every metadata field through hidden
//      form fields).
// TTL prevents stale state from sitting around forever after a tab close.
const liveResultsCache = new Map();
const LIVE_TTL_MS = 30 * 60 * 1000;
const candidateResultsCache = new Map();
function setCandidateResults(eventId, results) {
  candidateResultsCache.set(String(eventId || ''), {
    ts: Date.now(), results: Array.isArray(results) ? results : [],
  });
}
function getCandidateResults(eventId) {
  const key = String(eventId || '');
  const entry = candidateResultsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > LIVE_TTL_MS) {
    candidateResultsCache.delete(key);
    return null;
  }
  return entry.results;
}
function liveKey(adminId, eventId) { return String(adminId || '') + '::' + String(eventId || ''); }
function setLiveResults(adminId, eventId, results, query) {
  liveResultsCache.set(liveKey(adminId, eventId), {
    ts: Date.now(), results, query: query || '',
  });
}
function getLiveResults(adminId, eventId) {
  const e = liveResultsCache.get(liveKey(adminId, eventId));
  if (!e) return null;
  if (Date.now() - e.ts > LIVE_TTL_MS) {
    liveResultsCache.delete(liveKey(adminId, eventId));
    return null;
  }
  return e;
}

// Lazy require streams.searchCandidates to avoid a require cycle (streams.js
// imports a lot of state that mid-boot might not be ready yet).
function lazySearch() { return require('./streams').searchCandidates; }

function getEvent(eventId) {
  if (!eventId) return null;
  return store.getEvent(eventId) || null;
}

function eventBrief(ev) {
  if (!ev) return null;
  const p = promotions.getByEventId(ev.id);
  return {
    id: ev.id,
    name: ev.name,
    date: ev.date,
    promotion: p ? p.id : null,
    aliases: (ev.aliases || []).slice(0, 8),
  };
}

// List events (filtered, sorted) for the picker. No paging — caller can show
// all 200ish in a datalist; browser handles substring filtering client-side.
function listEvents(opts) {
  const o = opts || {};
  let all = store.getEvents() || [];
  if (o.promotion) {
    all = all.filter((ev) => {
      const p = promotions.getByEventId(ev.id);
      return p && p.id === o.promotion;
    });
  }
  // Most recent first within each side of "today".
  const today = new Date().toISOString().slice(0, 10);
  return all
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map((ev) => ({
      id: ev.id,
      name: ev.name,
      date: ev.date,
      isPast: !!(ev.date && ev.date < today),
    }));
}

// Run an indexer search for this event and retain it briefly for this admin
// workflow. Normal /stream discovery is independent and request-only.
async function searchEvent(eventId, log) {
  const ev = getEvent(eventId);
  if (!ev) return { ok: false, reason: 'event-not-found' };
  log && log('[power-tool] searching indexers for ' + eventId + ' (' + ev.name + ')');
  const candidates = await lazySearch()(ev, (m) => log && log('  ' + m));
  setCandidateResults(eventId, candidates);
  log && log('[power-tool] retained ' + candidates.length + ' candidate(s) in memory');
  return { ok: true, count: candidates.length, candidates };
}

// Return this process's short-lived candidate list for an event.
function listCandidates(eventId) {
  const list = getCandidateResults(eventId);
  if (!Array.isArray(list)) return null;
  return list
    .slice()
    .sort((a, b) => (b.size || 0) - (a.size || 0));
}

// 0.28.1: like listCandidates but evaluates each candidate through the
// promotion's isRelevantStreamTitle() and tags it with relevant/rejection
// metadata. Sorts relevant rows first, then size-desc. Returns { candidates,
// total, relevant, indexers } so the page can show counts, pagination, and
// an indexer filter dropdown without re-computing.
function evaluateCandidates(eventId) {
  const ev = getEvent(eventId);
  if (!ev) return null;
  const list = getCandidateResults(eventId);
  if (!Array.isArray(list)) return null;
  const promotion = promotions.getByEventId(ev.id);
  const indexerSet = new Set();
  const evaluated = list.map((c) => {
    if (c.indexer) indexerSet.add(c.indexer);
    let relevant = true;
    let reason = null;
    if (promotion && typeof promotion.isRelevantStreamTitle === 'function') {
      try {
        const r = promotion.isRelevantStreamTitle(c.title || '', ev);
        if (r && r.ok === false) { relevant = false; reason = r.reason || 'rejected'; }
      } catch (e) { relevant = false; reason = 'eval-error'; }
    }
    return Object.assign({}, c, { relevant, rejectionReason: reason });
  });
  evaluated.sort((a, b) => {
    if (a.relevant !== b.relevant) return a.relevant ? -1 : 1;
    return (b.size || 0) - (a.size || 0);
  });
  return {
    candidates: evaluated,
    total: evaluated.length,
    relevant: evaluated.filter((c) => c.relevant).length,
    indexers: Array.from(indexerSet).sort(),
  };
}

// Warm a set of specific hashes on a provider using the admin's key.
// Returns per-hash success/failure. Uses the same provider.warmCache call
// as the (now-disabled) user-facing auto-warm.
async function warmHashes(eventId, hashes, providerCode, log) {
  const ev = getEvent(eventId);
  if (!ev) return { ok: false, reason: 'event-not-found' };
  const list = getCandidateResults(eventId);
  if (!Array.isArray(list)) return { ok: false, reason: 'no-candidates-in-session' };
  const wanted = new Set((hashes || []).map((h) => String(h || '').toLowerCase()));
  if (wanted.size === 0) return { ok: false, reason: 'no-hashes' };
  const targets = list.filter((c) => wanted.has(String(c.infoHash || '').toLowerCase()));
  if (targets.length === 0) return { ok: false, reason: 'no-matching-candidates' };

  const code = String(providerCode || '').toLowerCase();
  let provider, adminKey, keyArg;
  if (code === 'tb') {
    provider = tb; adminKey = (config.adminPowerTool && config.adminPowerTool.tbToken) || '';
    if (!adminKey) return { ok: false, reason: 'ADMIN_TB_TOKEN-not-set' };
    keyArg = { tb: adminKey };
  } else if (code === 'pm') {
    provider = pm; adminKey = (config.adminPowerTool && config.adminPowerTool.pmApiKey) || '';
    if (!adminKey) return { ok: false, reason: 'ADMIN_PM_KEY-not-set' };
    keyArg = { pm: adminKey };
  } else {
    return { ok: false, reason: 'unsupported-provider' };
  }

  // tb.warmCache + pm.warmCache only need ctx.buildMagnet + ctx.log + ctx.creds.
  // Inline buildMagnet here rather than importing streams.js (which would
  // drag the whole resolver into the admin path for one helper).
  function buildMagnet(result) {
    const isRealMagnet = result.magnetUrl && result.magnetUrl.startsWith('magnet:');
    if (isRealMagnet) return result.magnetUrl;
    return 'magnet:?xt=urn:btih:' + String(result.infoHash || '').toUpperCase()
      + '&dn=' + encodeURIComponent(result.title || '')
      + '&tr=' + encodeURIComponent('udp://tracker.opentrackr.org:1337/announce')
      + '&tr=' + encodeURIComponent('udp://tracker.openbittorrent.com:80/announce')
      + '&tr=' + encodeURIComponent('udp://exodus.desync.com:6969/announce');
  }
  const ctx = { buildMagnet, log: log || (() => {}), creds: keyArg };

  const results = [];
  for (const c of targets) {
    log && log('[power-tool] warm ' + code.toUpperCase() + ' ' + c.infoHash + ' (' + (c.title || '').slice(0, 80) + ')');
    let ok = false;
    try { ok = !!(await provider.warmCache(c, ctx)); }
    catch (e) { log && log('  warm error: ' + e.message); ok = false; }
    results.push({ infoHash: c.infoHash, title: c.title, ok });
  }
  log && log('[power-tool] warm complete — ' + results.filter((r) => r.ok).length + '/' + results.length + ' succeeded');
  return { ok: true, results };
}

// Re-run provider cache checks for this event's in-memory candidates.
async function reverifyEvent(eventId, log) {
  const ev = getEvent(eventId);
  if (!ev) return { ok: false, reason: 'event-not-found' };
  const list = getCandidateResults(eventId);
  if (!Array.isArray(list) || list.length === 0) return { ok: false, reason: 'no-candidates-in-session' };

  const tbToken  = (config.adminPowerTool && config.adminPowerTool.tbToken)  || '';
  const pmApiKey = (config.adminPowerTool && config.adminPowerTool.pmApiKey) || '';
  if (!tbToken && !pmApiKey) return { ok: false, reason: 'no-admin-provider-keys-set' };

  const hashes = list.map((c) => String(c.infoHash || '').toLowerCase()).filter(Boolean);
  log && log('[power-tool] re-verifying ' + hashes.length + ' candidate(s) for ' + eventId);

  let tbMap = new Map(), pmMap = new Map();
  if (tbToken) {
    try { tbMap = await tb.checkCachedBatch(hashes, tbToken, (m) => log && log('  ' + m)); }
    catch (e) { log && log('  tb verify error: ' + e.message); }
  }
  if (pmApiKey) {
    try { pmMap = await pm.cacheCheck(hashes, pmApiKey, (m) => log && log('  ' + m)); }
    catch (e) { log && log('  pm verify error: ' + e.message); }
  }
  const checkedAt = new Date().toISOString();
  let tbHits = 0, tbMisses = 0, pmHits = 0, pmMisses = 0;
  for (const c of list) {
    const h = String(c.infoHash || '').toLowerCase();
    const tbCached = tbMap.has(h) ? tbMap.get(h) : undefined;
    const pmCached = pmMap.has(h) ? pmMap.get(h) : undefined;
    if (tbCached === true) tbHits++; else if (tbCached === false) tbMisses++;
    if (pmCached === true) pmHits++; else if (pmCached === false) pmMisses++;
    if (tbCached !== undefined || pmCached !== undefined) {
      c.cachedProviders = {
        ...(c.cachedProviders || {}),
        ...(tbCached !== undefined ? { tb: tbCached } : {}),
        ...(pmCached !== undefined ? { pm: pmCached } : {}),
        checkedAt,
      };
    }
  }
  setCandidateResults(eventId, list);
  log && log('[power-tool] re-verify complete — TB: ' + tbHits + ' cached / ' + tbMisses + ' not, '
    + 'PM: ' + pmHits + ' cached / ' + pmMisses + ' not');
  return { ok: true, tbHits, tbMisses, pmHits, pmMisses };
}

// 0.28.2: live indexer search for the power tool. Unlike searchEvent above
// (which uses the addon's auto-generated aliases and retains results in memory),
// this takes a FREE-FORM query the admin typed, hits prowlarr.multiSearch
// (and optionally zilean.multiSearch + extra) live, dedupes by infoHash,
// and returns the raw results without applying
// any relevance filter. Admin sees everything the indexers return — they
// pick what to commit. Results are stashed in liveResultsCache so the
// commit step can look them up by hash without round-tripping every field
// through hidden form inputs.
async function liveSearch(adminId, eventId, query, indexers, log) {
  query = String(query || '').trim();
  if (!query) return { ok: false, reason: 'empty-query' };
  const want = new Set((indexers && indexers.length) ? indexers : ['prowlarr']);

  log && log('[power-tool] live search "' + query + '" across ' + Array.from(want).join(', '));
  const tasks = [];
  if (want.has('prowlarr')) {
    tasks.push(prowlarr.multiSearch([query], { log: (m) => log && log('  ' + m) }).catch((e) => {
      log && log('  prowlarr error: ' + e.message); return [];
    }));
  }
  if (want.has('zilean')) {
    tasks.push(zilean.multiSearch([query], { log: (m) => log && log('  ' + m) }).catch((e) => {
      log && log('  zilean error: ' + e.message); return [];
    }));
  }
  if (want.has('extra')) {
    let extra = null;
    try { extra = require('./sources/extra'); }
    catch { try { extra = require('./sources/local'); } catch { extra = null; } }
    if (extra && extra.multiSearch) {
      tasks.push(extra.multiSearch([query], { log: (m) => log && log('  ' + m) }).catch((e) => {
        log && log('  extra error: ' + e.message); return [];
      }));
    }
  }
  const all = await Promise.all(tasks);

  // Merge + dedupe by infoHash. Preserve indexer label from the first
  // source that returned the hash (so the admin sees where it came from).
  const merged = new Map();
  for (const list of all) {
    for (const r of (list || [])) {
      const h = String(r.infoHash || '').toLowerCase();
      if (!h) continue;
      if (!merged.has(h)) merged.set(h, r);
    }
  }
  const results = Array.from(merged.values())
    .sort((a, b) => (b.seeders || 0) - (a.seeders || 0));
  log && log('[power-tool] live search returned ' + results.length + ' unique hit(s)');
  setLiveResults(adminId, eventId, results, query);
  return { ok: true, count: results.length, query, results };
}

function getLastLiveSearch(adminId, eventId) {
  return getLiveResults(adminId, eventId);
}

// Commit picked candidates into this admin session, then optionally warm them
// on a provider. The warm step adds magnets to the admin's TB/PM library.
async function commitAndWarm(adminId, eventId, hashes, providerCode, log) {
  const ev = getEvent(eventId);
  if (!ev) return { ok: false, reason: 'event-not-found' };
  const live = getLiveResults(adminId, eventId);
  if (!live) return { ok: false, reason: 'no-live-results (run a search first)' };
  const wanted = new Set((hashes || []).map((h) => String(h || '').toLowerCase()));
  if (wanted.size === 0) return { ok: false, reason: 'no-hashes-selected' };

  const picks = live.results.filter((r) => wanted.has(String(r.infoHash || '').toLowerCase()));
  if (picks.length === 0) return { ok: false, reason: 'no-matching-live-results' };

  // Merge into existing in-memory event results,
  // upsert/overwrite by hash for the picks (so we get the freshest title
  // and indexer label, and any prior cachedProviders verdict gets preserved
  // unless the new pick has different info).
  const existing = getCandidateResults(eventId) || [];
  const byHash = new Map();
  for (const c of existing) byHash.set(String(c.infoHash || '').toLowerCase(), c);
  let added = 0, updated = 0;
  for (const p of picks) {
    const h = String(p.infoHash || '').toLowerCase();
    if (byHash.has(h)) {
      // Preserve cachedProviders verdict if any.
      const prev = byHash.get(h);
      byHash.set(h, Object.assign({}, prev, p, {
        cachedProviders: prev.cachedProviders || p.cachedProviders,
      }));
      updated++;
    } else {
      byHash.set(h, p);
      added++;
    }
  }
  const merged = Array.from(byHash.values());
  setCandidateResults(eventId, merged);
  log && log('[power-tool] retained ' + picks.length + ' pick(s) for ' + eventId + ' in memory (' + added + ' added, ' + updated + ' updated)');

  // Optional warm step.
  let warmResults = null;
  if (providerCode && providerCode !== 'none') {
    warmResults = await warmHashes(eventId, picks.map((p) => p.infoHash), providerCode, log);
  }
  return { ok: true, added, updated, picks: picks.length, warm: warmResults };
}

module.exports = {
  getEvent, eventBrief, listEvents,
  searchEvent, listCandidates, evaluateCandidates,
  warmHashes, reverifyEvent,
  liveSearch, getLastLiveSearch, commitAndWarm,
};
