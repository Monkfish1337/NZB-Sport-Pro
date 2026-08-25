const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nzb-sport-pro-public-'));
process.env.DATA_FILE = path.join(tempRoot, 'events.json');
process.env.USERS_FILE = path.join(tempRoot, 'users.json');
process.env.CONTENT_STUDIO_FILE = path.join(tempRoot, 'content-studio.json');
process.env.SETTINGS_FILE = path.join(tempRoot, 'settings.json');
process.env.PUBLIC_CONFIGS_FILE = path.join(tempRoot, 'public-configs.json');
process.env.SESSION_SECRET = 'public-page-test-secret-at-least-32-characters';

const { createApp } = require('../addon');
const streams = require('../lib/streams');

(async () => {
  const sizeLogs = [];
  const sizeFiltered = streams._test.filterByMaxResultSize([
    { title: 'small', size: 5_000_000_000 },
    { title: 'large', size: 14_000_000_000 },
    { title: 'unknown', size: 0 },
  ], 8, (line) => sizeLogs.push(line));
  assert.deepStrictEqual(sizeFiltered.map((item) => item.title), ['small', 'unknown']);
  assert.match(sizeLogs[0], /removed 1 result/);

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
    assert.doesNotMatch(configureHtml, /Direct indexer-link attachment/);
    assert.doesNotMatch(configureHtml, /Create your install|Create account|Username/);

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

    console.log('stored configure, split edit token, manifest, collection, and tamper tests passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
