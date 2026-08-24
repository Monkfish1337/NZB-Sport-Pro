#!/usr/bin/env node
'use strict';

const assert = require('assert');
const voyager = require('../lib/sources/torbox-voyager');

const url = new URL(voyager.buildSearchUrl(
  'usenet',
  'EPL 2026 08 22 Hull City Vs Manchester United',
  { checkCache: true, checkOwned: true, searchUserEngines: true },
));
assert.strictEqual(url.origin, 'https://search-api.torbox.app');
assert.strictEqual(url.pathname, '/usenet/search');
assert.strictEqual(url.searchParams.get('query'), 'EPL 2026 08 22 Hull City Vs Manchester United');
assert.strictEqual(url.searchParams.get('check_cache'), 'true');
assert.strictEqual(url.searchParams.get('check_owned'), 'true');
assert.strictEqual(url.searchParams.get('search_user_engines'), 'true');
assert.strictEqual(url.searchParams.get('cached_only'), 'false');

const normalized = voyager.normalizePayload({
  success: true,
  data: {
    results: [{
      title: 'EPL.2026.08.22.Hull.City.Vs.Manchester.United.1080p',
      info_hash: 'abcdef0123456789abcdef0123456789abcdef01',
      size: 123456,
      cached: true,
      owned: false,
      indexer: 'BYOI/NZBHydra2',
      download_url: 'https://indexer.example/api?t=get&id=secret',
    }],
  },
}, 'usenet');
assert.strictEqual(normalized.length, 1);
assert.strictEqual(normalized[0].cached, true);
assert.strictEqual(normalized[0].owned, false);
assert.strictEqual(normalized[0].source, 'BYOI/NZBHydra2');
assert.strictEqual(normalized[0].hasDownloadLink, true);
assert.strictEqual(normalized[0].downloadHost, 'indexer.example');
assert.ok(!JSON.stringify(normalized[0]).includes('id=secret'), 'diagnostics do not expose NZB URLs');
assert.strictEqual(
  voyager.safeText('failed https://x.test/get?apikey=secret&item=1 Bearer private-token'),
  'failed https://x.test/get?apikey=[redacted]&item=1 Bearer [redacted]',
  'diagnostic errors redact common credential forms',
);

(async () => {
  const mocked = await voyager.probe('test event', 'not-logged', {
    fetchImpl: async (requestUrl, requestOptions) => ({
      ok: true,
      status: 200,
      async json() {
        return { data: [{ title: new URL(requestUrl).pathname, cached: false }] };
      },
      requestOptions,
    }),
  });
  assert.strictEqual(mocked.readOnly, true);
  assert.strictEqual(mocked.searches.length, 2);
  assert.ok(mocked.searches.every((item) => item.ok));

  console.log('OK — TorBox Voyager read-only query and response diagnostics verified.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
