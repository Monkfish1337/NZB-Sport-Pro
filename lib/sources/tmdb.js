// 0.42.13 — TMDB source module.
//
// Adds The Movie Database as a metadata source for TV-style sports shows
// (Match of the Day, ITV highlights, boxing analysis shows, etc.) where the
// existing football-data.org / TSDB catalogs don't apply.
//
// Each show is identified by its numeric TMDB TV show ID. We pull the show's
// season list, then per-season episode list (with air_date), and treat each
// episode as an event whose "name" is the show title and whose air date drives
// the DARKSPORT-style search-title generation ("Show.Name.YYYY.MM.DD").
//
// TMDB API: https://developer.themoviedb.org/reference/tv-series-details

const fetch = require('node-fetch');
const httpAgent = require('../http-agent');

const BASE = 'https://api.themoviedb.org/3';

// Simple 1-req-per-250ms throttle. TMDB's public rate limit is generous
// (~40 req/sec) but courteous throttling never hurts.
let lastCall = 0;
async function rateLimitWait() {
  const delta = Date.now() - lastCall;
  const gap = 250;
  if (delta < gap) await new Promise((r) => setTimeout(r, gap - delta));
  lastCall = Date.now();
}

async function getJson(url, apiKey, opts) {
  const log = (opts && opts.log) || (() => {});
  await rateLimitWait();
  const sep = url.indexOf('?') === -1 ? '?' : '&';
  const fullUrl = url + sep + 'api_key=' + encodeURIComponent(apiKey);
  const res = await fetch(fullUrl, httpAgent.fetchOpts({
    headers: { Accept: 'application/json' },
    timeout: 15000,
  }, fullUrl));
  if (!res.ok) {
    let body = '';
    try { body = (await res.text()).slice(0, 200); } catch (_) { /* ignore */ }
    throw new Error('TMDB ' + res.status + ' ' + res.statusText + (body ? ': ' + body : ''));
  }
  return res.json();
}

// Fetch top-level TV show details (used by /admin validator + refresh).
async function lookupShow({ tvId, apiKey, log }) {
  if (!apiKey) throw new Error('TMDB_API_KEY not set');
  const url = BASE + '/tv/' + encodeURIComponent(tvId);
  return getJson(url, apiKey, { log });
}

// Fetch episode list for one season. TMDB returns { episodes: [{ air_date,
// episode_number, season_number, name, ... }, ...] }.
async function fetchSeason({ tvId, seasonNumber, apiKey, log }) {
  if (!apiKey) throw new Error('TMDB_API_KEY not set');
  const log2 = log || (() => {});
  const url = BASE + '/tv/' + encodeURIComponent(tvId) + '/season/' + encodeURIComponent(seasonNumber);
  log2('  tmdb: GET ' + url);
  const json = await getJson(url, apiKey, { log: log2 });
  if (!json) return { showName: '', episodes: [] };
  const episodes = Array.isArray(json.episodes) ? json.episodes : [];
  log2('  tmdb: season ' + seasonNumber + ' returned ' + episodes.length + ' episode(s)');
  return { showName: json.name || '', episodes };
}

// Fetch all episodes across the seasons listed in the show detail. Skips
// "Season 0" (specials) by default and any season with no aired episodes.
// Returns a flat list of episode objects, each augmented with the show name.
async function fetchAll({ tvId, apiKey, log, includeSpecials }) {
  const log2 = log || (() => {});
  const show = await lookupShow({ tvId, apiKey, log: log2 });
  if (!show || !show.name) throw new Error('TMDB show ' + tvId + ' not found');
  log2('  tmdb: show "' + show.name + '" (' + (show.seasons || []).length + ' season(s))');
  const wantSpecials = !!includeSpecials;
  const seasons = (show.seasons || [])
    .map((s) => Number(s.season_number))
    .filter((n) => Number.isFinite(n) && (wantSpecials || n > 0));
  const out = [];
  for (const s of seasons) {
    try {
      const { episodes } = await fetchSeason({ tvId, seasonNumber: s, apiKey, log: log2 });
      for (const ep of episodes) {
        if (!ep || !ep.air_date) continue;
        out.push({
          showName: show.name,
          tvId: Number(tvId),
          seasonNumber: Number(ep.season_number || s),
          episodeNumber: Number(ep.episode_number || 0),
          name: ep.name || show.name,
          air_date: ep.air_date,           // YYYY-MM-DD from TMDB
          overview: ep.overview || '',
          still_path: ep.still_path || null,
        });
      }
    } catch (err) {
      log2('  tmdb: season ' + s + ' failed: ' + err.message);
    }
  }
  log2('  tmdb: total ' + out.length + ' episode(s) across ' + seasons.length + ' season(s)');
  return out;
}

module.exports = {
  lookupShow,
  fetchSeason,
  fetchAll,
};
