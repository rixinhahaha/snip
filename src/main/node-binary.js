/**
 * Shared utility to locate a system Node.js binary.
 * Used by segmentation and upscaler child processes that cannot run
 * inside Electron's V8 due to ONNX runtime crashes.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

let resolvedNodePath = null;

/**
 * Find a Node.js binary. Checks bundled binary first, then system installs
 * (NVM, common paths, PATH, FNM).
 */
function findNodeBinary() {
  if (resolvedNodePath) return resolvedNodePath;

  const candidates = [];

  // 1. Bundled Node.js (packaged app)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'node', 'node'));
  }
  // 2. Bundled Node.js (development)
  candidates.push(path.join(__dirname, '..', '..', 'vendor', 'node', process.arch, 'node'));

  // 3. System Node.js installs
  const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    const versions = fs.readdirSync(nvmDir).sort();
    for (let i = versions.length - 1; i >= 0; i--) {
      candidates.push(path.join(nvmDir, versions[i], 'bin', 'node'));
    }
  } catch (_) {}

  candidates.push('/usr/local/bin/node');
  candidates.push('/opt/homebrew/bin/node');

  const pathDirs = (process.env.PATH || '').split(':');
  for (const dir of pathDirs) {
    if (dir) candidates.push(path.join(dir, 'node'));
  }

  const fnmDir = path.join(os.homedir(), '.local', 'share', 'fnm', 'node-versions');
  try {
    const versions = fs.readdirSync(fnmDir).sort();
    for (let i = versions.length - 1; i >= 0; i--) {
      candidates.push(path.join(fnmDir, versions[i], 'installation', 'bin', 'node'));
    }
  } catch (_) {}

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      resolvedNodePath = candidate;
      return candidate;
    } catch (_) {}
  }

  console.warn('[NodeBinary] Could not find system Node.js, falling back to Electron binary');
  return null;
}

module.exports = { findNodeBinary };
