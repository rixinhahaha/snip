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
var { execSync } = require('child_process');

var PROJECT_DIR = path.join(__dirname, '..');
var OUTPUT_DIR = path.join(PROJECT_DIR, 'dist');
var OUTPUT_NAME = 'snip-ai-runtime-darwin-arm64.tar.gz';

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
    env: { ...process.env, npm_config_platform: 'darwin', npm_config_arch: 'arm64' }
  });

  var nmDir = path.join(tmpDir, 'node_modules');
  console.log('==> Installed: ' + formatBytes(getDirSize(nmDir)));

  // Strip unnecessary files
  console.log('==> Stripping unnecessary files...');

  // Remove non-darwin ONNX binaries
  var onnxBinDir = path.join(nmDir, 'onnxruntime-node', 'bin', 'napi-v3');
  if (fs.existsSync(onnxBinDir)) {
    var platforms = fs.readdirSync(onnxBinDir);
    for (var i = 0; i < platforms.length; i++) {
      if (platforms[i] !== 'darwin') {
        removeDir(path.join(onnxBinDir, platforms[i]));
        console.log('  Removed onnxruntime ' + platforms[i]);
      }
    }
    // Remove non-arm64 darwin binaries
    var darwinDir = path.join(onnxBinDir, 'darwin');
    if (fs.existsSync(darwinDir)) {
      var arches = fs.readdirSync(darwinDir);
      for (var j = 0; j < arches.length; j++) {
        if (arches[j] !== 'arm64') {
          removeDir(path.join(darwinDir, arches[j]));
          console.log('  Removed onnxruntime darwin/' + arches[j]);
        }
      }
    }
  }

  // Remove onnxruntime-web (not needed for Node.js)
  removeDir(path.join(nmDir, 'onnxruntime-web'));
  console.log('  Removed onnxruntime-web');

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
  execSync('tar czf ' + JSON.stringify(outputPath) + ' -C ' + JSON.stringify(tmpDir) + ' node_modules', { stdio: 'pipe' });

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
  process.exit(1);
});
