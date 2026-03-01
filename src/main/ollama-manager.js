/**
 * Ollama lifecycle manager.
 *
 * Spawns the bundled Ollama binary on a dedicated port (default 11435)
 * so it never conflicts with the user's own Ollama on 11434.
 * Binary lives in vendor/ollama/ (dev) or Resources/ollama/ (packaged).
 * Models are pulled on first launch via `client.pull()` with progress tracking.
 */

const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { Ollama } = require('ollama');

const { getOllamaModel, getOllamaUrl } = require('./store');

let ollamaProcess = null;  // child process
let client = null;          // Ollama JS client
let serverRunning = false;
let startupError = null;

// Model pull state
let pullInProgress = false;
let pullProgress = { status: 'idle', percent: 0, total: 0, completed: 0 };
let modelReady = false;

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
 * Writable models directory in user data.
 * ~/Library/Application Support/snip/ollama/models/
 */
function getUserModelsPath() {
  var { app } = require('electron');
  return path.join(app.getPath('userData'), 'ollama', 'models');
}

/**
 * Find an available port starting from preferredPort.
 * Tries up to maxAttempts sequential ports.
 */
function findAvailablePort(preferredPort, maxAttempts) {
  maxAttempts = maxAttempts || 10;
  var attempt = 0;

  function tryPort(port) {
    return new Promise(function (resolve, reject) {
      var server = net.createServer();
      server.unref();
      server.on('error', function () {
        if (attempt < maxAttempts - 1) {
          attempt++;
          resolve(tryPort(port + 1));
        } else {
          reject(new Error('No available port found in range ' + preferredPort + '-' + (preferredPort + maxAttempts - 1)));
        }
      });
      server.listen(port, '127.0.0.1', function () {
        server.close(function () {
          resolve(port);
        });
      });
    });
  }

  return tryPort(preferredPort);
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
 * Send pull progress to all open BrowserWindows.
 */
function emitPullProgress(progress) {
  var { BrowserWindow } = require('electron');
  var wins = BrowserWindow.getAllWindows();
  for (var i = 0; i < wins.length; i++) {
    if (!wins[i].isDestroyed()) {
      try {
        wins[i].webContents.send('ollama-pull-progress', progress);
      } catch (_) { /* ignore destroyed windows */ }
    }
  }
}

/**
 * Try to symlink a model from the user's system Ollama (~/.ollama/models/)
 * into Snip's model directory to avoid re-downloading.
 * Returns true if symlink was successful, false otherwise.
 */
function trySymlinkSystemModel(modelName) {
  var os = require('os');
  var systemModelsDir = path.join(os.homedir(), '.ollama', 'models');
  var snipModelsDir = getUserModelsPath();

  // Check if system Ollama has the model manifest
  var systemManifestDir = path.join(systemModelsDir, 'manifests', 'registry.ollama.ai', 'library', modelName);
  var systemManifestFile = path.join(systemManifestDir, 'latest');
  if (!fs.existsSync(systemManifestFile)) {
    return false;
  }

  try {
    // Read the manifest to find which blobs are needed
    var manifest = JSON.parse(fs.readFileSync(systemManifestFile, 'utf8'));
    var blobDigests = [];

    // Collect all blob digests from the manifest (config + layers)
    if (manifest.config && manifest.config.digest) {
      blobDigests.push(manifest.config.digest);
    }
    if (manifest.layers) {
      for (var i = 0; i < manifest.layers.length; i++) {
        if (manifest.layers[i].digest) {
          blobDigests.push(manifest.layers[i].digest);
        }
      }
    }

    // Verify all blobs exist in system Ollama
    var systemBlobsDir = path.join(systemModelsDir, 'blobs');
    for (var b = 0; b < blobDigests.length; b++) {
      var blobFile = path.join(systemBlobsDir, blobDigests[b].replace(':', '-'));
      if (!fs.existsSync(blobFile)) {
        console.log('[Ollama] System blob missing: %s — cannot symlink', blobDigests[b]);
        return false;
      }
    }

    // All blobs exist — create symlinks
    var snipBlobsDir = path.join(snipModelsDir, 'blobs');
    fs.mkdirSync(snipBlobsDir, { recursive: true });

    var linkedCount = 0;
    for (var s = 0; s < blobDigests.length; s++) {
      var digest = blobDigests[s];
      var srcBlob = path.join(systemBlobsDir, digest.replace(':', '-'));
      var destBlob = path.join(snipBlobsDir, digest.replace(':', '-'));

      if (!fs.existsSync(destBlob)) {
        fs.symlinkSync(srcBlob, destBlob);
        linkedCount++;
      }
    }

    // Copy the manifest (small file, not worth symlinking)
    var snipManifestDir = path.join(snipModelsDir, 'manifests', 'registry.ollama.ai', 'library', modelName);
    fs.mkdirSync(snipManifestDir, { recursive: true });
    var snipManifestFile = path.join(snipManifestDir, 'latest');
    if (!fs.existsSync(snipManifestFile)) {
      fs.copyFileSync(systemManifestFile, snipManifestFile);
    }

    console.log('[Ollama] Symlinked %d blobs from system Ollama for model "%s"', linkedCount, modelName);
    return true;
  } catch (err) {
    console.warn('[Ollama] Failed to symlink system model:', err.message);
    return false;
  }
}

/**
 * Ensure the required model is available, pulling it if needed.
 * Checks: 1) Snip's own store, 2) system Ollama (symlink), 3) pull from registry.
 * Called after the Ollama server is running. Non-blocking to callers.
 */
async function ensureModel() {
  var defaultModel = getOllamaModel();

  // Check if model already exists in Snip's store
  try {
    var models = await client.list();
    var found = (models.models || []).some(function (m) {
      return m.name === defaultModel || m.name === defaultModel + ':latest';
    });
    if (found) {
      console.log('[Ollama] Model "%s" already available', defaultModel);
      modelReady = true;
      pullProgress = { status: 'ready', percent: 100, total: 0, completed: 0 };
      emitPullProgress(pullProgress);
      return;
    }
  } catch (err) {
    console.warn('[Ollama] Failed to list models:', err.message);
  }

  // Try to symlink from user's system Ollama (~/.ollama/models/)
  if (trySymlinkSystemModel(defaultModel)) {
    // Verify the symlinked model is now visible to our server
    try {
      var modelsAfterLink = await client.list();
      var linkedFound = (modelsAfterLink.models || []).some(function (m) {
        return m.name === defaultModel || m.name === defaultModel + ':latest';
      });
      if (linkedFound) {
        console.log('[Ollama] Model "%s" available via system Ollama symlink', defaultModel);
        modelReady = true;
        pullProgress = { status: 'ready', percent: 100, total: 0, completed: 0 };
        emitPullProgress(pullProgress);
        return;
      }
    } catch (err) {
      console.warn('[Ollama] Symlink verification failed:', err.message);
    }
  }

  // Model not found anywhere — pull from registry
  console.log('[Ollama] Model "%s" not found locally — pulling...', defaultModel);
  pullInProgress = true;
  pullProgress = { status: 'downloading', percent: 0, total: 0, completed: 0 };
  emitPullProgress(pullProgress);

  try {
    var stream = await client.pull({ model: defaultModel, stream: true });
    for await (var event of stream) {
      if (event.total && event.total > 0) {
        pullProgress = {
          status: event.status || 'downloading',
          percent: Math.round((event.completed / event.total) * 100),
          total: event.total,
          completed: event.completed
        };
      } else {
        pullProgress = {
          status: event.status || 'downloading',
          percent: pullProgress.percent,
          total: pullProgress.total,
          completed: pullProgress.completed
        };
      }
      emitPullProgress(pullProgress);
    }
    console.log('[Ollama] Model "%s" pulled successfully', defaultModel);
    modelReady = true;
    pullInProgress = false;
    pullProgress = { status: 'ready', percent: 100, total: 0, completed: 0 };
    emitPullProgress(pullProgress);
  } catch (err) {
    console.error('[Ollama] Pull failed:', err.message);
    pullInProgress = false;
    pullProgress = { status: 'error', percent: 0, total: 0, completed: 0, error: err.message };
    emitPullProgress(pullProgress);
  }
}

/**
 * Start the embedded Ollama server on a dedicated port.
 * Pulls the model on first launch instead of bundling it.
 */
async function startOllama() {
  var binaryPath = getBinaryPath();

  if (!fs.existsSync(binaryPath)) {
    startupError = 'Ollama binary not found at ' + binaryPath;
    console.error('[Ollama] ' + startupError);
    return;
  }

  try {
    var modelsPath = getUserModelsPath();
    fs.mkdirSync(modelsPath, { recursive: true });

    // Parse preferred host/port from config
    var configUrl = getOllamaUrl() || 'http://127.0.0.1:11435';
    var urlObj = new URL(configUrl);
    var preferredPort = parseInt(urlObj.port, 10) || 11435;

    // Find an available port starting from the preferred one
    var port = await findAvailablePort(preferredPort);
    var host = 'http://127.0.0.1:' + port;

    console.log('[Ollama] Starting server from %s on port %d', binaryPath, port);

    // Spawn ollama serve on the dedicated port
    ollamaProcess = spawn(binaryPath, ['serve'], {
      env: Object.assign({}, process.env, {
        OLLAMA_HOST: '127.0.0.1:' + port,
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
    console.log('[Ollama] Server started on %s', host);

    // Create JS client pointing to our dedicated server
    client = new Ollama({ host: host });

    // Ensure the model is available (non-blocking — runs in background)
    ensureModel().catch(function (err) {
      console.error('[Ollama] ensureModel failed:', err.message);
    });
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
  modelReady = false;
}

/**
 * Check if the Ollama server is running, reachable, and the model is ready.
 */
async function isReady() {
  if (!client || !modelReady) return false;
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
 * Get current pull progress for IPC.
 */
function getPullProgress() {
  return pullProgress;
}

/**
 * Get current Ollama status for the settings UI.
 */
async function getStatus() {
  var running = serverRunning;
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
    currentModel: getOllamaModel(),
    modelReady: modelReady,
    pulling: pullInProgress,
    pullProgress: pullProgress
  };
}

module.exports = {
  startOllama,
  stopOllama,
  isReady,
  getStatus,
  getPullProgress
};
