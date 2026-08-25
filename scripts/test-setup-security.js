const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nzb-sport-pro-setup-'));
process.env.DATA_FILE = path.join(tempRoot, 'events.json');
process.env.USERS_FILE = path.join(tempRoot, 'users.json');
process.env.CONTENT_STUDIO_FILE = path.join(tempRoot, 'content-studio.json');
process.env.SETTINGS_FILE = path.join(tempRoot, 'settings.json');
process.env.PUBLIC_CONFIGS_FILE = path.join(tempRoot, 'public-configs.json');
process.env.SESSION_SECRET = 'setup-security-test-secret-at-least-32-characters';
process.env.SETUP_TOKEN = 'separate-bootstrap-secret';

const { createApp } = require('../addon');
const users = require('../lib/users');

function setupBody(token, username) {
  return new URLSearchParams({
    username: username || 'operator',
    password: 'correct horse battery staple',
    setupToken: token,
  });
}

(async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const page = await (await fetch(base + '/setup')).text();
    assert.match(page, /name="setupToken"/);
    assert.doesNotMatch(page, /separate-bootstrap-secret/);

    const denied = await fetch(base + '/setup', {
      method: 'POST', body: setupBody('wrong-secret'), redirect: 'manual',
    });
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(users.userCount(), 0);

    const [first, second] = await Promise.all([
      fetch(base + '/setup', { method: 'POST', body: setupBody(process.env.SETUP_TOKEN), redirect: 'manual' }),
      fetch(base + '/setup', { method: 'POST', body: setupBody(process.env.SETUP_TOKEN, 'operator2'), redirect: 'manual' }),
    ]);
    assert.deepStrictEqual([first.status, second.status].sort(), [302, 409]);
    assert.strictEqual(users.userCount(), 1);

    await assert.rejects(
      () => users.setPassword(users.listUsers()[0].id, 'é'.repeat(40)),
      /at most 72 UTF-8 bytes/,
    );
    console.log('setup token, bootstrap serialization, and bcrypt length tests passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
