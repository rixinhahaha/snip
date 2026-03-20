/**
 * Upscaler module — spawns image upscaling in an isolated child process
 * using the system Node.js binary (not Electron's) because ONNX runtime
 * crashes (SIGTRAP) inside Electron's V8.
 */
const path = require('path');
const { createWorkerProcess } = require('../worker-process');
const addonManager = require('../addon-manager');

var progressCallback = null;

var wp = createWorkerProcess({
  workerScript: path.join(__dirname, 'upscaler-worker.js'),
  logPrefix: '[Upscaler]',
  onProgress: function (msg) {
    if (progressCallback) progressCallback(msg);
  }
});

/**
 * Upscale an image by 2x.
 * @param {string} imageBase64 - Base64 data URL of the image
 * @param {function} onProgress - Progress callback ({ stage, percent })
 * @returns {Promise<{ dataURL, width, height }>}
 */
function upscaleImage(imageBase64, onProgress) {
  if (!addonManager.isAddonInstalled('upscale')) {
    return Promise.reject(new Error('Upscale add-on not installed'));
  }
  progressCallback = onProgress || null;
  return wp.sendRequest({
    type: 'upscale',
    imageBase64: imageBase64
  });
}

function killWorker() {
  wp.killWorker();
}

module.exports = { upscaleImage, killWorker };
