/**
 * Shared factory for spawning isolated child-process workers.
 *
 * Used by segmentation, upscaler, and embeddings modules. Each worker
 * runs in a forked Node.js process (not Electron) with NODE_PATH pointing
 * to the addon runtime so it can find @huggingface/transformers.
 */
const child_process = require('child_process');
const path = require('path');
const { getModelConfig } = require('./model-paths');
const { findNodeBinary } = require('./node-binary');
const addonManager = require('./addon-manager');

/**
 * Build the environment variables for a child process worker.
 * Sets model paths, addon runtime NODE_PATH, and ONNX config.
 */
function buildChildEnv() {
  var modelConfig = getModelConfig();
  var childEnv = { ...process.env };
  if (modelConfig.cacheDir) {
    childEnv.SNIP_MODELS_PATH = modelConfig.cacheDir;
  }
  if (!modelConfig.allowRemote) {
    childEnv.SNIP_PACKAGED = '1';
  }
  if (process.resourcesPath) {
    childEnv.SNIP_RESOURCES_PATH = process.resourcesPath;
  }
  // Set NODE_PATH so worker can find transformers.js from addon runtime
  var addonNodeModules = addonManager.getRuntimeNodeModules();
  if (childEnv.NODE_PATH) {
    childEnv.NODE_PATH = addonNodeModules + require('path').delimiter + childEnv.NODE_PATH;
  } else {
    childEnv.NODE_PATH = addonNodeModules;
  }
  childEnv.SNIP_ADDON_MODELS_PATH = addonManager.getModelsDir();
  return childEnv;
}

/**
 * Create a managed worker process.
 *
 * @param {object} options
 * @param {string} options.workerScript - Absolute path to the worker JS file
 * @param {string} options.logPrefix    - Log prefix (e.g. '[Segmentation]')
 * @param {function} [options.onProgress] - Optional progress message handler
 * @param {number} [options.timeoutMs]  - Optional per-request timeout (ms)
 * @returns {{ getWorker, sendRequest, killWorker }}
 */
function createWorkerProcess(options) {
  var workerScript = options.workerScript;
  var logPrefix = options.logPrefix || '[Worker]';
  var onProgress = options.onProgress || null;
  var timeoutMs = options.timeoutMs || 0;

  var worker = null;
  var requestId = 0;
  var pendingRequests = new Map();

  function getWorker() {
    if (worker && worker.connected && !worker.killed) return worker;

    var script = workerScript;
    if (script.includes('app.asar')) {
      script = script.replace('app.asar', 'app.asar.unpacked');
    }
    var nodeBin = findNodeBinary();
    var childEnv = buildChildEnv();

    var forkOptions = {
      serialization: 'advanced',
      stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
      env: childEnv
    };

    if (nodeBin) {
      forkOptions.execPath = nodeBin;
    } else {
      childEnv.ELECTRON_RUN_AS_NODE = '1';
    }

    worker = child_process.fork(script, [], forkOptions);

    worker.on('message', function (msg) {
      if (msg.type === 'ready') return;
      if (msg.type === 'progress' && onProgress) {
        onProgress(msg);
        return;
      }
      var pending = pendingRequests.get(msg.id);
      if (pending) {
        pendingRequests.delete(msg.id);
        if (pending.timer) clearTimeout(pending.timer);
        if (msg.type === 'error') {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.data);
        }
      }
    });

    var thisWorker = worker;
    worker.on('exit', function (code, signal) {
      // Guard against stale exit events after killWorker() + respawn
      if (worker !== thisWorker) return;
      if (code !== 0 && code !== null) {
        console.warn(logPrefix + ' Worker exited unexpectedly, code:', code, 'signal:', signal);
      }
      worker = null;
      for (var [id, pending] of pendingRequests) {
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(new Error(logPrefix + ' worker crashed (signal: ' + (signal || code) + ')'));
      }
      pendingRequests.clear();
    });

    worker.on('error', function (err) {
      console.error(logPrefix + ' Worker error:', err.message);
    });

    return worker;
  }

  /**
   * Send a request to the worker and return a Promise for the result.
   * @param {object} message - Message to send (must include a `type` field)
   * @returns {Promise<any>}
   */
  function sendRequest(message) {
    return new Promise(function (resolve, reject) {
      var id = ++requestId;
      var w = getWorker();
      var entry = { resolve: resolve, reject: reject, timer: null };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(function () {
          pendingRequests.delete(id);
          reject(new Error(logPrefix + ' request timed out'));
        }, timeoutMs);
      }
      pendingRequests.set(id, entry);
      w.send(Object.assign({ id: id }, message));
    });
  }

  function killWorker() {
    if (worker && !worker.killed) {
      worker.kill();
      worker = null;
    }
  }

  /**
   * Send a fire-and-forget message to the worker (e.g. warm-up).
   */
  function sendMessage(message) {
    try {
      var w = getWorker();
      w.send(message);
    } catch (err) {
      console.warn(logPrefix + ' sendMessage failed:', err.message);
    }
  }

  return { getWorker: getWorker, sendRequest: sendRequest, sendMessage: sendMessage, killWorker: killWorker };
}

module.exports = { createWorkerProcess };
