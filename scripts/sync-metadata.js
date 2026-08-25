// Copies the canonical metadata layer from SeriousSportSync into this repo.
// Playback, public configuration and product branding deliberately stay local.

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { computeDigest } = require('../lib/metadata-sync-status');

const productRoot = path.resolve(process.argv[3] || path.join(__dirname, '..'));
const sourceRoot = path.resolve(process.argv[2] || process.env.SSS_METADATA_SOURCE || '../Serioussportsync');
const manifest = JSON.parse(fs.readFileSync(path.join(productRoot, 'metadata-sync.json'), 'utf8'));
const statePath = path.join(productRoot, '.metadata-source.json');
let previousState = null;
try { previousState = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}

if (!fs.existsSync(sourceRoot)) {
  throw new Error('SeriousSportSync source checkout not found: ' + sourceRoot);
}

const changedPaths = [];
for (const relative of manifest.paths) {
  const source = path.join(sourceRoot, relative);
  const destination = path.join(productRoot, relative);
  if (!fs.existsSync(source)) throw new Error('Canonical metadata path is missing: ' + relative);
  const sourceBytes = fs.readFileSync(source);
  const destinationBytes = fs.existsSync(destination) ? fs.readFileSync(destination) : null;
  if (destinationBytes && sourceBytes.equals(destinationBytes)) continue;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, sourceBytes);
  changedPaths.push(relative);
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

const contentDigest = computeDigest(productRoot, manifest.paths);
const snapshotUnchanged = previousState
  && changedPaths.length === 0
  && previousState.contentDigest === contentDigest
  && previousState.sourceRepository === manifest.sourceRepository
  && previousState.sourceBranch === manifest.sourceBranch
  && previousState.pathCount === manifest.paths.length;
const state = snapshotUnchanged ? previousState : {
  sourceRepository: manifest.sourceRepository,
  sourceBranch: manifest.sourceBranch,
  sourceCommit: commit,
  syncedAt: new Date().toISOString(),
  pathCount: manifest.paths.length,
  contentDigest,
};
const nextState = JSON.stringify(state, null, 2) + '\n';
const stateUnchanged = previousState
  && JSON.stringify(previousState) === JSON.stringify(state);
if (!stateUnchanged) fs.writeFileSync(statePath, nextState);
console.log('Checked ' + manifest.paths.length + ' metadata paths from ' + commit
  + '; changed ' + changedPaths.length + '.');
