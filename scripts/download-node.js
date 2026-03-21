#!/usr/bin/env node
/**
 * Download Node.js binary for bundling with the packaged app.
 *
 * The SAM segmentation child process needs a standalone Node.js binary
 * because ONNX Runtime crashes inside Electron's V8. This script downloads
 * only the `bin/node` executable from the official Node.js distribution.
 *
 * Usage:
 *   node scripts/download-node.js              # current arch (arm64)
 *   node scripts/download-node.js --arch arm64  # explicit
 *
 * Output:
 *   vendor/node/{arch}/node   (~100 MB uncompressed)
 */

var path = require('path');
var fs = require('fs');
var https = require('https');
var { execSync } = require('child_process');

var NODE_VERSION = '22.14.0';
var PROJECT_DIR = path.join(__dirname, '..');
var VENDOR_NODE = path.join(PROJECT_DIR, 'vendor', 'node');

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function parseArgs() {
  var arch = process.arch;
  var plat = process.platform;
  var args = process.argv.slice(2);
  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--arch' && args[i + 1]) {
      arch = args[i + 1];
      i++;
    } else if (args[i] === '--platform' && args[i + 1]) {
      plat = args[i + 1];
      i++;
    }
  }
  return { arch: arch, platform: plat };
}

function httpsGet(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function main() {
  var opts = parseArgs();
  var arch = opts.arch;
  var plat = opts.platform;
  var binName = plat === 'win32' ? 'node.exe' : 'node';
  var destDir = path.join(VENDOR_NODE, arch);
  var destFile = path.join(destDir, binName);

  console.log('Snip Node.js Downloader');
  console.log('=======================');
  console.log('  Node.js version: v' + NODE_VERSION);
  console.log('  Platform:        ' + plat);
  console.log('  Architecture:    ' + arch);
  console.log('  Destination:     vendor/node/' + arch + '/' + binName);
  console.log('');

  // Check if already downloaded
  if (fs.existsSync(destFile)) {
    try {
      var version = execSync('"' + destFile + '" --version', { encoding: 'utf8' }).trim();
      if (version === 'v' + NODE_VERSION) {
        console.log('==> Already downloaded: ' + version);
        console.log('    Size: ' + formatBytes(fs.statSync(destFile).size));
        return;
      }
      console.log('==> Existing binary is ' + version + ', need v' + NODE_VERSION + ' — re-downloading');
    } catch (_) {
      console.log('==> Existing binary is invalid — re-downloading');
    }
  }

  // Download tarball
  var tarballName = 'node-v' + NODE_VERSION + '-' + plat + '-' + arch + '.tar.gz';
  var url = 'https://nodejs.org/dist/v' + NODE_VERSION + '/' + tarballName;
  console.log('==> Downloading ' + tarballName + '...');

  var tmpDir = path.join(VENDOR_NODE, '.tmp-' + arch);
  var tmpTarball = path.join(tmpDir, tarballName);

  fs.mkdirSync(tmpDir, { recursive: true });

  // Stream download to temp file
  var res = await httpsGet(url);
  var totalBytes = parseInt(res.headers['content-length'], 10) || 0;
  var downloaded = 0;
  var lastPercent = -1;

  await new Promise(function (resolve, reject) {
    var file = fs.createWriteStream(tmpTarball);
    res.on('data', function (chunk) {
      downloaded += chunk.length;
      if (totalBytes > 0) {
        var percent = Math.floor((downloaded / totalBytes) * 100);
        if (percent !== lastPercent && percent % 10 === 0) {
          lastPercent = percent;
          process.stdout.write('    ' + percent + '% (' + formatBytes(downloaded) + '/' + formatBytes(totalBytes) + ')\n');
        }
      }
    });
    res.pipe(file);
    file.on('finish', function () { file.close(resolve); });
    file.on('error', reject);
    res.on('error', reject);
  });

  console.log('    Downloaded: ' + formatBytes(downloaded));

  // Extract only bin/node from tarball
  console.log('==> Extracting bin/node...');
  fs.mkdirSync(destDir, { recursive: true });

  var stripPrefix = 'node-v' + NODE_VERSION + '-' + plat + '-' + arch + '/bin/' + binName;
  execSync(
    'tar -xzf "' + tmpTarball + '" -C "' + destDir + '" --strip-components=2 "' + stripPrefix + '"',
    { stdio: 'inherit' }
  );

  // Make executable
  fs.chmodSync(destFile, 0o755);

  // Verify
  var ver = execSync('"' + destFile + '" --version', { encoding: 'utf8' }).trim();
  var size = fs.statSync(destFile).size;
  console.log('==> Extracted: ' + ver + ' (' + formatBytes(size) + ')');

  // Clean up temp
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n==> Done! Bundled Node.js binary ready at vendor/node/' + arch + '/' + binName);
}

main().catch(function (err) {
  console.error('\nFailed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
