const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nzb-sport-pro-admin-'));
process.env.DATA_FILE = path.join(tempRoot, 'events.json');
process.env.USERS_FILE = path.join(tempRoot, 'users.json');
process.env.CONTENT_STUDIO_FILE = path.join(tempRoot, 'content-studio.json');
process.env.SETTINGS_FILE = path.join(tempRoot, 'settings.json');
process.env.PUBLIC_CONFIGS_FILE = path.join(tempRoot, 'public-configs.json');
process.env.SESSION_SECRET = 'admin-maintenance-test-secret-at-least-32-characters';
process.env.ADMIN_USER = 'operator';
process.env.ADMIN_PASSWORD = 'environment-admin-password';

const { createApp } = require('../addon');
const users = require('../lib/users');
const publicConfigStore = require('../lib/public-config-store');

(async () => {
  await users.createUser({
    username: 'old-test-admin', password: 'old-test-admin-password', role: 'admin',
  });
  await users.createUser({
    username: 'old-test-user', password: 'old-test-user-password', role: 'user',
  });
  const savedConfig = publicConfigStore.create({
    torboxApiKey: 'admin-test-torbox-secret',
    newznabIndexers: [{
      name: 'Admin Test Indexer', url: 'https://indexer.example/api', apiKey: 'indexer-secret',
    }],
    catalogs: ['ufc_upcoming'], maxStreams: 7, maxResultSizeGb: 8,
    excludePreShows: true,
  });
  const configId = publicConfigStore.listSummaries()[0].id;
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.strictEqual((await fetch(base + '/setup')).status, 410);
    const denied = await fetch(base + '/login', {
      method: 'POST', redirect: 'manual',
      body: new URLSearchParams({ username: 'operator', password: 'wrong-password' }),
    });
    assert.strictEqual(denied.status, 401);

    const storedAdmin = await fetch(base + '/login', {
      method: 'POST', redirect: 'manual',
      body: new URLSearchParams({
        username: 'old-test-admin', password: 'old-test-admin-password',
      }),
    });
    assert.strictEqual(storedAdmin.status, 401);
    const storedUser = await fetch(base + '/login', {
      method: 'POST', redirect: 'manual',
      body: new URLSearchParams({
        username: 'old-test-user', password: 'old-test-user-password',
      }),
    });
    assert.strictEqual(storedUser.status, 401);

    const login = await fetch(base + '/login', {
      method: 'POST', redirect: 'manual',
      body: new URLSearchParams({
        username: process.env.ADMIN_USER, password: process.env.ADMIN_PASSWORD,
      }),
    });
    assert.strictEqual(login.status, 302);
    assert.strictEqual(login.headers.get('location'), '/admin');
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('sss_session='));

    const account = await fetch(base + '/account', {
      redirect: 'manual', headers: { cookie },
    });
    assert.strictEqual(account.status, 302);
    assert.strictEqual(account.headers.get('location'), '/admin');
    assert.strictEqual((await fetch(base + '/invite/legacy-token')).status, 404);

    const admin = await fetch(base + '/admin', { headers: { cookie } });
    const html = await admin.text();
    assert.strictEqual(admin.status, 200);
    assert.match(html, /Administration/);
    assert.match(html, /Configurations/);
    assert.match(html, /Metadata refresh/);
    assert.match(html, /User configurations \(1\)/);
    assert.match(html, new RegExp(configId));
    assert.match(html, /1<\/strong> <span class="text-secondary">indexer/);
    assert.match(html, /1 selected/);
    assert.match(html, /8 GB max/);
    assert.match(html, /Pre-shows excluded/);
    assert.match(html, />Health</);
    assert.match(html, />Metadata sync</);
    assert.match(html, />Logs</);
    assert.doesNotMatch(html, /Power Tool|Match Editor|Content Studio|Torrent discovery|Direct Prowlarr|General search|Stored users|Invites \(/);
    assert.doesNotMatch(html, /environment-admin-password|admin-test-torbox-secret|indexer-secret|indexer\.example/);

    const healthPage = await fetch(base + '/admin/health', { headers: { cookie } });
    const healthHtml = await healthPage.text();
    assert.strictEqual(healthPage.status, 200);
    assert.match(healthHtml, /Metadata sync/);
    assert.match(healthHtml, /Verified/);

    const syncPage = await fetch(base + '/admin/metadata-sync', { headers: { cookie } });
    const syncHtml = await syncPage.text();
    assert.strictEqual(syncPage.status, 200);
    assert.match(syncHtml, /Snapshot verified/);
    assert.match(syncHtml, /Serioussportsync\/commit\/[a-f0-9]{40}/);
    assert.match(syncHtml, /31 declared/);
    assert.doesNotMatch(syncHtml, /environment-admin-password|admin-test-torbox-secret|indexer-secret/);

    const manifestPath = '/c/' + encodeURIComponent(savedConfig.accessToken) + '/manifest.json';
    assert.strictEqual((await fetch(base + manifestPath)).status, 200);
    assert.strictEqual((await fetch(base + '/admin/configs/' + configId + '/disable', {
      method: 'POST', redirect: 'manual', headers: { cookie },
    })).status, 302);
    assert.strictEqual((await fetch(base + manifestPath)).status, 404);
    assert.strictEqual((await fetch(base + '/admin/configs/' + configId + '/enable', {
      method: 'POST', redirect: 'manual', headers: { cookie },
    })).status, 302);
    assert.strictEqual((await fetch(base + manifestPath)).status, 200);

    for (const retired of [
      '/admin/power-tool', '/admin/search', '/admin/match-editor',
      '/admin/promotions', '/admin/content', '/admin/users/create',
      '/admin/invites/create', '/admin/match-test',
    ]) {
      assert.strictEqual((await fetch(base + retired, { headers: { cookie } })).status, 404);
    }
    assert.strictEqual((await fetch(base + '/admin/configs/' + configId + '/delete', {
      method: 'POST', redirect: 'manual', headers: { cookie },
    })).status, 302);
    assert.strictEqual((await fetch(base + manifestPath)).status, 404);
    assert.strictEqual(publicConfigStore.listSummaries().length, 0);
    console.log('environment admin auth and reduced maintenance surface tests passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
