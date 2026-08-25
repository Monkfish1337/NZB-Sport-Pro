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

(async () => {
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

    const admin = await fetch(base + '/admin', { headers: { cookie } });
    const html = await admin.text();
    assert.strictEqual(admin.status, 200);
    assert.match(html, /Maintenance/);
    assert.match(html, /Metadata refresh/);
    assert.match(html, /Stored operator users/);
    assert.match(html, />Health</);
    assert.match(html, />Logs</);
    assert.doesNotMatch(html, /Power Tool|Match Editor|Content Studio|Torrent discovery|Direct Prowlarr|General search/);
    assert.doesNotMatch(html, /environment-admin-password/);

    for (const retired of [
      '/admin/power-tool', '/admin/search', '/admin/match-editor',
      '/admin/promotions', '/admin/content',
    ]) {
      assert.strictEqual((await fetch(base + retired, { headers: { cookie } })).status, 404);
    }
    console.log('environment admin auth and reduced maintenance surface tests passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
