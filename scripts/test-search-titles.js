#!/usr/bin/env node
// 0.30.0 — sanity-check the new per-promotion searchTitles() output.
//
// Uses synthetic events that exercise every branch of every promotion's
// searchTitles function. Pure-function audit, no HTTP calls. Prints the OLD
// buildAliases output alongside the NEW searchTitles output for comparison.
//
// Run:  node scripts/test-search-titles.js
//   or: node scripts/test-search-titles.js ufc wwe       (filter by prefix)

const { byPrefix } = require('../lib/promotions');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// Synthetic test events. Each one tests a specific branch — naming follows the
// actual format TSDB / ONE FC / etc emit so the regex matches behave realistically.
const SAMPLES = {
  ufc: [
    { name: 'UFC 291 Poirier vs Gaethje 2', date: '2023-07-29', kind: 'ppv' },
    { name: 'UFC 308: Topuria vs Holloway', date: '2024-10-26', kind: 'ppv' },
    { name: 'UFC Fight Night 277: Song vs Figueiredo', date: '2026-05-09', kind: 'fight-night' },
    { name: 'UFC Fight Night: Whittaker vs Costa', date: '2026-06-15', kind: 'fight-night' },
    { name: 'UFC on ABC 9: Rodriguez vs Lemos', date: '2026-07-13', kind: 'ufc-on-network' },
    { name: 'Dana White Contender Series 2026 Week 5', date: '2026-08-19', kind: 'contender-series' },
  ],
  one: [
    { name: 'ONE 173', date: '2026-04-12', kind: 'numbered' },
    { name: 'ONE Championship 175', date: '2026-06-21', kind: 'numbered' },
    { name: 'ONE Fight Night 43: De Ridder vs Lee', date: '2026-05-03', kind: 'fight-night' },
    { name: 'ONE Friday Fights 155 & The Inner Circle', date: '2026-05-09', kind: 'friday-fights' },
  ],
  wwe: [
    { name: 'WrestleMania 42', date: '2026-04-18', kind: 'mania' },
    { name: 'Royal Rumble', date: '2026-01-31', kind: 'royal-rumble' },
    { name: 'SummerSlam', date: '2026-08-01', kind: 'summerslam' },
    { name: 'Backlash: France', date: '2026-05-04', kind: 'ple' },
    { name: 'Saturday Nights Main Event', date: '2026-03-14', kind: 'ple' },
    { name: 'Stand & Deliver', date: '2026-04-04', kind: 'nxt' },
  ],
  aew: [
    { name: 'AEW Revolution', date: '2026-03-08', kind: 'ppv' },
    { name: 'Double or Nothing', date: '2026-05-24', kind: 'ppv' },
    { name: 'Forbidden Door', date: '2026-06-29', kind: 'ppv' },
    { name: 'All In London 2026', date: '2026-08-30', kind: 'ppv' },
  ],
  f1: [
    { name: 'Monaco Grand Prix', date: '2026-05-24', kind: 'race' },
    { name: 'Monaco Grand Prix Qualifying', date: '2026-05-23', kind: 'qualifying' },
    { name: 'Belgian Grand Prix Sprint', date: '2026-07-25', kind: 'sprint' },
    { name: 'Belgian Grand Prix Sprint Qualifying', date: '2026-07-24', kind: 'sprint-qualifying' },
    { name: 'Canadian Grand Prix Practice 1', date: '2026-06-12', kind: 'practice' },
  ],
  boxing: [
    { name: 'Fury vs Usyk 2', date: '2024-12-21', kind: 'fight-card' },
    { name: 'Crawford vs Spence', date: '2023-07-29', kind: 'fight-card' },
    { name: 'MVPW 03 Han vs Holm 2', date: '2026-05-30', kind: 'fight-card' },
    { name: 'Tyson Fury vs Arslanbek Makhmudov', date: '2026-07-12', kind: 'fight-card' },
    { name: 'Foster v Ray Ford', date: '2026-03-29', kind: 'fight-card' },
  ],
};

const prefixes = args.length ? args : Object.keys(SAMPLES);

for (const prefix of prefixes) {
  const promo = byPrefix[prefix];
  const events = SAMPLES[prefix] || [];
  if (!promo) { console.log(`(unknown prefix: ${prefix})`); continue; }
  if (events.length === 0) { console.log(`(no samples defined for ${prefix})`); continue; }

  console.log('━'.repeat(78));
  console.log(`  ${promo.name} (${promo.idPrefix})`);
  console.log('━'.repeat(78));

  for (const ev of events) {
    const titles = typeof promo.searchTitles === 'function' ? promo.searchTitles(ev) : [];
    const oldAliases = promo.buildAliases(ev.name);
    console.log(`\n  📅 ${ev.date}   ${ev.name}`);
    console.log(`     kind: ${ev.kind}`);
    console.log(`     OLD buildAliases (${oldAliases.length}):`);
    for (const a of oldAliases) console.log(`       • ${a}`);
    console.log(`     NEW searchTitles (${titles.length}):`);
    if (titles.length === 0) {
      console.log('       (none — searchTitles returned empty array)');
    } else {
      for (const t of titles) console.log(`       → ${t}`);
    }
  }
  console.log();
}
