/**
 * Upscaler module — spawns image upscaling in an isolated child process
 * using the system Node.js binary (not Electron's) because ONNX runtime
 * crashes (SIGTRAP) inside Electron's V8.
 */
const child_process = require('child_process');
const path = require('path');
const { getModelConfig } = require('../model-paths');
const { findNodeBinary } = require('../node-binary');

let worker = null;
let requestId = 0;
const pendingRequests = new Map();

function getWorker() {
  if (worker && worker.connected && !worker.killed) return worker;

  let workerScript = path.join(__dirname, 'upscaler-worker.js');
  // System Node.js can't read from inside an asar archive
  if (workerScript.includes('app.asar')) {
    workerScript = workerScript.replace('app.asar', 'app.asar.unpacked');
  }
  const nodeBin = findNodeBinary();

  // Pass model cache path to child process
  const modelConfig = getModelConfig();
  const childEnv = { ...process.env };
  if (modelConfig.cacheDir) {
    childEnv.SNIP_MODELS_PATH = modelConfig.cacheDir;
  }
  if (!modelConfig.allowRemote) {
    childEnv.SNIP_PACKAGED = '1';
  }
  if (process.resourcesPath) {
    childEnv.SNIP_RESOURCES_PATH = process.resourcesPath;
  }

  const forkOptions = {
    serialization: 'advanced',
    stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
    env: childEnv
  };

  if (nodeBin) {
    forkOptions.execPath = nodeBin;
  } else {
    childEnv.ELECTRON_RUN_AS_NODE = '1';
  }

  worker = child_process.fork(workerScript, [], forkOptions);

  worker.on('message', (msg) => {
    if (msg.type === 'ready') return;
    if (msg.type === 'progress') {
      // Forward progress to all pending request callbacks
      for (const [, pending] of pendingRequests) {
        if (pending.onProgress) pending.onProgress(msg);
      }
      return;
    }
    const pending = pendingRequests.get(msg.id);
    if (pending) {
      pendingRequests.delete(msg.id);
      if (msg.type === 'error') {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.data);
      }
    }
  });

  worker.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn('[Upscaler] Worker exited unexpectedly, code:', code, 'signal:', signal);
    }
    worker = null;
    for (const [id, { reject }] of pendingRequests) {
      reject(new Error('Upscaler worker crashed (signal: ' + (signal || code) + ')'));
    }
    pendingRequests.clear();
  });

  worker.on('error', (err) => {
    console.error('[Upscaler] Worker error:', err.message);
  });

  return worker;
}

/**
 * Upscale an image by 2x.
 * @param {string} imageBase64 - Base64 data URL of the image
 * @param {function} onProgress - Progress callback ({ stage, percent })
 * @returns {Promise<{ dataURL, width, height }>}
 */
function upscaleImage(imageBase64, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const w = getWorker();
    pendingRequests.set(id, { resolve, reject, onProgress });

    w.send({
      id,
      type: 'upscale',
      imageBase64
    });
  });
}

function killWorker() {
  if (worker && !worker.killed) {
    worker.kill();
    worker = null;
  }
}

module.exports = { upscaleImage, killWorker };
