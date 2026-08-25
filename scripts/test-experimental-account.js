const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sss-experimental-account-'));
process.env.EXPERIMENTAL_NATIVE_NEWZNAB = 'on';
process.env.NATIVE_NEWZNAB_ALLOW_PRIVATE = 'on';
process.env.NATIVE_NEWZNAB_ALLOW_HTTP = 'on';
process.env.SESSION_SECRET = 'experimental-account-test-secret-at-least-32-characters';
process.env.USERS_FILE = path.join(tempRoot, 'users.json');
process.env.DATA_FILE = path.join(tempRoot, 'events.json');
process.env.CONTENT_STUDIO_FILE = path.join(tempRoot, 'content-studio.json');
process.env.REFRESH_ON_EMPTY_CACHE = 'false';
process.env.TORBOX_USENET_PLAY_WAIT_MS = '0';

const fetch = require('node-fetch');

async function main() {
  let torboxUploadCount = 0;
  let nzbFetchCount = 0;
  let cachedOnlyCreateCount = 0;
  let cacheCheckSawCached = false;
  const cachedMessageId = 'cached-main-card@news.example';
  const cachedNzb = Buffer.from('<?xml version="1.0"?><nzb><file poster="source" subject="cached-match">'
    + '<segments><segment bytes="123" number="1">' + cachedMessageId
    + '</segment></segments></file></nzb>');
  const queuedNzb = Buffer.from('<?xml version="1.0"?><nzb><file subject="queued-match">'
    + '<segments><segment bytes="123" number="1">queued-prelims@news.example'
    + '</segment></segments></file></nzb>');
  const cachedHash = crypto.createHash('md5').update(cachedMessageId).digest('hex');
  const mockServer = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const origin = 'http://127.0.0.1:' + mockServer.address().port;
    if (requestUrl.pathname === '/api' && requestUrl.searchParams.get('t') === 'search') {
      res.setHeader('Content-Type', 'application/rss+xml');
      return res.end('<rss xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/"><channel><item>'
        + '<title>EPL 2026 08 22 Hull City Vs Manchester United Main Card 1080p HDTV H264-DARKSPORT</title>'
        + '<link>' + origin + '/api?t=get&amp;id=cached&amp;apikey=newznab-secret</link>'
        + '<guid>cached-release</guid><pubDate>Sat, 22 Aug 2026 20:00:00 GMT</pubDate>'
        + '<newznab:attr name="size" value="4000000000"/></item><item>'
        + '<title>EPL 2026 08 22 Hull City Vs Manchester United Prelims 720p HDTV H264-DARKSPORT</title>'
        + '<link>' + origin + '/api?t=get&amp;id=queued&amp;apikey=newznab-secret</link>'
        + '<guid>queued-release</guid><pubDate>Sat, 22 Aug 2026 19:00:00 GMT</pubDate>'
        + '<newznab:attr name="size" value="2000000000"/></item></channel></rss>');
    }
    if (requestUrl.pathname === '/api' && requestUrl.searchParams.get('t') === 'get') {
      nzbFetchCount += 1;
      res.setHeader('Content-Type', 'application/x-nzb');
      return res.end(requestUrl.searchParams.get('id') === 'cached' ? cachedNzb : queuedNzb);
    }
    if (requestUrl.pathname === '/v1/api/usenet/checkcached') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      return req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const hasCached = body.hashes.includes(cachedHash);
        cacheCheckSawCached = cacheCheckSawCached || hasCached;
        res.setHeader('Content-Type', 'application/json');
        // Reproduce TorBox's shared-cache miss for a job already completed in
        // this user's account. The owned-list fallback must still mark it ready.
        res.end(JSON.stringify({ data: {} }));
      });
    }
    if (requestUrl.pathname === '/v1/api/usenet/createusenetdownload') {
      torboxUploadCount += 1;
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      return req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const cached = body.includes('cached-match');
        if (cached && body.includes('name="add_only_if_cached"\r\n\r\ntrue')) cachedOnlyCreateCount += 1;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: { usenet_id: cached ? 77 : 88 } }));
      });
    }
    if (requestUrl.pathname === '/v1/api/usenet/mylist') {
      const rawId = requestUrl.searchParams.get('id');
      res.setHeader('Content-Type', 'application/json');
      if (rawId == null) return res.end(JSON.stringify({ data: [{
        id: 77,
        hash: '00000000000000000000000000000000',
        alternative_hashes: [cachedHash],
        download_finished: true,
        download_present: true,
        cached: true,
      }] }));
      const id = Number(rawId);
      return res.end(JSON.stringify({ data: id === 77 ? { id: 77, files: [
        { id: 2, name: 'match.1080p.mkv', size: 4000000000 },
      ] } : { id: 88, files: [] } }));
    }
    if (requestUrl.pathname === '/v1/api/usenet/requestdl') {
      assert.strictEqual(requestUrl.searchParams.get('token'), 'torbox-secret');
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ data: origin + '/video.mp4' }));
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const mockOrigin = 'http://127.0.0.1:' + mockServer.address().port;
  const indexerEndpoint = mockOrigin + '/api';
  process.env.TORBOX_API_BASE = mockOrigin + '/v1/api';

  // Load SSS only after its experimental and mock-service environment is set.
  const { createApp } = require('../addon');
  const users = require('../lib/users');
  const store = require('../lib/store');
  const transform = require('../lib/transform');
  const promotions = require('../lib/promotions');

  const promo = promotions.enabled.find((item) => item.id === 'manutd');
  assert.ok(promo, 'Manchester United promotion is available');
  const event = transform.fromFootballData({
    id: 900066,
    utcDate: '2026-08-22T15:00:00Z',
    status: 'FINISHED',
    matchday: 2,
    competition: { id: 2021, name: 'Premier League', code: 'PL' },
    season: { startDate: '2026-08-01' },
    homeTeam: { id: 322, name: 'Hull City AFC', shortName: 'Hull City' },
    awayTeam: { id: 66, name: 'Manchester United FC', shortName: 'Man United' },
  }, promo);
  store.saveToDisk({ updatedAt: new Date().toISOString(), events: [event] });

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const setup = await fetch(base + '/setup', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'adminuser', password: 'password123' }).toString(),
    });
    assert.strictEqual(setup.status, 302);
    const cookie = String(setup.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('sss_session='));

    const account = await fetch(base + '/account', { headers: { Cookie: cookie } });
    const html = await account.text();
    assert.strictEqual(account.status, 200);
    assert.ok(html.includes('name="nativeNewznabEnabled"'), 'account renders the core pipeline switch');
    assert.ok(html.includes('Newznab → TorBox Usenet'));
    assert.ok(html.includes('Core pipeline'));
    assert.ok(!html.includes('direct TorBox indexer-link attachment'));

    const form = new URLSearchParams();
    form.set('torboxApiKey', 'torbox-secret');
    form.set('torboxEnabled', 'on');
    form.set('easynewsEnabled', 'on');
    form.set('nativeNewznabEnabled', 'on');
    form.append('newznabName', 'Local Test');
    form.append('newznabUrl', indexerEndpoint);
    form.append('newznabApiKey', 'newznab-secret');
    const saved = await fetch(base + '/account/save', {
      method: 'POST',
      redirect: 'manual',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    assert.strictEqual(saved.status, 302);
    assert.strictEqual(new URL(saved.headers.get('location')).pathname + new URL(saved.headers.get('location')).search,
      '/account?flash=saved');

    const user = users.findByUsername('adminuser');
    assert.strictEqual(user.config.torboxEnabled, true);
    assert.strictEqual(user.config.uuEnabled, false);
    assert.strictEqual(user.config.easynewsEnabled, true);
    assert.strictEqual(user.config.nativeNewznabEnabled, true);
    assert.strictEqual(user.config.newznabIndexers[0].apiKey, 'newznab-secret');
    const rawUsers = fs.readFileSync(process.env.USERS_FILE, 'utf8');
    assert.ok(!rawUsers.includes('torbox-secret'));
    assert.ok(!rawUsers.includes('newznab-secret'));

    const manifest = await fetch(base + '/u/' + user.id + '/' + user.apiToken + '/manifest.json');
    const payload = await manifest.json();
    assert.strictEqual(payload.id, 'community.nzbsportpro');
    assert.strictEqual(payload.name, 'NZB-Sport-Pro');
    assert.ok(payload.resources.some((resource) => resource.name === 'stream'));

    const streamResponse = await fetch(base + '/u/' + user.id + '/' + user.apiToken
      + '/stream/movie/' + encodeURIComponent(event.id) + '.json');
    const streamPayload = await streamResponse.json();
    const nativeRows = streamPayload.streams.filter((row) => /TorBox Usenet/.test(row.name || ''));
    assert.strictEqual(nativeRows.length, 2);
    assert.match(nativeRows[0].name, /Instant Play/);
    assert.match(nativeRows[1].name, /Queue/);
    assert.ok(nativeRows[0].url.includes('/resolve/torbox-usenet/'));
    assert.ok(!JSON.stringify(nativeRows[0]).includes('newznab-secret'));
    assert.ok(!JSON.stringify(nativeRows[0]).includes(indexerEndpoint));
    const repeatedStream = await fetch(base + '/u/' + user.id + '/' + user.apiToken
      + '/stream/movie/' + encodeURIComponent(event.id) + '.json');
    const repeatedPayload = await repeatedStream.json();
    assert.strictEqual(repeatedPayload.streams.filter((row) => /TorBox Usenet/.test(row.name || '')).length, 2);
    assert.strictEqual(nzbFetchCount, 2, 'repeated stream discovery reuses prepared NZBs');
    const played = await fetch(nativeRows[0].url, { redirect: 'manual' });
    assert.strictEqual(played.status, 302);
    assert.strictEqual(played.headers.get('location'), mockOrigin + '/video.mp4');
    const queued = await fetch(nativeRows[1].url, { redirect: 'manual' });
    assert.strictEqual(queued.status, 425);
    assert.ok(Number(queued.headers.get('retry-after')) >= 5);
    const processingResponse = await fetch(base + '/u/' + user.id + '/' + user.apiToken
      + '/stream/movie/' + encodeURIComponent(event.id) + '.json');
    const processingPayload = await processingResponse.json();
    assert.ok(processingPayload.streams.some((row) => /TorBox Usenet - Processing/.test(row.name || '')),
      'reopened event identifies the existing processing job');
    assert.strictEqual(torboxUploadCount, 1, 'owned ready job is reused without another upload');
    assert.strictEqual(cachedOnlyCreateCount, 0);
    assert.strictEqual(cacheCheckSawCached, true, 'message-ID hash was included in cache classification');
    assert.strictEqual(nzbFetchCount, 2, 'prepared NZBs are reused on click without a second indexer grab');
    console.log('experimental account UI, instant/queue rows, bounded NZB reuse, and both play paths passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => mockServer.close(resolve));
    const resolved = path.resolve(tempRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
