/**
 * afterPack hook for electron-builder.
 *
 * Runs after the app directory is assembled but BEFORE electron-builder signs
 * the app bundle. This hook:
 *   1. Removes canvas/sharp/@img native modules (unused transitive deps)
 *   2. Removes non-macOS onnxruntime binaries (linux, win32)
 *   3. Removes wrong-arch darwin binaries (keep only the target arch)
 *   4. Pre-signs remaining .node and .dylib files with Developer ID cert
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Recursively remove a directory if it exists.
 */
function removeDir(dir, label) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('[afterPack] Removed ' + label + ': ' + path.basename(dir));
  }
}

/**
 * Recursively find all files matching a regex pattern.
 */
function findFiles(dir, pattern, results) {
  if (!fs.existsSync(dir)) return;
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findFiles(fullPath, pattern, results);
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
}

module.exports = async function afterPack(context) {
  var appOutDir = context.appOutDir;
  var appName = context.packager.appInfo.productFilename;
  var appPath = path.join(appOutDir, appName + '.app');
  var resourcesDir = path.join(appPath, 'Contents', 'Resources');
  var unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');

  if (!fs.existsSync(unpackedDir)) {
    console.log('[afterPack] No app.asar.unpacked directory — skipping');
    return;
  }

  // electron-builder arch enum: 0=x64, 1=arm64, 3=universal
  var archMap = { 0: 'x64', 1: 'arm64', 3: 'universal' };
  var targetArch = archMap[context.arch] || 'arm64';
  console.log('[afterPack] Target architecture: ' + targetArch);

  // ---------------------------------------------------------------
  // 1. Remove unused native modules (canvas, sharp, @img)
  //    Safety net in case files exclusion in electron-builder.yml
  //    didn't catch everything (e.g. auto-unpacked native modules).
  // ---------------------------------------------------------------
  var nmDir = path.join(unpackedDir, 'node_modules');

  removeDir(path.join(nmDir, 'canvas'), 'canvas (unused transitive dep)');
  removeDir(path.join(nmDir, 'sharp'), 'sharp (unused transitive dep)');
  removeDir(path.join(nmDir, '@img'), '@img (sharp platform binaries)');

  // ---------------------------------------------------------------
  // 2. Remove non-macOS onnxruntime binaries
  // ---------------------------------------------------------------
  var onnxBinDir = path.join(nmDir, 'onnxruntime-node', 'bin', 'napi-v3');
  if (fs.existsSync(onnxBinDir)) {
    var platforms = fs.readdirSync(onnxBinDir);
    for (var p = 0; p < platforms.length; p++) {
      var platform = platforms[p];
      if (platform !== 'darwin') {
        removeDir(path.join(onnxBinDir, platform), 'onnxruntime ' + platform + ' binaries');
      }
    }

    // ---------------------------------------------------------------
    // 3. Remove wrong-arch darwin binaries
    // ---------------------------------------------------------------
    if (targetArch !== 'universal') {
      var darwinDir = path.join(onnxBinDir, 'darwin');
      if (fs.existsSync(darwinDir)) {
        var arches = fs.readdirSync(darwinDir);
        for (var a = 0; a < arches.length; a++) {
          if (arches[a] !== targetArch) {
            removeDir(
              path.join(darwinDir, arches[a]),
              'onnxruntime darwin/' + arches[a] + ' (building for ' + targetArch + ')'
            );
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------
  // 4. Pre-sign remaining native binaries
  //    electron-builder will sign the whole app bundle after this
  //    hook, but third-party .dylib/.node files sometimes need to
  //    be individually signed first for notarization to pass.
  // ---------------------------------------------------------------
  if (!process.env.CSC_LINK) {
    console.log('[afterPack] No CSC_LINK — skipping native binary pre-signing');
    return;
  }

  var identity = process.env.CSC_NAME || 'Developer ID Application';
  var entitlements = path.join(__dirname, '..', 'assets', 'entitlements.mac.plist');

  if (!fs.existsSync(entitlements)) {
    console.warn('[afterPack] Entitlements file not found at ' + entitlements + ' — skipping pre-signing');
    return;
  }

  // Find all .node, .dylib files in unpacked dir + native extraResources
  var binaries = [];
  var nativeBinaryPattern = /\.(node|dylib)$/;

  findFiles(unpackedDir, nativeBinaryPattern, binaries);

  var nativeDir = path.join(resourcesDir, 'native');
  findFiles(nativeDir, nativeBinaryPattern, binaries);

  if (binaries.length === 0) {
    console.log('[afterPack] No native binaries found to pre-sign');
    return;
  }

  console.log('[afterPack] Pre-signing ' + binaries.length + ' native binaries with "' + identity + '"...');

  var failed = 0;
  for (var b = 0; b < binaries.length; b++) {
    var binary = binaries[b];
    var rel = path.relative(appPath, binary);
    try {
      execSync(
        'codesign --force --sign "' + identity + '"' +
        ' --entitlements "' + entitlements + '"' +
        ' --options runtime --timestamp "' + binary + '"',
        { stdio: 'pipe' }
      );
      console.log('  ✓ ' + rel);
    } catch (err) {
      var stderr = err.stderr ? err.stderr.toString().trim() : err.message;
      console.error('  ✗ ' + rel + ': ' + stderr);
      failed++;
    }
  }

  if (failed > 0) {
    console.error('[afterPack] WARNING: ' + failed + ' binaries failed to sign. Notarization may fail.');
  } else {
    console.log('[afterPack] All native binaries pre-signed successfully');
  }
};
