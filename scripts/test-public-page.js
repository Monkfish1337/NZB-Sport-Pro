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
process.env.PUBLIC_REGISTRATION = 'on';

const { createApp } = require('../addon');

(async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const empty = await fetch(base + '/', { redirect: 'manual' });
    assert.strictEqual(empty.status, 302);
    assert.strictEqual(empty.headers.get('location'), '/setup');

    const setup = await fetch(base + '/setup', {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'owner', password: 'owner-password' }),
    });
    assert.strictEqual(setup.status, 302);

    const landing = await fetch(base + '/');
    const landingHtml = await landing.text();
    assert.strictEqual(landing.status, 200);
    assert.match(landingHtml, /NZB-Sport-Pro/);
    assert.match(landingHtml, /Sports metadata/);
    assert.match(landingHtml, /\/configure/);

    const registration = await fetch(base + '/configure');
    assert.match(await registration.text(), /Create your install/);

    const created = await fetch(base + '/configure', {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'viewer', password: 'viewer-password' }),
    });
    assert.strictEqual(created.status, 302);
    assert.match(created.headers.get('location') || '', /^\/account/);
    const cookie = (created.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.includes('sss_session='));

    const account = await fetch(base + '/account', { headers: { cookie } });
    const accountHtml = await account.text();
    assert.match(accountHtml, /Configure NZB-Sport-Pro/);
    assert.match(accountHtml, /Newznab.*TorBox Usenet/s);
    assert.doesNotMatch(accountHtml, /Enable Easynews pipeline/);
    console.log('public landing, registration, and focused configuration tests passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
