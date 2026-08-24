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
  const nzb = Buffer.from('<?xml version="1.0"?><nzb><file subject="match"/></nzb>');
  const expectedHash = torboxUsenet.nzbHash(nzb);
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
    { fetchImpl: cachedFetch, pollIntervalMs: 0 }
  );
  assert.strictEqual(resolved.ok, true);
  assert.strictEqual(resolved.cached, true);
  assert.strictEqual(resolved.url, 'https://cdn.torbox.app/match.mkv');
  assert.strictEqual(resolved.id, 77);
  assert.ok(calls.some((call) => call.url.includes('usenet_id=77')));

  const uncachedNzb = Buffer.from('<?xml version="1.0"?><nzb><file subject="new"/></nzb>');
  async function uncachedFetch(url) {
    if (url.includes('/usenet/checkcached')) return response(200, { data: {} });
    if (url.endsWith('/usenet/createusenetdownload')) return response(200, { data: { usenetdownload_id: 88 } });
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
  console.log('TorBox Usenet cached/queued resolver tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
