const assert = require('assert');
const { EventEmitter } = require('events');
const guard = require('../lib/request-guard');

function response() {
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

const limiter = guard.fixedWindow({ name: 'test-rate', windowMs: 60000, max: 2, key: () => 'ip' });
let passed = 0;
limiter({}, response(), () => { passed += 1; });
limiter({}, response(), () => { passed += 1; });
const blocked = response();
limiter({}, blocked, () => { passed += 1; });
assert.strictEqual(passed, 2);
assert.strictEqual(blocked.statusCode, 429);
assert.ok(blocked.headers['Retry-After']);

const concurrent = guard.concurrency({ name: 'test-concurrency', globalMax: 2, perKeyMax: 1, key: (req) => req.key });
const first = response();
let entered = 0;
concurrent({ key: 'config-a' }, first, () => { entered += 1; });
const duplicate = response();
concurrent({ key: 'config-a' }, duplicate, () => { entered += 1; });
assert.strictEqual(entered, 1);
assert.strictEqual(duplicate.statusCode, 429);
first.emit('finish');
const afterRelease = response();
concurrent({ key: 'config-a' }, afterRelease, () => { entered += 1; });
assert.strictEqual(entered, 2);
afterRelease.emit('close');

console.log('request rate and concurrency guard tests passed');
