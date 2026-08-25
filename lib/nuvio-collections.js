'use strict';

const config = require('../config');
const promotions = require('./promotions');
const { orderByIds } = require('./catalog-order');
const { effectiveCatalogSelection } = require('./catalog-selection');

// Product-specific stable IDs let Nuvio update a regenerated NZB-Sport-Pro
// collection without colliding with an installed SeriousSportSync collection.
const COLLECTION_ID = '832e630c-aea4-4619-a81b-280a7b4cbdcd';
const FOLDERS = [
  {
    id: '72bb960a-a63d-47bb-b838-98d9f5683a7e',
    title: 'Combat Sports',
    promotions: ['ufc', 'one', 'boxing'],
    artwork: 'collection-combat-sports.png',
  },
  {
    id: '921e23c5-e49d-46d2-9352-4a86265e2000',
    title: 'Wrestling',
    promotions: ['wwe', 'aew'],
    artwork: 'collection-wrestling.png',
  },
  {
    id: '524ba079-0eea-4127-b6d6-5ba028ee31d7',
    title: 'Football',
    promotions: ['motd', 'manutd'],
    artwork: 'collection-football.png',
  },
  {
    id: '08a91b3f-c3f9-4fe1-8fa8-b0ebf3141824',
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
  const selected = effectiveCatalogSelection(cfg);
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
    title: 'NZB-Sport-Pro',
    folders,
    pinToTop: false,
    viewMode: 'ROWS',
    showAllTab: true,
    backdropImageUrl: origin ? origin + '/assets/logo-banner.png' : null,
  }];
}

module.exports = { buildNuvioCollections, COLLECTION_ID, FOLDERS };
