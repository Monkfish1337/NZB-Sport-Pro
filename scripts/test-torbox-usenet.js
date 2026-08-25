const assert = require('assert');
const torboxUsenet = require('../lib/sources/torbox-usenet');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

async function main() {
  const messageId = 'cached-match-part1@news.example';
  const secondMessageId = 'cached-match-par2@news.example';
  const nzb = Buffer.from('<?xml version="1.0"?><nzb><!-- indexer comment -->'
    + '<file poster="indexer-user" subject="match"><segments>'
    + '<segment bytes="123" number="1">' + messageId + '</segment>'
    + '</segments></file><file subject="recovery"><segments>'
    + '<segment bytes="456" number="1">' + secondMessageId + '</segment>'
    + '</segments></file></nzb>');
  const expectedHash = require('crypto').createHash('md5').update(messageId).digest('hex');
  const rawHash = torboxUsenet.nzbHash(nzb);
  const nzbUrl = 'https://indexer.example/api?t=get&id=123&apikey=secret';
  const strategies = torboxUsenet.nzbCacheHashes(nzb, nzbUrl);
  assert.strictEqual(torboxUsenet.firstMessageIds(nzb)[0], messageId);
  assert.ok(strategies.includes(expectedHash), 'message-ID strategy is included');
  assert.ok(strategies.includes(rawHash), 'raw NZB fallback is included');
  assert.ok(strategies.includes(require('crypto').createHash('md5').update(nzbUrl).digest('hex')),
    'exact indexer-link strategy is included');
  assert.strictEqual(torboxUsenet.nzbLinkHashes(nzbUrl).length, 1,
    'query-stripped Newznab API links are excluded because id lives in the query');
  assert.strictEqual(torboxUsenet.nzbLinkHashes(
    'https://downloads.example/release/123?filename=match.nzb&apikey=secret').length, 2,
  'normalized link remains available when query fields do not identify the item');
  assert.notStrictEqual(strategies[1],
    require('crypto').createHash('md5').update(secondMessageId).digest('hex'),
    'core NZB and link strategies precede extra message IDs');
  const calls = [];
  async function cachedFetch(url, options) {
    calls.push({ url, options });
    if (url.includes('/usenet/checkcached')) {
      return response(200, { data: { [expectedHash]: { hash: expectedHash } } });
    }
    if (url.endsWith('/usenet/createusenetdownload')) {
      assert.ok(Buffer.isBuffer(options.body));
      assert.ok(options.body.includes(nzb));
      assert.match(options.headers['Content-Type'], /^multipart\/form-data; boundary=/);
      return response(200, { data: { usenet_id: 77 } });
    }
    if (url.includes('/usenet/mylist')) {
      return response(200, { data: { id: 77, files: [
        { id: 1, name: 'sample.txt', size: 500 },
        { id: 2, name: 'match.1080p.mkv', size: 4000000000 },
      ] } });
    }
    if (url.includes('/usenet/requestdl')) {
      return response(200, { data: 'https://cdn.torbox.app/match.mkv' });
    }
    throw new Error('unexpected URL ' + url);
  }

  const resolved = await torboxUsenet.resolveNzb(
    nzb, 'Hull City vs Manchester United', 'torbox-key-1', () => {},
    { fetchImpl: cachedFetch, pollIntervalMs: 0, nzbUrl }
  );
  assert.strictEqual(resolved.ok, true);
  assert.strictEqual(resolved.cached, true);
  assert.strictEqual(resolved.url, 'https://cdn.torbox.app/match.mkv');
  assert.strictEqual(resolved.id, 77);
  assert.ok(calls.some((call) => call.url.includes('usenet_id=77')));
  const cacheCall = calls.find((call) => call.url.includes('/usenet/checkcached'));
  assert.strictEqual(cacheCall.options.method, 'POST');
  const checkedHashes = JSON.parse(cacheCall.options.body).hashes;
  assert.ok(checkedHashes.includes(expectedHash));
  assert.ok(checkedHashes.includes(rawHash));
  const createCall = calls.find((call) => call.url.endsWith('/usenet/createusenetdownload'));
  assert.ok(createCall.options.body.includes(Buffer.from('name="add_only_if_cached"\r\n\r\ntrue')));

  const uncachedNzb = Buffer.from('<?xml version="1.0"?><nzb><file subject="new"/></nzb>');
  async function uncachedFetch(url, options) {
    if (url.includes('/usenet/checkcached')) return response(200, { data: {} });
    if (url.endsWith('/usenet/createusenetdownload')) {
      assert.ok(!options.body.includes(Buffer.from('name="add_only_if_cached"')));
      return response(200, { data: { usenetdownload_id: 88 } });
    }
    if (url.includes('/usenet/mylist')) return response(200, { data: { id: 88, files: [] } });
    throw new Error('unexpected URL ' + url);
  }
  const queued = await torboxUsenet.resolveNzb(
    uncachedNzb, 'New match', 'torbox-key-2', () => {},
    { fetchImpl: uncachedFetch, pollIntervalMs: 0 }
  );
  assert.strictEqual(queued.ok, true);
  assert.strictEqual(queued.queued, true);
  assert.strictEqual(queued.id, 88);
  const batch = torboxUsenet.cachedHashesFromPayload({
    data: { [expectedHash]: { hash: expectedHash } },
  }, [expectedHash, torboxUsenet.nzbHash(uncachedNzb)]);
  assert.deepStrictEqual(Array.from(batch), [expectedHash]);
  const manyHashes = Array.from({ length: 150 }, (_, index) => require('crypto')
    .createHash('md5').update('expanded-cache-' + index).digest('hex'));
  let expandedCount = 0;
  const expanded = await torboxUsenet.checkCachedMany(
    manyHashes, 'torbox-key-expanded', () => {}, {
      maxHashes: 2000,
      fetchImpl: async (_url, options) => {
        const submitted = JSON.parse(options.body).hashes;
        expandedCount = submitted.length;
        return response(200, { data: {
          [submitted[submitted.length - 1]]: { hash: submitted[submitted.length - 1] },
        } });
      },
    }
  );
  assert.strictEqual(expandedCount, 150, 'POST cache check is no longer truncated to GET limit');
  assert.ok(expanded.has(manyHashes[manyHashes.length - 1]));
  const owned = torboxUsenet.ownedReadyHashesFromPayload({ data: [{
    id: 99,
    hash: rawHash,
    alternative_hashes: [expectedHash],
    download_finished: true,
    download_present: true,
  }, {
    id: 100,
    hash: torboxUsenet.nzbHash(uncachedNzb),
    download_finished: false,
    download_present: true,
  }] });
  assert.strictEqual(owned.get(expectedHash), 99);
  assert.strictEqual(owned.get(rawHash), 99);
  assert.strictEqual(owned.has(torboxUsenet.nzbHash(uncachedNzb)), false);

  const recoveryMessageId = 'recovered-cached-match@news.example';
  const recoveryNzb = Buffer.from('<nzb><file subject="recovered"><segments><segment number="1">'
    + recoveryMessageId + '</segment></segments></file></nzb>');
  const recoveryHash = require('crypto').createHash('md5').update(recoveryMessageId).digest('hex');
  async function recoveryFetch(url) {
    if (url.includes('/usenet/checkcached')) {
      return response(200, { data: { [recoveryHash]: { hash: recoveryHash } } });
    }
    if (url.endsWith('/usenet/createusenetdownload')) throw new Error('network timeout at: create');
    if (url.includes('/usenet/mylist?limit=1000')) {
      return response(200, { data: [{
        id: 66,
        alternative_hashes: [recoveryHash],
        download_finished: true,
        download_present: true,
      }] });
    }
    if (url.includes('/usenet/mylist?')) {
      return response(200, { data: { id: 66, files: [
        { id: 3, name: 'recovered-match.mkv', size: 3000000000 },
      ] } });
    }
    if (url.includes('/usenet/requestdl')) {
      return response(200, { data: 'https://cdn.torbox.app/recovered-match.mkv' });
    }
    throw new Error('unexpected recovery URL ' + url);
  }
  const recovered = await torboxUsenet.resolveNzb(
    recoveryNzb, 'Recovered match', 'torbox-key-recovery', () => {}, {
      fetchImpl: recoveryFetch,
      pollIntervalMs: 0,
      recoveryAttempts: 1,
    }
  );
  assert.strictEqual(recovered.url, 'https://cdn.torbox.app/recovered-match.mkv');
  assert.strictEqual(recovered.id, 66);

  const directNzb = Buffer.from('<nzb><file subject="direct"><segments><segment number="1">'
    + 'direct-link-match@news.example</segment></segments></file></nzb>');
  const directUrl = 'https://indexer.example/api?t=get&id=direct&apikey=private-indexer-key';
  let directCreateBody = null;
  const directLogs = [];
  async function directFetch(url, options) {
    if (url.endsWith('/usenet/createusenetdownload')) {
      directCreateBody = options.body;
      return response(200, { data: { usenetdownload_id: 55 } });
    }
    if (url.includes('/usenet/mylist?')) {
      return response(200, { data: { id: 55, files: [
        { id: 4, name: 'direct-match.mkv', size: 2000000000 },
      ] } });
    }
    if (url.includes('/usenet/requestdl')) {
      return response(200, { data: 'https://cdn.torbox.app/direct-match.mkv' });
    }
    throw new Error('unexpected direct URL ' + url);
  }
  const direct = await torboxUsenet.resolveNzb(
    directNzb, 'Direct match', 'torbox-key-direct', (message) => directLogs.push(message), {
      fetchImpl: directFetch,
      knownCached: true,
      nzbUrl: directUrl,
      useDirectLink: true,
      pollIntervalMs: 0,
    }
  );
  assert.strictEqual(direct.url, 'https://cdn.torbox.app/direct-match.mkv');
  assert.ok(Buffer.isBuffer(directCreateBody));
  assert.ok(directCreateBody.includes(Buffer.from('name="link"\r\n\r\n' + directUrl)));
  assert.ok(directCreateBody.includes(Buffer.from('name="add_only_if_cached"\r\n\r\ntrue')));
  assert.ok(!directCreateBody.includes(Buffer.from('name="file"')),
    'direct-link mode sends no file upload part');
  assert.ok(directLogs.some((line) => line.includes('by direct indexer link')));
  assert.ok(!directLogs.join('\n').includes('private-indexer-key'),
    'credential-bearing URL is not logged');
  console.log('TorBox Usenet cached/queued resolver tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
