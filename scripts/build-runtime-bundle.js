#!/usr/bin/env node
/**
 * Build the AI runtime bundle for the addon system.
 *
 * Creates a tarball containing @huggingface/transformers, onnxruntime-node,
 * onnxruntime-common, and ffmpeg-static — all pre-built for macOS arm64.
 *
 * Output: dist/snip-ai-runtime-darwin-arm64.tar.gz
 *
 * This tarball is uploaded as a GitHub release asset. When users install
 * their first AI add-on, the app downloads and extracts it to:
 *   ~/Library/Application Support/snip/addons/runtime/
 *
 * Usage:
 *   node scripts/build-runtime-bundle.js
 */

var path = require('path');
var fs = require('fs');
var os = require('os');
var { execSync, execFileSync } = require('child_process');

var PROJECT_DIR = path.join(__dirname, '..');
var OUTPUT_DIR = path.join(PROJECT_DIR, 'dist');

// Parse --platform and --arch flags (default to current system)
var BUILD_PLATFORM = process.platform;
var BUILD_ARCH = process.arch;
var _args = process.argv.slice(2);
for (var _ai = 0; _ai < _args.length; _ai++) {
  if (_args[_ai] === '--platform' && _args[_ai + 1]) { BUILD_PLATFORM = _args[++_ai]; }
  else if (_args[_ai] === '--arch' && _args[_ai + 1]) { BUILD_ARCH = _args[++_ai]; }
}

var OUTPUT_NAME = 'snip-ai-runtime-' + BUILD_PLATFORM + '-' + BUILD_ARCH + '.tar.gz';

function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function getDirSize(dir) {
  var total = 0;
  try {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(fullPath);
      } else {
        total += fs.statSync(fullPath).size;
      }
    }
  } catch (_) {}
  return total;
}

function formatBytes(bytes) {
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

async function main() {
  console.log('Snip AI Runtime Bundle Builder');
  console.log('==============================');

  var tmpDir = path.join(os.tmpdir(), 'snip-runtime-build-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log('==> Working directory: ' + tmpDir);

  // Create a minimal package.json
  var pkg = {
    name: 'snip-ai-runtime',
    version: '1.0.0',
    private: true,
    dependencies: {
      '@huggingface/transformers': '^3.3.0',
      'ffmpeg-static': '^5.3.0',
      'sharp': '^0.33.0'
    }
  };

  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2));

  // Install dependencies
  console.log('==> Installing dependencies...');
  execSync('npm install --production', {
    cwd: tmpDir,
    stdio: 'inherit',
    env: { ...process.env, npm_config_platform: BUILD_PLATFORM, npm_config_arch: BUILD_ARCH }
  });

  var nmDir = path.join(tmpDir, 'node_modules');
  console.log('==> Installed: ' + formatBytes(getDirSize(nmDir)));

  // Strip unnecessary files
  console.log('==> Stripping unnecessary files...');

  // Remove ONNX binaries for other platforms
  var onnxBinDir = path.join(nmDir, 'onnxruntime-node', 'bin', 'napi-v3');
  if (fs.existsSync(onnxBinDir)) {
    var platforms = fs.readdirSync(onnxBinDir);
    for (var i = 0; i < platforms.length; i++) {
      if (platforms[i] !== BUILD_PLATFORM) {
        removeDir(path.join(onnxBinDir, platforms[i]));
        console.log('  Removed onnxruntime ' + platforms[i]);
      }
    }
    // Remove other arch binaries for target platform
    var targetPlatDir = path.join(onnxBinDir, BUILD_PLATFORM);
    if (fs.existsSync(targetPlatDir)) {
      var arches = fs.readdirSync(targetPlatDir);
      for (var j = 0; j < arches.length; j++) {
        if (arches[j] !== BUILD_ARCH) {
          removeDir(path.join(targetPlatDir, arches[j]));
          console.log('  Removed onnxruntime ' + BUILD_PLATFORM + '/' + arches[j]);
        }
      }
    }
  }

  // Remove onnxruntime-web (not needed for Node.js)
  removeDir(path.join(nmDir, 'onnxruntime-web'));
  console.log('  Removed onnxruntime-web');

  // Remove wrong-platform sharp binaries (keep only target platform+arch)
  var keepSuffix = BUILD_PLATFORM + '-' + BUILD_ARCH;
  var imgDir = path.join(nmDir, '@img');
  if (fs.existsSync(imgDir)) {
    var imgPackages = fs.readdirSync(imgDir);
    for (var si = 0; si < imgPackages.length; si++) {
      var pkg2 = imgPackages[si];
      if ((pkg2.startsWith('sharp-') || pkg2.startsWith('sharp-libvips-')) && pkg2.indexOf(keepSuffix) === -1) {
        removeDir(path.join(imgDir, pkg2));
        console.log('  Removed @img/' + pkg2);
      }
    }
  }

  // Remove .map files, READMEs, tests, docs
  function stripJunk(dir) {
    if (!fs.existsSync(dir)) return;
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var k = 0; k < entries.length; k++) {
      var entry = entries[k];
      var fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['test', 'tests', '__tests__', 'docs', 'doc', 'example', 'examples', '.github'].includes(entry.name)) {
          removeDir(fullPath);
        } else {
          stripJunk(fullPath);
        }
      } else if (entry.name.endsWith('.map') || entry.name === 'CHANGELOG.md' || entry.name === 'CONTRIBUTING.md') {
        fs.unlinkSync(fullPath);
      }
    }
  }
  stripJunk(nmDir);
  console.log('  Stripped junk files');

  console.log('==> Final size: ' + formatBytes(getDirSize(nmDir)));

  // Create tarball
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  var outputPath = path.join(OUTPUT_DIR, OUTPUT_NAME);

  console.log('==> Creating tarball...');
  execFileSync('tar', ['czf', outputPath, '-C', tmpDir, 'node_modules'], { stdio: 'pipe' });

  var tarSize = fs.statSync(outputPath).size;
  console.log('==> Output: ' + outputPath);
  console.log('==> Tarball size: ' + formatBytes(tarSize));

  // Cleanup
  removeDir(tmpDir);
  console.log('==> Done!');
}

main().catch(function (err) {
  console.error('Failed:', err.message);
  console.error(err.stack);
  // Clean up temp dir on failure
  try {
    var tmpPattern = path.join(os.tmpdir(), 'snip-runtime-build-*');
    var entries = fs.readdirSync(os.tmpdir()).filter(function (e) { return e.startsWith('snip-runtime-build-'); });
    entries.forEach(function (e) { removeDir(path.join(os.tmpdir(), e)); });
  } catch (_) {}
  process.exit(1);
});
