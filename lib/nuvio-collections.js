'use strict';

const config = require('../config');
const promotions = require('./promotions');
const { orderByIds } = require('./catalog-order');

// Stable IDs let Nuvio recognise a regenerated SSS template as the same
// collection instead of creating fresh duplicates on every import.
const COLLECTION_ID = '629ef7ae-1a48-4e83-8ab3-0cb1f15534b0';
const FOLDERS = [
  {
    id: 'ad92f4cb-2815-4178-912c-8871e5f28596',
    title: 'Combat Sports',
    promotions: ['ufc', 'one', 'boxing'],
    artwork: 'collection-combat-sports.png',
  },
  {
    id: 'b276a42e-164f-4170-b383-b838a75facb5',
    title: 'Wrestling',
    promotions: ['wwe', 'aew'],
    artwork: 'collection-wrestling.png',
  },
  {
    id: '0bf2a789-b07e-43d3-9c15-b9aac44c9e63',
    title: 'Football',
    promotions: ['motd'],
    artwork: 'collection-football.png',
  },
  {
    id: 'ee428642-b118-4f85-b64b-a2867636f57e',
    title: 'Motorsport',
    promotions: ['f1', 'motogp'],
    artwork: 'collection-motorsport.png',
  },
];

function fullSource(catalogId) {
  return {
    type: config.addonType,
    genre: null,
    title: null,
    sortBy: null,
    tmdbId: null,
    addonId: config.addonId,
    filters: null,
    sortHow: null,
    provider: 'addon',
    catalogId,
    mediaType: null,
    traktListId: null,
    tmdbSourceType: null,
  };
}

function compactSource(catalogId) {
  return {
    type: config.addonType,
    genre: null,
    addonId: config.addonId,
    catalogId,
  };
}

function buildNuvioCollections(opts) {
  opts = opts || {};
  const cfg = (opts.user && opts.user.config) || {};
  const origin = String(opts.origin || '').replace(/\/+$/, '');
  const selected = Array.isArray(cfg.catalogs) && cfg.catalogs.length
    ? new Set(cfg.catalogs)
    : null;
  const orderedPromotions = orderByIds(promotions.enabled, cfg.promotionOrder, (p) => p.id);
  const promotionById = new Map(orderedPromotions.map((p) => [p.id, p]));

  const folders = FOLDERS.map((folder) => {
    const catalogIds = [];
    // Respect the user's promotion order within each sports folder.
    for (const p of orderedPromotions) {
      if (!folder.promotions.includes(p.id)) continue;
      const catalogs = orderByIds(p.catalogs, cfg.catalogOrder, (c) => c.id);
      for (const c of catalogs) {
        if (!selected || selected.has(c.id)) catalogIds.push(c.id);
      }
    }
    // Defensive check for registry changes while preserving folder definitions.
    if (!folder.promotions.some((id) => promotionById.has(id))) return null;
    if (catalogIds.length === 0) return null;
    const artworkUrl = origin ? origin + '/assets/' + folder.artwork : null;
    return {
      id: folder.id,
      title: folder.title,
      sources: catalogIds.map(fullSource),
      hideTitle: false,
      tileShape: 'landscape',
      coverEmoji: null,
      focusGifUrl: null,
      heroVideoUrl: null,
      titleLogoUrl: null,
      coverImageUrl: artworkUrl,
      catalogSources: catalogIds.map(compactSource),
      focusGifEnabled: false,
      heroBackdropUrl: artworkUrl,
    };
  }).filter(Boolean);

  return [{
    id: COLLECTION_ID,
    title: 'SeriousSportSync',
    folders,
    pinToTop: false,
    viewMode: 'ROWS',
    showAllTab: true,
    backdropImageUrl: origin ? origin + '/assets/logo-banner.png' : null,
  }];
}

module.exports = { buildNuvioCollections, COLLECTION_ID, FOLDERS };
