const assert = require('assert');
const http = require('http');

process.env.NATIVE_NEWZNAB_ALLOW_PRIVATE = 'on';
process.env.NATIVE_NEWZNAB_ALLOW_HTTP = 'on';

const nativeNewznab = require('../lib/sources/native-newznab');

async function main() {
  let searchCount = 0;
  let leakedKey = false;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api' && url.searchParams.get('t') === 'search') {
      searchCount += 1;
      leakedKey = url.searchParams.get('apikey') !== 'secret-indexer-key';
      const origin = 'http://127.0.0.1:' + server.address().port;
      res.setHeader('Content-Type', 'application/rss+xml');
      return res.end('<?xml version="1.0"?><rss xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">'
        + '<channel><item><title><![CDATA[EPL 2026 08 22 Hull City Vs Manchester United 1080p HDTV]]></title>'
        + '<link>' + origin + '/api?t=get&amp;id=release-1&amp;apikey=secret-indexer-key</link>'
        + '<guid>release-1</guid><pubDate>Sat, 22 Aug 2026 20:00:00 GMT</pubDate>'
        + '<enclosure url="' + origin + '/api?t=get&amp;id=release-1&amp;apikey=secret-indexer-key" length="4000000000" />'
        + '<newznab:attr name="size" value="4000000000"/></item></channel></rss>');
    }
    if (url.pathname === '/api' && url.searchParams.get('t') === 'get') {
      res.setHeader('Content-Type', 'application/x-nzb');
      return res.end('<?xml version="1.0"?><nzb><file subject="test"><segments/></file></nzb>');
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const endpoint = 'http://127.0.0.1:' + server.address().port + '/api';
    const indexers = [{ name: 'Test Indexer', url: endpoint, apiKey: 'secret-indexer-key' }];
    const results = await nativeNewznab.multiSearch([
      'EPL 2026 08 22 Hull City Vs Manchester United',
    ], indexers, { maxQueries: 1 });
    assert.strictEqual(searchCount, 1);
    assert.strictEqual(leakedKey, false);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].indexer, 'Test Indexer');
    assert.strictEqual(results[0].size, 4000000000);
    assert.ok(results[0].nzbUrl.includes('apikey=secret-indexer-key'));

    const token = nativeNewznab.storeCandidate('user-1', 'manutd:1', results[0]);
    assert.match(token, /^[a-f0-9]{40}$/);
    assert.ok(!token.includes('secret-indexer-key'));
    assert.strictEqual(nativeNewznab.getCandidate(token, 'wrong-user', 'manutd:1'), null);
    const candidate = nativeNewznab.getCandidate(token, 'user-1', 'manutd:1');
    assert.strictEqual(candidate.title, results[0].title);
    assert.strictEqual(nativeNewznab.candidateStillConfigured(candidate, indexers), true);
    assert.strictEqual(nativeNewznab.candidateStillConfigured(candidate, [
      { name: 'Test Indexer', url: endpoint, apiKey: 'rotated-key' },
    ]), false);
    const nzb = await nativeNewznab.fetchNzb(candidate);
    assert.ok(Buffer.isBuffer(nzb));
    assert.match(nzb.toString('utf8'), /<nzb>/);
    console.log('native Newznab search/token/NZB tests passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
