const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nzb-sport-pro-public-'));
process.env.DATA_FILE = path.join(tempRoot, 'events.json');
process.env.USERS_FILE = path.join(tempRoot, 'users.json');
process.env.CONTENT_STUDIO_FILE = path.join(tempRoot, 'content-studio.json');
process.env.SETTINGS_FILE = path.join(tempRoot, 'settings.json');
process.env.SESSION_SECRET = 'public-page-test-secret-at-least-32-characters';

const { createApp } = require('../addon');

(async () => {
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
      }),
    });
    const links = await generated.json();
    assert.strictEqual(generated.status, 200);
    assert.match(links.manifestUrl, /^http:\/\/127\.0\.0\.1:\d+\/c\/v1\./);
    assert.match(links.manifestUrl, /\/manifest\.json$/);
    assert.match(links.installUrl, /^stremio:\/\//);
    assert.match(links.configureUrl, /^\/c\/v1\..+\/configure$/);
    assert.doesNotMatch(links.manifestUrl, /torbox-secret-value|newznab-secret-value|NZBGeek/);

    const manifest = await (await fetch(links.manifestUrl)).json();
    assert.strictEqual(manifest.id, 'community.nzbsportpro');
    assert.strictEqual(manifest.behaviorHints.configurable, true);
    assert.ok(manifest.resources.some((resource) => resource.name === 'stream'));
    assert.deepStrictEqual(manifest.catalogs.map((catalog) => catalog.id), [
      'ufc-upcoming', 'ufc-recent',
    ]);

    const edit = await fetch(base + links.configureUrl);
    const editHtml = await edit.text();
    assert.strictEqual(edit.status, 200);
    assert.match(editHtml, /Editing existing configuration/);
    assert.match(editHtml, /NZBGeek/);
    assert.match(editHtml, /api\.nzbgeek\.info/);

    const collection = await fetch(links.collectionUrl);
    assert.strictEqual(collection.status, 200);
    assert.match(collection.headers.get('content-disposition') || '', /nzb-sport-pro-nuvio-collections\.json/);
    const collectionJson = await collection.json();
    assert.strictEqual(collectionJson[0].title, 'NZB-Sport-Pro');

    const tamperedUrl = links.manifestUrl.replace(/.$/, (last) => last === 'A' ? 'B' : 'A');
    assert.strictEqual((await fetch(tamperedUrl)).status, 404);

    const invalid = await fetch(base + '/configure/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ torboxApiKey: '', newznabIndexers: [] }),
    });
    assert.strictEqual(invalid.status, 400);

    console.log('stateless configure, manifest, collection, and tamper tests passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
