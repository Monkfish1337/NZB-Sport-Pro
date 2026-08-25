const assert = require('assert');
const { redact } = require('../lib/redact');

const samples = [
  'https://indexer.example/api?t=get&apikey=query-secret&id=123',
  'Authorization: Bearer bearer-secret-value',
  '{"torboxApiKey":"torbox-secret","password":"password-secret"}',
  'setupToken=form-secret&newznabApiKey=indexer-secret',
  'https://user:basic-secret@example.com/file',
];
const output = samples.map(redact).join('\n');
for (const secret of [
  'query-secret', 'bearer-secret-value', 'torbox-secret', 'password-secret',
  'form-secret', 'indexer-secret', 'basic-secret',
]) assert.ok(!output.includes(secret), 'redactor leaked ' + secret);
assert.match(output, /Authorization: Bearer \*\*\*/);
assert.match(output, /"torboxApiKey":"\*\*\*"/);
console.log('central log redaction tests passed');
