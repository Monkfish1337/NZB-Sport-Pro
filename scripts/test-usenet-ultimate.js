#!/usr/bin/env node
// 0.30.0 — end-to-end test: Newsnab search → Usenet Ultimate URL builder.
// Pipes the new short searchTitles through Newsnab, then builds UU stream
// URLs you can click straight from the terminal to verify playback through
// your UU instance. No /stream wiring touched yet — this is the validation
// pass before Step 4 (the actual /stream rewrite).
//
// Usage (on the server, inside the container):
//   docker compose exec serioussportsync node scripts/test-usenet-ultimate.js \
//     <UU_MANIFEST_URL> <eventId>
//
// Example:
//   docker compose exec serioussportsync node scripts/test-usenet-ultimate.js \
//     "https://YOUR-usenet-ultimate.elfhosted.com/stremio/<config>/manifest.json" \
//     ufc:2449566
//
// Or pass a free-text query instead of an eventId with --q:
//   docker compose exec serioussportsync node scripts/test-usenet-ultimate.js \
//     "<UU_MANIFEST_URL>" --q "UFC 291"

const newsnab = require('../lib/sources/newsnab');
const uu      = require('../lib/sources/usenet-ultimate');

const args = process.argv.slice(2);
const qIdx = args.indexOf('--q');
const useFreeQuery = qIdx >= 0;
const positional = args.filter((a) => a !== '--q' && !args[qIdx + 1] || a !== args[qIdx + 1]);

(async () => {
  // 1. Parse args.
  const manifestUrl = args[0];
  if (!manifestUrl || !manifestUrl.startsWith('http')) {
    console.error('Usage: node scripts/test-usenet-ultimate.js <UU_MANIFEST_URL> <eventId|--q "query">');
    process.exit(1);
  }
  const parsed = uu.parseManifestUrl(manifestUrl);
  if (!parsed) {
    console.error('Could not parse UU manifest URL. Expected shape:');
    console.error('  https://<host>/stremio/<configHash>/manifest.json');
    process.exit(1);
  }
  console.log('UU base:    ' + parsed.base);
  console.log('UU config:  ' + parsed.configHash.slice(0, 8) + '... (redacted)');
  console.log('');

  // 2. Build search titles + display name.
  let titles, displayName;
  if (useFreeQuery) {
    const q = args[qIdx + 1];
    if (!q) { console.error('--q requires a query string'); process.exit(1); }
    titles = [q];
    displayName = q;
  } else {
    const eventId = args[1];
    if (!eventId || !eventId.includes(':')) {
      console.error('Need eventId (e.g. ufc:2449566) or --q "<query>"');
      process.exit(1);
    }
    const store = require('../lib/store');
    const { getByEventId } = require('../lib/promotions');
    const data = store.loadFromDisk();
    const ev = (data.events || []).find((e) => e.id === eventId);
    if (!ev) { console.error('Event not in cache: ' + eventId); process.exit(1); }
    const promo = getByEventId(eventId);
    titles = promo.searchTitles(ev);
    displayName = ev.name;
    console.log('Event:      ' + ev.name + '   (' + ev.date + ')');
    console.log('Titles:     ' + JSON.stringify(titles));
    console.log('');
  }

  // 3. Run Newsnab.
  const log = (m) => console.log(m);
  const search = await newsnab.multiSearch(titles, { log });
  if (search.results.length === 0) {
    console.error('No Newsnab results — bail.');
    process.exit(1);
  }
  console.log('');

  // 4. Build UU stream rows (limit to top 5 so we don't spam the terminal).
  const rows = uu.buildStreamRows(search.results.slice(0, 5), parsed, displayName);

  console.log('Top ' + rows.length + ' Usenet Ultimate stream rows');
  console.log('━'.repeat(78));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    console.log('\n[' + (i + 1) + ']  ' + r.title);
    console.log('    ' + r.description);
    console.log('    URL: ' + r.url);
  }
  console.log('\n' + '━'.repeat(78));
  console.log('\nManual test: copy any URL above and open it in a browser tab on a');
  console.log('machine that has UU access. If UU returns a redirect to an NzbDAV');
  console.log('file (or starts streaming the video), the URL shape works — and');
  console.log('we can wire this into /stream in Step 4. If UU returns an error,');
  console.log('paste the response back so we can adjust the token shape.');
})().catch((err) => {
  console.error('Unexpected error: ' + (err && err.stack || err));
  process.exit(1);
});
