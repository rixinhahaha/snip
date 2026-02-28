/**
 * Ollama lifecycle manager.
 *
 * Spawns the bundled Ollama binary directly (no electron-ollama).
 * Binary lives in vendor/ollama/ (dev) or Resources/ollama/ (packaged).
 * Model files are copied to a writable user data directory on first launch.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Ollama } = require('ollama');

const { getOllamaModel, getOllamaUrl } = require('./store');

let ollamaProcess = null;  // child process
let client = null;          // Ollama JS client
let serverRunning = false;
let startupError = null;

/**
 * Resolve path to the bundled Ollama binary.
 * - Production: process.resourcesPath/ollama/ollama
 * - Development: <project>/vendor/ollama/ollama
 */
function getBinaryPath() {
  var isPackaged = require('electron').app.isPackaged;
  if (isPackaged) {
    return path.join(process.resourcesPath, 'ollama', 'ollama');
  }
  return path.join(__dirname, '..', '..', 'vendor', 'ollama', 'ollama');
}

/**
 * Resolve path to the bundled model files (read-only source).
 * - Production: process.resourcesPath/ollama/models
 * - Development: <project>/vendor/ollama/models
 */
function getBundledModelsPath() {
  var isPackaged = require('electron').app.isPackaged;
  if (isPackaged) {
    return path.join(process.resourcesPath, 'ollama', 'models');
  }
  return path.join(__dirname, '..', '..', 'vendor', 'ollama', 'models');
}

/**
 * Writable models directory in user data.
 * ~/Library/Application Support/snip/ollama/models/
 */
function getUserModelsPath() {
  var { app } = require('electron');
  return path.join(app.getPath('userData'), 'ollama', 'models');
}

/**
 * Recursively copy a directory.
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  var entries = fs.readdirSync(src, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var srcPath = path.join(src, entry.name);
    var destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Copy bundled model files to writable user data dir if not already present.
 */
function ensureModels() {
  var userModels = getUserModelsPath();
  var bundledModels = getBundledModelsPath();
  var defaultModel = getOllamaModel();

  // Check if the default model manifest already exists in user dir
  var manifestDir = path.join(userModels, 'manifests', 'registry.ollama.ai', 'library', defaultModel);
  if (fs.existsSync(manifestDir)) {
    console.log('[Ollama] Model "%s" already in user data', defaultModel);
    return;
  }

  // Check if bundled models exist
  if (!fs.existsSync(bundledModels)) {
    console.log('[Ollama] No bundled models found at %s', bundledModels);
    return;
  }

  console.log('[Ollama] Copying bundled model files to %s ...', userModels);
  copyDirSync(bundledModels, userModels);
  console.log('[Ollama] Model files copied');
}

/**
 * Wait for the Ollama server to respond to health checks.
 */
function waitForServer(url, timeoutMs) {
  var deadline = Date.now() + timeoutMs;
  return new Promise(function (resolve, reject) {
    function check() {
      if (Date.now() > deadline) {
        return reject(new Error('Ollama server did not start within ' + (timeoutMs / 1000) + 's'));
      }
      var http = require('http');
      var req = http.get(url, function (res) {
        resolve();
      });
      req.on('error', function () {
        setTimeout(check, 500);
      });
      req.setTimeout(2000, function () {
        req.destroy();
        setTimeout(check, 500);
      });
    }
    check();
  });
}

/**
 * Start the embedded Ollama server.
 * Copies bundled models on first launch, then spawns `ollama serve`.
 */
async function startOllama() {
  var binaryPath = getBinaryPath();

  if (!fs.existsSync(binaryPath)) {
    startupError = 'Ollama binary not found at ' + binaryPath;
    console.error('[Ollama] ' + startupError);
    return;
  }

  try {
    // Copy bundled models to writable location if needed
    ensureModels();

    var modelsPath = getUserModelsPath();
    fs.mkdirSync(modelsPath, { recursive: true });

    var host = getOllamaUrl() || 'http://127.0.0.1:11434';

    // Spawn ollama serve
    console.log('[Ollama] Starting server from %s', binaryPath);
    ollamaProcess = spawn(binaryPath, ['serve'], {
      env: Object.assign({}, process.env, {
        OLLAMA_HOST: host.replace(/^https?:\/\//, ''),
        OLLAMA_MODELS: modelsPath
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    ollamaProcess.stdout.on('data', function (data) {
      try { console.log('[Ollama] %s', data.toString().trim()); } catch (_) {}
    });
    ollamaProcess.stdout.on('error', function () {}); // suppress EPIPE

    ollamaProcess.stderr.on('data', function (data) {
      try { console.log('[Ollama] %s', data.toString().trim()); } catch (_) {}
    });
    ollamaProcess.stderr.on('error', function () {}); // suppress EPIPE

    ollamaProcess.on('exit', function (code) {
      try { console.log('[Ollama] Process exited with code %s', code); } catch (_) {}
      serverRunning = false;
      ollamaProcess = null;
    });

    // Wait for server to be ready
    await waitForServer(host, 15000);

    serverRunning = true;
    startupError = null;
    console.log('[Ollama] Server started');

    // Create JS client
    client = new Ollama({ host: host });
  } catch (err) {
    startupError = err.message;
    console.error('[Ollama] Failed to start:', err.message);
  }
}

/**
 * Stop the embedded Ollama server (called on app quit).
 */
async function stopOllama() {
  if (ollamaProcess) {
    try {
      ollamaProcess.kill('SIGTERM');
      console.log('[Ollama] Server stopped');
    } catch (err) {
      console.warn('[Ollama] Stop error:', err.message);
    }
  }
  serverRunning = false;
  client = null;
  ollamaProcess = null;
}

/**
 * Get the Ollama JS client (or null if not ready).
 */
function getClient() {
  return client;
}

/**
 * Check if the Ollama server is running and reachable.
 */
async function isReady() {
  if (!client) return false;
  try {
    await client.list();
    return true;
  } catch {
    return false;
  }
}

/**
 * List models available on the local Ollama server.
 * Returns array of { name, size, ... } objects.
 */
async function listModels() {
  if (!client) return [];
  try {
    var result = await client.list();
    return result.models || [];
  } catch {
    return [];
  }
}

/**
 * Pull a model with optional progress callback.
 * @param {string} modelName  e.g. 'minicpm-v'
 * @param {function} onProgress  called with { status, completed, total }
 */
async function pullModel(modelName, onProgress) {
  if (!client) throw new Error('Ollama server not running');

  var stream = await client.pull({ model: modelName, stream: true });
  for await (var part of stream) {
    if (onProgress) {
      onProgress({
        status: part.status,
        completed: part.completed || 0,
        total: part.total || 0
      });
    }
  }
  console.log('[Ollama] Model pulled: %s', modelName);
}

/**
 * Check if the configured model (or a specific model) is available locally.
 */
async function hasModel(modelName) {
  var models = await listModels();
  var target = modelName || getOllamaModel();
  return models.some(function (m) { return m.name.split(':')[0] === target || m.name === target; });
}

/**
 * Get current Ollama status for the settings UI.
 */
async function getStatus() {
  var running = await isReady();
  var models = await listModels();
  return {
    running: running,
    error: startupError,
    models: models.map(function (m) {
      return {
        name: m.name,
        size: m.size,
        modified: m.modified_at
      };
    }),
    currentModel: getOllamaModel()
  };
}

module.exports = {
  startOllama,
  stopOllama,
  getClient,
  isReady,
  listModels,
  pullModel,
  hasModel,
  getStatus
};
