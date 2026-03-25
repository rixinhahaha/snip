/**
 * afterPack hook for electron-builder.
 *
 * Runs after the app directory is assembled but BEFORE electron-builder signs
 * the app bundle. This hook:
 *   1. Copies the arch-specific bundled Node.js binary into Resources/node/
 *   2. Removes unused native modules (canvas)
 *   3. Removes AI runtime deps that may leak in as transitive deps
 *      (transformers, onnxruntime, ffmpeg — these are downloaded on demand via addon system)
 *   4. Removes wrong-arch native binaries (sharp, electron-liquid-glass)
 *   5. Pre-signs remaining .node and .dylib files with Developer ID cert
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
  var platformName = context.packager.platform.name;

  // On Linux, only copy the bundled Node.js binary (no codesigning needed)
  if (platformName === 'linux') {
    var linuxResourcesDir = path.join(context.appOutDir, 'resources');
    var archMap = { 1: 'x64', 3: 'arm64' };
    var linuxArch = archMap[context.arch] || process.arch;
    var linuxNodeSrc = path.join(__dirname, '..', 'vendor', 'node', linuxArch, 'node');
    var linuxNodeDestDir = path.join(linuxResourcesDir, 'node');
    var linuxNodeDest = path.join(linuxNodeDestDir, 'node');
    if (fs.existsSync(linuxNodeSrc)) {
      fs.mkdirSync(linuxNodeDestDir, { recursive: true });
      fs.copyFileSync(linuxNodeSrc, linuxNodeDest);
      fs.chmodSync(linuxNodeDest, 0o755);
      console.log('[afterPack] Copied bundled Node.js binary for linux-' + linuxArch);
    } else {
      console.warn('[afterPack] No bundled Node.js binary at ' + linuxNodeSrc);
    }
    return;
  }

  // Everything below is macOS-specific (codesigning, .app bundle structure)
  if (platformName !== 'mac') return;

  var appOutDir = context.appOutDir;
  var appName = context.packager.appInfo.productFilename;
  var appPath = path.join(appOutDir, appName + '.app');
  var resourcesDir = path.join(appPath, 'Contents', 'Resources');
  var unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');

  if (!fs.existsSync(unpackedDir)) {
    console.log('[afterPack] No app.asar.unpacked directory — skipping');
    return;
  }

  // electron-builder Arch enum: 3=arm64 (only arch we support)
  var targetArch = 'arm64';
  console.log('[afterPack] Target architecture: ' + targetArch);

  // ---------------------------------------------------------------
  // 1. Copy arch-specific bundled Node.js binary
  //    electron-builder's extraResources doesn't interpolate ${arch}
  //    in from paths, so we copy the correct binary here.
  // ---------------------------------------------------------------
  var vendorNodeSrc = path.join(__dirname, '..', 'vendor', 'node', targetArch, 'node');
  var nodeDestDir = path.join(resourcesDir, 'node');
  var nodeDestFile = path.join(nodeDestDir, 'node');
  if (fs.existsSync(vendorNodeSrc)) {
    fs.mkdirSync(nodeDestDir, { recursive: true });
    fs.copyFileSync(vendorNodeSrc, nodeDestFile);
    fs.chmodSync(nodeDestFile, 0o755);
    console.log('[afterPack] Copied bundled Node.js binary for ' + targetArch);
  } else {
    console.warn('[afterPack] No bundled Node.js binary found at ' + vendorNodeSrc + ' — segment tool may not work');
  }

  // ---------------------------------------------------------------
  // 2. Pre-compile Swift transcription helper
  //    End users don't have swiftc (Xcode Command Line Tools),
  //    so we compile the binary at build time and bundle it.
  // ---------------------------------------------------------------
  // Read source from the project tree (not from app.asar.unpacked — the .swift
  // file is not in asarUnpack since it's only needed at build time, not runtime).
  var swiftSrc = path.join(__dirname, '..', 'src', 'main', 'transcription', 'transcribe.swift');
  var transcribeBinDir = path.join(resourcesDir, 'transcribe-bin');
  var transcribeBin = path.join(transcribeBinDir, 'transcribe');

  if (fs.existsSync(swiftSrc)) {
    fs.mkdirSync(transcribeBinDir, { recursive: true });
    console.log('[afterPack] Compiling Swift transcription helper...');
    try {
      // Keep framework flags in sync with src/main/transcription/transcription.js (dev-mode compile)
      execSync(
        'swiftc -O "' + swiftSrc + '"' +
        ' -o "' + transcribeBin + '"' +
        ' -target ' + targetArch + '-apple-macos13.0' +
        ' -framework Vision -framework AppKit',
        { stdio: 'pipe', timeout: 60000 }
      );
      fs.chmodSync(transcribeBin, 0o755);
      console.log('[afterPack] Swift transcription helper compiled successfully');
    } catch (err) {
      var stderr = err.stderr ? err.stderr.toString().trim() : err.message;
      throw new Error('[afterPack] Failed to compile transcription helper: ' + stderr);
    }
  } else {
    console.warn('[afterPack] transcribe.swift not found at ' + swiftSrc + ' — skipping');
  }

  // ---------------------------------------------------------------
  // 3. Remove unused native modules (canvas)
  // ---------------------------------------------------------------
  var nmDir = path.join(unpackedDir, 'node_modules');

  removeDir(path.join(nmDir, 'canvas'), 'canvas (unused transitive dep)');

  // onnxruntime-node, onnxruntime-web, @huggingface/transformers, ffmpeg-static
  // are no longer bundled — they're downloaded on demand via the addon system.
  // Clean up any that might have leaked in as transitive deps.
  removeDir(path.join(nmDir, 'onnxruntime-web'), 'onnxruntime-web (not bundled)');
  removeDir(path.join(nmDir, 'onnxruntime-node'), 'onnxruntime-node (not bundled — addon runtime)');
  removeDir(path.join(nmDir, 'onnxruntime-common'), 'onnxruntime-common (not bundled — addon runtime)');
  removeDir(path.join(nmDir, '@huggingface'), '@huggingface (not bundled — addon runtime)');
  removeDir(path.join(nmDir, 'ffmpeg-static'), 'ffmpeg-static (not bundled — addon runtime)');

  // ---------------------------------------------------------------
  // 3c. Remove wrong-arch electron-liquid-glass prebuilds
  // ---------------------------------------------------------------
  var elgPrebuildsDir = path.join(nmDir, 'electron-liquid-glass', 'prebuilds');
  if (fs.existsSync(elgPrebuildsDir)) {
    var elgPlatforms = fs.readdirSync(elgPrebuildsDir);
    for (var ep = 0; ep < elgPlatforms.length; ep++) {
      var elgPlat = elgPlatforms[ep];
      if (elgPlat !== 'darwin-' + targetArch) {
        removeDir(
          path.join(elgPrebuildsDir, elgPlat),
          'electron-liquid-glass ' + elgPlat + ' (building for ' + targetArch + ')'
        );
      }
    }
  }

  // ---------------------------------------------------------------
  // 3d. Remove wrong-platform/arch @img/sharp-* packages
  //     npm only installs the matching platform, but strip any
  //     that don't match darwin-{targetArch} as a safety net.
  // ---------------------------------------------------------------
  var imgDir = path.join(nmDir, '@img');
  if (fs.existsSync(imgDir)) {
    var keepSuffix = 'darwin-' + targetArch;
    var imgPackages = fs.readdirSync(imgDir);
    for (var si = 0; si < imgPackages.length; si++) {
      var pkg = imgPackages[si];
      // Only strip platform-specific packages (sharp-<platform>-<arch>, sharp-libvips-<platform>-<arch>)
      // Keep non-platform packages like "colour"
      if ((pkg.startsWith('sharp-darwin-') || pkg.startsWith('sharp-libvips-darwin-') ||
           pkg.startsWith('sharp-linux') || pkg.startsWith('sharp-libvips-linux') ||
           pkg.startsWith('sharp-win32') || pkg.startsWith('sharp-wasm') ||
           pkg.startsWith('sharp-linuxmusl') || pkg.startsWith('sharp-libvips-linuxmusl')) &&
          pkg.indexOf(keepSuffix) === -1) {
        removeDir(path.join(imgDir, pkg), '@img/' + pkg + ' (not needed for ' + keepSuffix + ')');
      }
    }
  }

  // ---------------------------------------------------------------
  // 5. Pre-sign remaining native binaries
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

  // Also sign the bundled Node.js binary
  var bundledNode = path.join(resourcesDir, 'node', 'node');
  if (fs.existsSync(bundledNode)) {
    binaries.push(bundledNode);
  }

  // Also sign the pre-compiled transcribe binary
  if (fs.existsSync(transcribeBin)) {
    binaries.push(transcribeBin);
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
