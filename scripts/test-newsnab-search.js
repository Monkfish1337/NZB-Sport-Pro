#!/usr/bin/env node
// 0.30.0 — exercise lib/sources/newsnab.js against your configured indexer.
//
// Reads NEWSNAB_URL + NEWSNAB_API_KEY from env (or data/settings.json), fires
// a single search query, prints the top results. Use this on the server with
// `docker compose exec serioussportsync` so it picks up your configured key.
//
// Run:
//   docker compose exec serioussportsync node scripts/test-newsnab-search.js "UFC 291"
//   docker compose exec serioussportsync node scripts/test-newsnab-search.js "WrestleMania 42"
//
// With --titles, looks up the catalog event and fires every searchTitles()
// variant — same code path Step 4's /stream will use:
//   docker compose exec serioussportsync node scripts/test-newsnab-search.js --titles ufc:2449566

const newsnab = require('../lib/sources/newsnab');
const settings = require('../lib/settings');

const args = process.argv.slice(2);
const useTitles = args.includes('--titles');
const positional = args.filter((a) => !a.startsWith('--'));

(async () => {
  const cfg = settings.getNewsnab();
  if (!cfg.url || !cfg.apiKey) {
    console.error('Newsnab not configured.');
    console.error('  Set NEWSNAB_URL and NEWSNAB_API_KEY in .env, or save them via /admin (Step 4).');
    console.error('  Indexer config currently:');
    console.error('    url      = ' + (cfg.url || '(empty)'));
    console.error('    apiKey   = ' + (cfg.apiKey ? '(set, ' + cfg.apiKey.length + ' chars)' : '(empty)'));
    console.error('    cats     = ' + (cfg.categories || []).join(','));
    process.exit(1);
  }

  console.log('Indexer:    ' + cfg.url);
  console.log('Categories: ' + cfg.categories.join(','));
  console.log('');

  if (useTitles) {
    const eventId = positional[0];
    if (!eventId || !eventId.includes(':')) {
      console.error('Usage: --titles <eventId>   (e.g. ufc:2449566)');
      process.exit(1);
    }
    const store = require('../lib/store');
    const { getByEventId } = require('../lib/promotions');
    const data = store.loadFromDisk();
    const ev = (data.events || []).find((e) => e.id === eventId);
    if (!ev) {
      console.error('Event not found in cache: ' + eventId);
      process.exit(1);
    }
    const promo = getByEventId(eventId);
    if (!promo || typeof promo.searchTitles !== 'function') {
      console.error('Promotion has no searchTitles() — pull the 0.29.0-alpha title generator first.');
      process.exit(1);
    }
    const titles = promo.searchTitles(ev);
    console.log('Event:      ' + ev.name);
    console.log('  date: ' + ev.date + '   kind: ' + ev.kind);
    console.log('  titles: ' + JSON.stringify(titles));
    console.log('');
    const log = (m) => console.log(m);
    const out = await newsnab.multiSearch(titles, { log });
    printResults(out.results, out.perQuery);
    return;
  }

  // Direct text query path.
  const query = positional.join(' ').trim();
  if (!query) {
    console.error('Usage: node scripts/test-newsnab-search.js "<query>"');
    console.error('  Or: node scripts/test-newsnab-search.js --titles <eventId>');
    process.exit(1);
  }
  console.log('Query: "' + query + '"');
  const log = (m) => console.log(m);
  const r = await newsnab.search(query, { log });
  if (!r.ok) {
    console.error('Search failed: ' + r.error);
    process.exit(1);
  }
  printResults(r.results, [{ query, ok: true, count: r.count }]);
})().catch((err) => {
  console.error('Unexpected error: ' + (err && err.stack || err));
  process.exit(1);
});

function printResults(results, perQuery) {
  console.log('');
  if (perQuery && perQuery.length > 1) {
    console.log('Per-query breakdown:');
    for (const q of perQuery) {
      const tag = q.ok ? String(q.count).padStart(3) : (q.error || 'fail').padStart(12);
      console.log('  ' + tag + '   "' + q.query + '"');
    }
    console.log('');
  }
  console.log('Top ' + Math.min(results.length, 20) + ' / ' + results.length + ' merged results (newest first):');
  console.log('━'.repeat(78));
  const top = results.slice(0, 20);
  for (const r of top) {
    const size = r.size ? mb(r.size) : '?';
    const when = r.publishedAt ? r.publishedAt.slice(0, 10) : '?';
    console.log('  [' + when + ']  ' + size.padStart(7) + '   ' + r.title);
  }
  console.log('━'.repeat(78));
}

function mb(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return bytes + ' B';
}
