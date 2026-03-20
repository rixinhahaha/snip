/**
 * Segmentation module — spawns SAM inference in an isolated child process
 * using the system Node.js binary (not Electron's) because ONNX runtime
 * crashes (SIGTRAP) inside Electron's V8.
 */
const path = require('path');
const os = require('os');
const { findNodeBinary } = require('../node-binary');
const addonManager = require('../addon-manager');
const { createWorkerProcess } = require('../worker-process');

var wp = createWorkerProcess({
  workerScript: path.join(__dirname, 'segmentation-worker.js'),
  logPrefix: '[Segmentation]'
});

function checkSupport() {
  if (!addonManager.isAddonInstalled('segment')) {
    return { supported: false, reason: 'addon_not_installed' };
  }
  var totalMem = os.totalmem();
  if (totalMem < 4 * 1024 * 1024 * 1024) {
    return { supported: false, reason: 'Insufficient memory (need 4GB+)' };
  }
  var nodeBin = findNodeBinary();
  if (!nodeBin) {
    return { supported: false, reason: 'Node.js binary not found' };
  }
  return { supported: true };
}

function generateMask(rgbaPixels, imgWidth, imgHeight, points, cssWidth, cssHeight) {
  return wp.sendRequest({
    type: 'generate-mask',
    rgbaBuffer: Buffer.from(rgbaPixels.buffer, rgbaPixels.byteOffset, rgbaPixels.byteLength),
    imgWidth: imgWidth,
    imgHeight: imgHeight,
    points: points,
    cssWidth: cssWidth,
    cssHeight: cssHeight
  });
}

function warmUp() {
  var support = checkSupport();
  if (!support.supported) return;
  wp.sendMessage({ type: 'warm-up' });
}

function killWorker() {
  wp.killWorker();
}

module.exports = { generateMask, checkSupport, warmUp, killWorker };
