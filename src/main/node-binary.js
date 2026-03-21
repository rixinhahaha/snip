/**
 * Shared utility to locate a system Node.js binary.
 * Used by segmentation and upscaler child processes that cannot run
 * inside Electron's V8 due to ONNX runtime crashes.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const platform = require('./platform');

let resolvedNodePath = null;

var nodeBin = platform.getNodeBinaryName();

/**
 * Find a Node.js binary. Checks bundled binary first, then system installs
 * (NVM, platform paths, PATH, FNM).
 */
function findNodeBinary() {
  if (resolvedNodePath) return resolvedNodePath;

  const candidates = [];

  // 1. Bundled Node.js (packaged app)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'node', nodeBin));
  }
  // 2. Bundled Node.js (development)
  candidates.push(path.join(__dirname, '..', '..', 'vendor', 'node', process.arch, nodeBin));

  // 3. System Node.js installs (NVM)
  const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    const versions = fs.readdirSync(nvmDir).sort();
    for (let i = versions.length - 1; i >= 0; i--) {
      candidates.push(path.join(nvmDir, versions[i], 'bin', nodeBin));
    }
  } catch (_) {}

  // 4. Platform-specific known directories
  var searchDirs = platform.getNodeSearchPaths();
  for (var d = 0; d < searchDirs.length; d++) {
    candidates.push(path.join(searchDirs[d], nodeBin));
  }

  // 5. PATH environment variable
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    if (dir) candidates.push(path.join(dir, nodeBin));
  }

  // 6. FNM
  const fnmDir = path.join(os.homedir(), '.local', 'share', 'fnm', 'node-versions');
  try {
    const versions = fs.readdirSync(fnmDir).sort();
    for (let i = versions.length - 1; i >= 0; i--) {
      candidates.push(path.join(fnmDir, versions[i], 'installation', 'bin', nodeBin));
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
