const config = require('../config');
const promotions = require('./promotions');
const settings = require('./settings');
const APP_VERSION = require('../package.json').version || '0.0.0';

// Stremio addon manifest.
// Catalogs and idPrefixes derive from the enabled promotions registry, so
// adding a new promotion auto-expands the manifest. When called with
// `opts.user`, the user's stored debrid keys + catalog selection filter
// the result (Phase 2 multi-tenant).
function buildManifest(opts) {
  opts = opts || {};
  const userCfg = (opts.user && opts.user.config) || null;

  const envDebrid = !!(config.realDebrid.token || config.torbox.token || config.premiumize.apiKey);
  const userDebrid = !!(userCfg && (userCfg.rd || userCfg.tb || userCfg.pm));
  const anyDebrid = envDebrid || userDebrid;
  // 0.42.4 — Streams are advertised when at least one candidate source is
  // configured. Post-0.36.0 the primary source is the companion scraper
  // (delegates to Prowlarr/Zilean/Knaben/TheRARBG/bitsearch/bitmagnet). We
  // also count a directly-set NEWSNAB_URL (UU/nzbgeek) and per-user Easynews
  // credentials as valid sources. The legacy Prowlarr/Zilean settings.js
  // checks are retained for back-compat but nobody sets those anymore.
  const cs = settings.getCompanion();
  const pw = settings.getProwlarr();
  const haveCompanion = !!(cs && cs.url);
  const haveNewsnab = !!(process.env.NEWSNAB_URL || '').trim();
  const haveLegacy = !!((pw.url && pw.apiKey) || settings.getZilean().url);
  const haveEasynews = !!(userCfg && userCfg.easynews && userCfg.easynews.username);
  const haveSource = haveCompanion || haveNewsnab || haveEasynews || haveLegacy;
  const streamEnabled = haveSource;
  void anyDebrid;

  const idPrefixes = promotions.enabled.map((p) => p.idPrefix + ':');

  const resources = [
    { name: 'catalog', types: [config.addonType], idPrefixes },
    { name: 'meta',    types: [config.addonType], idPrefixes },
  ];
  if (streamEnabled) {
    resources.push({ name: 'stream', types: [config.addonType], idPrefixes });
  }

  const allCatalogs = [];
  for (const p of promotions.enabled) {
    for (const c of p.catalogs) {
      allCatalogs.push({
        type: config.addonType,
        id: c.id,
        name: c.name,
        extra: [{ name: 'search' }, { name: 'skip' }],
      });
    }
  }
  const selected = (userCfg && Array.isArray(userCfg.catalogs)) ? userCfg.catalogs : [];
  const catalogs = (selected.length > 0)
    ? allCatalogs.filter((c) => selected.includes(c.id))
    : allCatalogs;

  const baseOrigin = (opts.origin || config.publicUrl || '').replace(/\/+$/, '');
  const logo       = baseOrigin ? (baseOrigin + '/assets/logo.png')        : config.logo;
  const background = baseOrigin ? (baseOrigin + '/assets/logo-banner.png') : config.background;

  return {
    id: config.addonId,
    version: APP_VERSION,
    name: config.addonName,
    description: config.addonDescription,
    types: [config.addonType],
    catalogs,
    resources,
    idPrefixes,
    behaviorHints: { configurable: false, configurationRequired: false },
    logo,
    background,
  };
}

module.exports = { buildManifest };
