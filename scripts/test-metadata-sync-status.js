'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeDigest, getStatus, repositoryUrl } = require('../lib/metadata-sync-status');

const productRoot = path.resolve(__dirname, '..');
const bundled = getStatus(productRoot);
assert.strictEqual(bundled.ok, true, bundled.errors.join('; '));
assert.strictEqual(bundled.pathCount, require('../metadata-sync.json').paths.length);
assert.match(bundled.sourceCommitUrl, /Serioussportsync\/commit\/[a-f0-9]{40}$/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nzb-metadata-sync-'));
try {
  fs.mkdirSync(path.join(tempRoot, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'lib', 'a.js'), 'module.exports = 1;\n');
  const manifest = {
    sourceRepository: 'Monkfish1337/Serioussportsync',
    sourceBranch: 'main',
    productRepository: 'Monkfish1337/NZB-Sport-Pro',
    paths: ['lib/a.js'],
  };
  fs.writeFileSync(path.join(tempRoot, 'metadata-sync.json'), JSON.stringify(manifest));
  const digest = computeDigest(tempRoot, manifest.paths);
  fs.writeFileSync(path.join(tempRoot, '.metadata-source.json'), JSON.stringify({
    sourceRepository: manifest.sourceRepository,
    sourceBranch: manifest.sourceBranch,
    sourceCommit: 'a'.repeat(40),
    syncedAt: new Date().toISOString(),
    pathCount: 1,
    contentDigest: digest,
  }));
  assert.strictEqual(getStatus(tempRoot).ok, true);

  fs.writeFileSync(path.join(tempRoot, 'lib', 'a.js'), 'tampered\n');
  const tampered = getStatus(tempRoot);
  assert.strictEqual(tampered.ok, false);
  assert.ok(tampered.errors.some((item) => /differs/.test(item)));

  fs.rmSync(path.join(tempRoot, 'lib', 'a.js'));
  assert.strictEqual(getStatus(tempRoot).missingPaths.length, 1);
  assert.strictEqual(repositoryUrl('unsafe/value/extra'), '');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nzb-metadata-copy-'));
try {
  const sourceRoot = path.join(syncRoot, 'source');
  const targetRoot = path.join(syncRoot, 'target');
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(sourceRoot, 'shared.txt'), 'first\n');
  fs.writeFileSync(path.join(targetRoot, 'metadata-sync.json'), JSON.stringify({
    sourceRepository: 'Monkfish1337/Serioussportsync',
    sourceBranch: 'main',
    paths: ['shared.txt'],
  }));
  const syncScript = path.join(productRoot, 'scripts', 'sync-metadata.js');
  childProcess.execFileSync(process.execPath, [syncScript, sourceRoot, targetRoot]);
  assert.strictEqual(fs.readFileSync(path.join(targetRoot, 'shared.txt'), 'utf8'), 'first\n');
  const firstState = fs.readFileSync(path.join(targetRoot, '.metadata-source.json'), 'utf8');
  childProcess.execFileSync(process.execPath, [syncScript, sourceRoot, targetRoot]);
  assert.strictEqual(fs.readFileSync(path.join(targetRoot, '.metadata-source.json'), 'utf8'), firstState,
    'an unchanged metadata snapshot must not create release churn');
  fs.writeFileSync(path.join(sourceRoot, 'shared.txt'), 'second\n');
  childProcess.execFileSync(process.execPath, [syncScript, sourceRoot, targetRoot]);
  assert.strictEqual(fs.readFileSync(path.join(targetRoot, 'shared.txt'), 'utf8'), 'second\n');
  assert.notStrictEqual(fs.readFileSync(path.join(targetRoot, '.metadata-source.json'), 'utf8'), firstState);
} finally {
  fs.rmSync(syncRoot, { recursive: true, force: true });
}

console.log('metadata sync provenance and integrity tests passed');
