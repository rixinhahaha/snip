/**
 * Auto-refresh stale CLI shims after app update.
 *
 * When electron-updater replaces the .app bundle, the CLI wrapper script
 * (e.g. ~/.local/bin/snip) still embeds absolute paths to the old bundle.
 * This module detects stale shims and silently rewrites them on startup.
 */
var fs = require('fs');
var path = require('path');
var platform = require('./platform');

// Matches: exec '/path/to/node' '/path/to/snip.js'
var EXEC_RE = /exec\s+'([^']+)'\s+'([^']+)'/;

/**
 * Resolve the current node binary and CLI script paths.
 * Returns { nodePath, cliPath } or null if node binary is not found.
 */
function resolveCliPaths() {
  var { findNodeBinary } = require('./node-binary');
  var { app } = require('electron');
  var nodeBin = platform.getNodeBinaryName();
  var nodePath = findNodeBinary() || path.join(platform.getNodeSearchPaths()[0] || '/usr/local/bin', nodeBin);
  var cliPath = app.isPackaged
    ? path.join(process.resourcesPath, 'cli', 'snip.js')
    : path.join(__dirname, '..', 'cli', 'snip.js');
  return { nodePath: nodePath, cliPath: cliPath };
}

/**
 * Check the status of each CLI shim at the known install paths.
 * Returns an array of { status, path } objects (one per found shim).
 * Possible statuses: 'ok', 'stale', 'homebrew'.
 * Returns empty array if no shim is found.
 */
function checkCliStatus() {
  var results = [];
  var targets = platform.getCliInstallPaths();

  for (var target of targets) {
    try {
      var stat = fs.lstatSync(target);
      // Homebrew symlinks point into the .app bundle — they survive in-place updates
      if (stat.isSymbolicLink()) {
        var link = fs.readlinkSync(target);
        if (link.indexOf('Snip.app') !== -1 && link.indexOf('Resources/cli/snip') !== -1) {
          results.push({ status: 'homebrew', path: target });
        }
        continue;
      }
      var content = fs.readFileSync(target, 'utf8');
      if (content.indexOf('Snip CLI') === -1) continue;
      var match = content.match(EXEC_RE);
      if (match) {
        var nodePath = match[1];
        var cliPath = match[2];
        if (!fs.existsSync(nodePath) || !fs.existsSync(cliPath)) {
          results.push({ status: 'stale', path: target });
          continue;
        }
      }
      results.push({ status: 'ok', path: target });
    } catch (_) {
      // File doesn't exist or can't be read — skip
    }
  }
  return results;
}

/**
 * Detect and silently rewrite any stale CLI shims.
 * Called on app startup (main process only, packaged builds).
 */
function refreshStaleCliShim() {
  var statuses = checkCliStatus();
  var stale = statuses.filter(function (s) { return s.status === 'stale'; });
  if (stale.length === 0) return;

  var resolved = resolveCliPaths();
  if (!fs.existsSync(resolved.nodePath)) {
    console.warn('[Snip] Cannot refresh CLI shim — Node.js binary not found at ' + resolved.nodePath);
    return;
  }
  if (!fs.existsSync(resolved.cliPath)) {
    console.warn('[Snip] Cannot refresh CLI shim — CLI script not found at ' + resolved.cliPath);
    return;
  }

  var wrapper = platform.getCliWrapperContent(resolved.nodePath, resolved.cliPath);
  if (!wrapper) return;

  for (var entry of stale) {
    try {
      // Guard against TOCTOU symlink swap between stale-check and write
      var preStat = fs.lstatSync(entry.path);
      if (preStat.isSymbolicLink()) {
        console.warn('[Snip] Aborting CLI refresh — path became a symlink: ' + entry.path);
        continue;
      }
      fs.writeFileSync(entry.path, wrapper, { mode: 0o755 });
      console.log('[Snip] Refreshed stale CLI shim at ' + entry.path);
    } catch (err) {
      console.warn('[Snip] Could not refresh CLI shim at ' + entry.path + ': ' + err.message);
    }
  }
}

module.exports = { checkCliStatus, resolveCliPaths, refreshStaleCliShim };
