// Copies the canonical metadata layer from SeriousSportSync into this repo.
// Playback, public configuration and product branding deliberately stay local.

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const productRoot = path.resolve(process.argv[3] || path.join(__dirname, '..'));
const sourceRoot = path.resolve(process.argv[2] || process.env.SSS_METADATA_SOURCE || '../Serioussportsync');
const manifest = JSON.parse(fs.readFileSync(path.join(productRoot, 'metadata-sync.json'), 'utf8'));

if (!fs.existsSync(sourceRoot)) {
  throw new Error('SeriousSportSync source checkout not found: ' + sourceRoot);
}

for (const relative of manifest.paths) {
  const source = path.join(sourceRoot, relative);
  const destination = path.join(productRoot, relative);
  if (!fs.existsSync(source)) throw new Error('Canonical metadata path is missing: ' + relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

let commit = 'unknown';
try {
  commit = childProcess.execFileSync(process.env.GIT_EXECUTABLE || 'git', [
    '-c', 'safe.directory=' + sourceRoot,
    '-C', sourceRoot, 'rev-parse', 'HEAD',
  ], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {}

const state = {
  sourceRepository: manifest.sourceRepository,
  sourceBranch: manifest.sourceBranch,
  sourceCommit: commit,
  syncedAt: new Date().toISOString(),
  pathCount: manifest.paths.length,
};
fs.writeFileSync(path.join(productRoot, '.metadata-source.json'), JSON.stringify(state, null, 2) + '\n');
console.log('Synced ' + manifest.paths.length + ' metadata paths from ' + commit);
