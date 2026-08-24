const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sss-newznab-users-'));
process.env.USERS_FILE = path.join(tempRoot, 'users.json');
process.env.SESSION_SECRET = 'native-newznab-encryption-test-secret-at-least-32-chars';

const users = require('../lib/users');

async function main() {
  try {
    const user = await users.createUser({ username: 'testuser', password: 'password123', role: 'user' });
    users.updateUserConfig(user.id, {
      newznabIndexers: [{ name: 'NZBGeek', url: 'https://api.example/api', apiKey: 'indexer-secret' }],
    });
    const raw = fs.readFileSync(process.env.USERS_FILE, 'utf8');
    assert.ok(!raw.includes('indexer-secret'), 'Newznab API key must not be stored in plaintext');
    const onDisk = JSON.parse(raw).users[0].config.newznabIndexers[0];
    assert.match(onDisk.apiKey, /^enc:/);
    const loaded = users.findById(user.id);
    assert.strictEqual(loaded.config.newznabIndexers[0].apiKey, 'indexer-secret');
    console.log('nested Newznab API-key encryption test passed');
  } finally {
    const resolved = path.resolve(tempRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
