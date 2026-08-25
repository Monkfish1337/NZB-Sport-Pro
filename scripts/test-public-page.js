const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nzb-sport-pro-public-'));
process.env.DATA_FILE = path.join(tempRoot, 'events.json');
process.env.USERS_FILE = path.join(tempRoot, 'users.json');
process.env.CONTENT_STUDIO_FILE = path.join(tempRoot, 'content-studio.json');
process.env.SETTINGS_FILE = path.join(tempRoot, 'settings.json');
process.env.PUBLIC_CONFIGS_FILE = path.join(tempRoot, 'public-configs.json');
process.env.SESSION_SECRET = 'public-page-test-secret-at-least-32-characters';

const { createApp } = require('../addon');
const streams = require('../lib/streams');
const torboxUsenet = require('../lib/sources/torbox-usenet');
const nativeNewznab = require('../lib/sources/native-newznab');

(async () => {
  const sizeLogs = [];
  const sizeFiltered = streams._test.filterByMaxResultSize([
    { title: 'small', size: 5_000_000_000 },
    { title: 'large', size: 14_000_000_000 },
    { title: 'unknown', size: 0 },
  ], 8, (line) => sizeLogs.push(line));
  assert.deepStrictEqual(sizeFiltered.map((item) => item.title), ['small', 'unknown']);
  assert.match(sizeLogs[0], /removed 1 result/);
  const segmentLogs = [];
  const segmentFiltered = streams._test.filterExcludedPreShows([
    { title: 'UFC 330 Main Card 1080p' },
    { title: 'UFC 330 Early Prelims 1080p' },
    { title: 'AEW Zero Hour 1080p' },
    { title: 'WWE WrestleMania Countdown 1080p' },
    { title: 'WWE SummerSlam Kickoff Show 1080p' },
  ], true, (line) => segmentLogs.push(line));
  assert.deepStrictEqual(segmentFiltered.map((item) => item.title), ['UFC 330 Main Card 1080p']);
  assert.match(segmentLogs[0], /removed 4/);

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const root = await fetch(base + '/', { redirect: 'manual' });
    assert.strictEqual(root.status, 302);
    assert.strictEqual(root.headers.get('location'), '/configure');

    const configure = await fetch(base + '/configure');
    const configureHtml = await configure.text();
    assert.strictEqual(configure.status, 200);
    assert.match(configureHtml, /Configure NZB-Sport-Pro/);
    assert.match(configureHtml, /TorBox API key/);
    assert.match(configureHtml, /Newznab indexers/);
    assert.match(configureHtml, />Install Stremio</);
    assert.match(configureHtml, />Copy Manifest</);
    assert.match(configureHtml, />Download Collection</);
    assert.match(configureHtml, />Copy JSON</);
    assert.match(configureHtml, /id="save-edits"[^>]*>Save edits</);
    assert.match(configureHtml, /id="rotate-manifest"/);
    assert.match(configureHtml, /id="delete-config"/);
    assert.match(configureHtml, /id="test-services"/);
    assert.match(configureHtml, /Save your private editing link below before closing this page\./);
    assert.match(configureHtml, /id="exclude-pre-shows"/);
    assert.match(configureHtml, /Save your private editing link/);
    assert.match(configureHtml, /the installed manifest cannot recover it/i);
    assert.doesNotMatch(configureHtml, /Direct indexer-link attachment/);
    assert.doesNotMatch(configureHtml, /Create your install|Create account|Username/);
    const inlineScripts = Array.from(configureHtml.matchAll(/<script>([\s\S]*?)<\/script>/g));
    assert.ok(inlineScripts.length > 0);
    inlineScripts.forEach((match) => new vm.Script(match[1], { filename: 'configure-inline.js' }));

    const originalTorBoxTest = torboxUsenet.testConnection;
    const originalNewznabTest = nativeNewznab.testConnection;
    torboxUsenet.testConnection = async (key) => ({ ok: key === 'torbox-test-key', status: 200 });
    nativeNewznab.testConnection = async (indexer) => ({
      ok: indexer.apiKey === 'indexer-test-key', status: 200,
    });
    const tested = await fetch(base + '/configure/test-services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        torboxApiKey: 'torbox-test-key',
        newznabIndexers: [{
          name: 'Test Indexer', url: 'https://indexer.example/api', apiKey: 'indexer-test-key',
        }],
      }),
    });
    const testReport = await tested.json();
    torboxUsenet.testConnection = originalTorBoxTest;
    nativeNewznab.testConnection = originalNewznabTest;
    assert.strictEqual(tested.status, 200);
    assert.strictEqual(testReport.ok, true);
    assert.strictEqual(testReport.torbox.message, 'Connected successfully.');
    assert.strictEqual(testReport.indexers[0].name, 'Test Indexer');
    assert.doesNotMatch(JSON.stringify(testReport), /torbox-test-key|indexer-test-key/);

    const generated = await fetch(base + '/configure/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        torboxApiKey: 'torbox-secret-value',
        newznabIndexers: [{
          name: 'NZBGeek',
          url: 'https://api.nzbgeek.info/api',
          apiKey: 'newznab-secret-value',
        }],
        catalogs: ['ufc-upcoming', 'ufc-recent'],
        showCatalogsOnHome: true,
        maxStreams: 8,
        maxResultSizeGb: 8.5,
        excludePreShows: true,
      }),
    });
    const links = await generated.json();
    assert.strictEqual(generated.status, 200);
    assert.match(links.manifestUrl, /^http:\/\/127\.0\.0\.1:\d+\/c\/pc1\./);
    assert.match(links.manifestUrl, /\/manifest\.json$/);
    assert.match(links.installUrl, /^stremio:\/\//);
    assert.match(links.configureUrl, /^\/configure#edit=pe1\./);
    assert.match(links.editUrl, /^http:\/\/127\.0\.0\.1:\d+\/configure#edit=pe1\./);
    assert.doesNotMatch(links.manifestUrl, /torbox-secret-value|newznab-secret-value|NZBGeek/);

    // Records created before manifest rotation had no access nonce. Confirm
    // their original use-only tokens remain valid after upgrading.
    const publicState = JSON.parse(fs.readFileSync(process.env.PUBLIC_CONFIGS_FILE, 'utf8'));
    const storedRecord = publicState.records[0];
    const savedNonce = storedRecord.accessNonce;
    delete storedRecord.accessNonce;
    fs.writeFileSync(process.env.PUBLIC_CONFIGS_FILE, JSON.stringify(publicState, null, 2));
    const master = crypto.createHmac('sha256', process.env.SESSION_SECRET)
      .update('nzb-sport-pro:public-config-store:access').digest();
    const legacySignature = crypto.createHmac('sha256', master)
      .update(storedRecord.id).digest('base64url');
    const legacyManifestUrl = base + '/c/pc1.' + storedRecord.id + '.' + legacySignature + '/manifest.json';
    assert.strictEqual((await fetch(legacyManifestUrl)).status, 200);
    storedRecord.accessNonce = savedNonce;
    fs.writeFileSync(process.env.PUBLIC_CONFIGS_FILE, JSON.stringify(publicState, null, 2));

    const manifest = await (await fetch(links.manifestUrl)).json();
    assert.strictEqual(manifest.id, 'community.nzbsportpro');
    assert.strictEqual(manifest.behaviorHints.configurable, true);
    assert.ok(manifest.resources.some((resource) => resource.name === 'stream'));
    assert.deepStrictEqual(manifest.catalogs.map((catalog) => catalog.id), [
      'ufc-upcoming', 'ufc-recent',
    ]);

    // The installed manifest token is use-only and cannot reveal credentials.
    const manifestConfigure = await fetch(links.manifestUrl.replace('/manifest.json', '/configure'), {
      redirect: 'manual',
    });
    assert.strictEqual(manifestConfigure.status, 302);
    assert.strictEqual(manifestConfigure.headers.get('location'), '/configure');

    // The separate edit token travels in a URL fragment and is submitted in
    // an Authorization header only when the browser loads the editor.
    const editToken = decodeURIComponent(new URL(links.editUrl).hash.slice('#edit='.length));
    const edit = await fetch(base + '/configure/edit', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + editToken },
    });
    const editPayload = await edit.json();
    assert.strictEqual(edit.status, 200);
    assert.strictEqual(editPayload.config.torboxApiKey, 'torbox-secret-value');
    assert.strictEqual(editPayload.config.newznabIndexers[0].apiKey, 'newznab-secret-value');
    assert.strictEqual(editPayload.config.maxResultSizeGb, 8.5);
    assert.strictEqual(editPayload.config.excludePreShows, true);

    const updated = await fetch(base + '/configure/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + editToken,
      },
      body: JSON.stringify({
        torboxApiKey: 'updated-torbox-secret',
        newznabIndexers: [{
          name: 'NZBGeek', url: 'https://api.nzbgeek.info/api', apiKey: 'updated-indexer-secret',
        }],
        catalogs: ['ufc-upcoming', 'ufc-recent'],
      }),
    });
    const updatedLinks = await updated.json();
    assert.strictEqual(updated.status, 200);
    assert.strictEqual(updatedLinks.manifestUrl, links.manifestUrl);
    const updatedEdit = await fetch(base + '/configure/edit', {
      method: 'POST', headers: { authorization: 'Bearer ' + editToken },
    });
    assert.strictEqual((await updatedEdit.json()).config.torboxApiKey, 'updated-torbox-secret');

    const collection = await fetch(links.collectionUrl);
    assert.strictEqual(collection.status, 200);
    assert.match(collection.headers.get('content-disposition') || '', /nzb-sport-pro-nuvio-collections\.json/);
    const collectionJson = await collection.json();
    assert.strictEqual(collectionJson[0].title, 'NZB-Sport-Pro');

    const tamperedUrl = links.manifestUrl.replace(/(\/c\/pc1\.[^.]+\.)([^/])/, (all, prefix, first) =>
      prefix + (first === 'A' ? 'B' : 'A'));
    assert.strictEqual((await fetch(tamperedUrl)).status, 404);

    const invalid = await fetch(base + '/configure/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ torboxApiKey: '', newznabIndexers: [] }),
    });
    assert.strictEqual(invalid.status, 400);

    const rotated = await fetch(base + '/configure/rotate-manifest', {
      method: 'POST', headers: { authorization: 'Bearer ' + editToken },
    });
    const rotatedLinks = await rotated.json();
    assert.strictEqual(rotated.status, 200);
    assert.notStrictEqual(rotatedLinks.manifestUrl, links.manifestUrl);
    assert.strictEqual((await fetch(links.manifestUrl)).status, 404);
    assert.strictEqual((await fetch(rotatedLinks.manifestUrl)).status, 200);
    assert.strictEqual((await fetch(base + '/configure/edit', {
      method: 'POST', headers: { authorization: 'Bearer ' + editToken },
    })).status, 200);

    const deleted = await fetch(base + '/configure/delete', {
      method: 'POST', headers: { authorization: 'Bearer ' + editToken },
    });
    assert.strictEqual(deleted.status, 200);
    assert.strictEqual((await fetch(rotatedLinks.manifestUrl)).status, 404);
    assert.strictEqual((await fetch(base + '/configure/edit', {
      method: 'POST', headers: { authorization: 'Bearer ' + editToken },
    })).status, 404);

    console.log('stored configure, split edit token, lifecycle, manifest, collection, and tamper tests passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
