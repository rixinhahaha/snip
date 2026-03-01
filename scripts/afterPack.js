/**
 * afterPack hook for electron-builder.
 *
 * Runs after the app directory is assembled but BEFORE electron-builder signs
 * the app bundle. This hook:
 *   1. Removes canvas/sharp/@img native modules (unused transitive deps)
 *   2. Removes non-macOS onnxruntime binaries (used by @huggingface/transformers)
 *   3. Removes wrong-arch darwin binaries (keep only the target arch)
 *   4. Pre-signs remaining .node and .dylib files with Developer ID cert
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
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

  // electron-builder Arch enum: 0=x64, 1=ia32, 2=armv7l, 3=arm64, 4=universal
  var archMap = { 0: 'x64', 1: 'ia32', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
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
  //
  //    CSC_LINK provides the cert as base64 .p12, but electron-builder
  //    only imports it into a keychain during its own signing phase
  //    (which runs AFTER afterPack). So we import it into a temp
  //    keychain ourselves, sign, then clean up.
  // ---------------------------------------------------------------
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

  // Also sign the bundled Ollama binary and its support libraries (.dylib, .so, .metallib)
  var ollamaDir = path.join(resourcesDir, 'ollama');
  if (fs.existsSync(ollamaDir)) {
    var ollamaBinaryPattern = /\.(dylib|so|metallib)$/;
    findFiles(ollamaDir, ollamaBinaryPattern, binaries);
    // Sign the main ollama executable too
    var ollamaExe = path.join(ollamaDir, 'ollama');
    if (fs.existsSync(ollamaExe)) {
      binaries.push(ollamaExe);
    }
  }

  if (binaries.length === 0) {
    console.log('[afterPack] No native binaries found to pre-sign');
    return;
  }

  // ---------------------------------------------------------------
  // Resolve signing identity:
  //   1. CSC_LINK env var (base64 .p12) — used in CI
  //   2. Login keychain — used for local dev builds
  // ---------------------------------------------------------------
  var identity = null;
  var tempKeychain = null;
  var keychainPassword = null;
  var tempP12 = null;

  if (process.env.CSC_LINK) {
    // CI path: import .p12 into a temporary keychain
    tempKeychain = path.join(os.tmpdir(), 'snip-afterpack-' + process.pid + '.keychain-db');
    keychainPassword = 'afterpack-temp-' + Date.now();
    tempP12 = path.join(os.tmpdir(), 'snip-afterpack-' + process.pid + '.p12');

    try {
      var p12Data = Buffer.from(process.env.CSC_LINK, 'base64');
      fs.writeFileSync(tempP12, p12Data);

      execSync('security create-keychain -p "' + keychainPassword + '" "' + tempKeychain + '"', { stdio: 'pipe' });
      execSync('security set-keychain-settings -t 300 "' + tempKeychain + '"', { stdio: 'pipe' });
      execSync('security unlock-keychain -p "' + keychainPassword + '" "' + tempKeychain + '"', { stdio: 'pipe' });

      var cscPassword = process.env.CSC_KEY_PASSWORD || '';
      execSync(
        'security import "' + tempP12 + '" -k "' + tempKeychain + '"' +
        ' -P "' + cscPassword + '" -T /usr/bin/codesign -T /usr/bin/security',
        { stdio: 'pipe' }
      );

      execSync(
        'security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "' + keychainPassword + '" "' + tempKeychain + '"',
        { stdio: 'pipe' }
      );

      var existingKeychains = execSync('security list-keychains -d user', { encoding: 'utf8' })
        .split('\n')
        .map(function(line) { return line.trim().replace(/^"|"$/g, ''); })
        .filter(Boolean);
      var allKeychains = [tempKeychain].concat(existingKeychains);
      execSync('security list-keychains -d user -s ' + allKeychains.map(function(k) { return '"' + k + '"'; }).join(' '), { stdio: 'pipe' });

      var identityOutput = execSync(
        'security find-identity -v -p codesigning "' + tempKeychain + '"',
        { encoding: 'utf8' }
      );
      var hashMatch = identityOutput.match(/([A-F0-9]{40})/);
      if (hashMatch) {
        identity = hashMatch[1];
      }
    } catch (err) {
      console.warn('[afterPack] CSC_LINK import failed: ' + (err.stderr ? err.stderr.toString().trim() : err.message));
    }
  }

  // Fallback: look for a Developer ID cert in the login keychain
  if (!identity) {
    try {
      var keychainOutput = execSync(
        'security find-identity -v -p codesigning',
        { encoding: 'utf8' }
      );
      // Look for "Developer ID Application" identity
      var devIdMatch = keychainOutput.match(/([A-F0-9]{40})\s+"Developer ID Application:/);
      if (devIdMatch) {
        identity = devIdMatch[1];
        console.log('[afterPack] Found Developer ID cert in login keychain');
      }
    } catch (err) {
      // No codesigning identities found
    }
  }

  if (!identity) {
    console.log('[afterPack] No signing identity found — skipping native binary pre-signing');
    return;
  }

  console.log('[afterPack] Pre-signing ' + binaries.length + ' native binaries with identity ' + identity.substring(0, 8) + '...');

  var keychainFlag = tempKeychain ? ' --keychain "' + tempKeychain + '"' : '';
  var failed = 0;

  for (var b = 0; b < binaries.length; b++) {
    var binary = binaries[b];
    var rel = path.relative(appPath, binary);
    try {
      execSync(
        'codesign --force --sign "' + identity + '"' +
        keychainFlag +
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
    console.error('[afterPack] WARNING: ' + failed + '/' + binaries.length + ' binaries failed to sign.');
  } else {
    console.log('[afterPack] All native binaries pre-signed successfully');
  }

  // Clean up temp keychain if created
  if (tempP12) {
    try { fs.unlinkSync(tempP12); } catch (e) { /* ignore */ }
  }
  if (tempKeychain) {
    try {
      execSync('security delete-keychain "' + tempKeychain + '"', { stdio: 'pipe' });
    } catch (e) { /* ignore */ }
  }
};
