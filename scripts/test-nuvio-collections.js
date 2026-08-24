'use strict';

const assert = require('assert');
const config = require('../config');
const {
  buildNuvioCollections,
  COLLECTION_ID,
  FOLDERS,
} = require('../lib/nuvio-collections');

function catalogIds(folder) {
  return folder.sources.map((source) => source.catalogId);
}

function build(userConfig) {
  return buildNuvioCollections({
    origin: 'https://sss.example/',
    user: { config: userConfig || {} },
  });
}

const all = build();
assert.strictEqual(all.length, 1, 'exports exactly one SSS collection');
assert.strictEqual(all[0].id, COLLECTION_ID, 'uses the stable collection ID');
assert.deepStrictEqual(
  all[0].folders.map((folder) => folder.title),
  FOLDERS.map((folder) => folder.title),
  'exports all four sports folders in the template order',
);
assert.strictEqual(
  all[0].backdropImageUrl,
  'https://sss.example/assets/logo-banner.png',
  'normalises the public origin before constructing artwork URLs',
);

for (const folder of all[0].folders) {
  assert.ok(folder.sources.length > 0, folder.title + ' contains catalogs');
  assert.strictEqual(
    folder.sources.length,
    folder.catalogSources.length,
    folder.title + ' has matching full and compact source lists',
  );
  for (let i = 0; i < folder.sources.length; i += 1) {
    const full = folder.sources[i];
    const compact = folder.catalogSources[i];
    assert.strictEqual(full.addonId, config.addonId);
    assert.strictEqual(full.type, config.addonType);
    assert.strictEqual(full.provider, 'addon');
    assert.strictEqual(compact.addonId, full.addonId);
    assert.strictEqual(compact.type, full.type);
    assert.strictEqual(compact.catalogId, full.catalogId);
  }
}

const personalised = build({
  catalogs: ['aew-recent', 'wwe-upcoming', 'f1-race'],
  promotionOrder: ['aew', 'wwe', 'f1'],
  catalogOrder: ['aew-recent', 'wwe-upcoming', 'f1-race'],
});
assert.deepStrictEqual(
  personalised[0].folders.map((folder) => folder.title),
  ['Wrestling', 'Motorsport'],
  'omits folders with no enabled catalogs',
);
assert.deepStrictEqual(
  catalogIds(personalised[0].folders[0]),
  ['aew-recent', 'wwe-upcoming'],
  'applies the saved promotion and catalog order inside a folder',
);
assert.deepStrictEqual(
  catalogIds(personalised[0].folders[1]),
  ['f1-race'],
  'exports only enabled catalogs',
);

console.log('OK — Nuvio collection schema, filtering, ordering, and stable IDs verified.');
