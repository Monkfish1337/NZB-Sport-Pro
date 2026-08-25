'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function computeDigest(root, paths) {
  const hash = crypto.createHash('sha256');
  for (const relative of [...paths].sort()) {
    const file = path.join(root, relative);
    hash.update(relative, 'utf8');
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function repositoryUrl(repository) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository || ''))
    ? 'https://github.com/' + repository : '';
}

function getStatus(root = DEFAULT_ROOT) {
  const errors = [];
  let manifest = null;
  let state = null;
  try { manifest = readJson(path.join(root, 'metadata-sync.json')); }
  catch (_) { errors.push('The metadata sync manifest is missing or unreadable.'); }
  try { state = readJson(path.join(root, '.metadata-source.json')); }
  catch (_) { errors.push('The metadata source state is missing or unreadable.'); }

  const paths = manifest && Array.isArray(manifest.paths) ? manifest.paths : [];
  const missingPaths = paths.filter((relative) => !fs.existsSync(path.join(root, relative)));
  if (manifest && !Array.isArray(manifest.paths)) errors.push('The metadata sync manifest has no path list.');
  if (missingPaths.length) errors.push(missingPaths.length + ' managed metadata path(s) are missing.');

  let actualDigest = '';
  if (paths.length && !missingPaths.length) {
    try { actualDigest = computeDigest(root, paths); }
    catch (_) { errors.push('The managed metadata snapshot could not be hashed.'); }
  }
  if (state && !/^[a-f0-9]{64}$/i.test(String(state.contentDigest || ''))) {
    errors.push('The metadata snapshot has no valid recorded digest.');
  } else if (state && actualDigest && state.contentDigest !== actualDigest) {
    errors.push('Managed metadata differs from the accepted SSS snapshot.');
  }
  if (manifest && state && manifest.sourceRepository !== state.sourceRepository) {
    errors.push('The recorded source repository does not match the sync manifest.');
  }
  if (manifest && state && manifest.sourceBranch !== state.sourceBranch) {
    errors.push('The recorded source branch does not match the sync manifest.');
  }
  if (state && state.pathCount !== paths.length) {
    errors.push('The recorded path count does not match the sync manifest.');
  }
  if (state && !/^[a-f0-9]{40}$/i.test(String(state.sourceCommit || ''))) {
    errors.push('The recorded SSS source commit is invalid.');
  }

  const syncedAtMs = state ? Date.parse(state.syncedAt) : NaN;
  if (state && !Number.isFinite(syncedAtMs)) errors.push('The metadata sync timestamp is invalid.');
  const sourceRepository = state && state.sourceRepository
    || manifest && manifest.sourceRepository || '';
  const sourceBaseUrl = repositoryUrl(sourceRepository);
  const productBaseUrl = repositoryUrl(manifest && manifest.productRepository);

  return {
    ok: errors.length === 0,
    errors,
    missingPaths,
    sourceRepository,
    sourceBranch: state && state.sourceBranch || manifest && manifest.sourceBranch || '',
    sourceCommit: state && state.sourceCommit || '',
    sourceCommitUrl: sourceBaseUrl && state && state.sourceCommit
      ? sourceBaseUrl + '/commit/' + state.sourceCommit : '',
    syncedAt: state && state.syncedAt || '',
    ageHours: Number.isFinite(syncedAtMs) ? Math.max(0, (Date.now() - syncedAtMs) / 3600000) : null,
    pathCount: paths.length,
    recordedPathCount: state && state.pathCount,
    contentDigest: state && state.contentDigest || '',
    actualDigest,
    workflowUrl: productBaseUrl ? productBaseUrl + '/actions/workflows/sync-metadata.yml' : '',
  };
}

module.exports = { computeDigest, getStatus, repositoryUrl };
