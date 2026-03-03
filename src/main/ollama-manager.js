/**
 * Ollama lifecycle manager.
 *
 * Spawns a dedicated `ollama serve` process on a dynamic port at app start.
 * The process is NOT detached — it dies with the parent even on crash.
 * Detects system Ollama binary, auto-starts if found, and prompts the
 * user to install if missing. Never bundles an Ollama binary.
 */

const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { Notification } = require('electron');
const { Ollama } = require('ollama');
const https = require('https');

const { getOllamaModel, getOllamaUrl } = require('./store');

let client = null;
let serverRunning = false;
let startupError = null;
let ollamaInstalled = false;

// Managed Ollama child process
let ollamaProcess = null;
let managedHost = null;

// Model pull state
let pullInProgress = false;
let pullProgress = { status: 'idle', percent: 0, total: 0, completed: 0 };
let modelReady = false;

// Install state
let installInProgress = false;
let installProgress = { status: 'idle', percent: 0 };
let onInstallComplete = null;

// Known CLI binary paths for macOS (packaged apps don't inherit shell PATH)
var KNOWN_CLI_PATHS = [
  '/usr/local/bin/ollama',
  '/opt/homebrew/bin/ollama'
];

var OLLAMA_APP_PATH = '/Applications/Ollama.app';
var OLLAMA_APP_BINARY = '/Applications/Ollama.app/Contents/Resources/ollama';
var DEFAULT_HOST = 'http://127.0.0.1:11434';

/**
 * Find an available TCP port by binding to port 0.
 * Returns a Promise that resolves to the port number.
 */
function findFreePort() {
  return new Promise(function (resolve, reject) {
    var server = net.createServer();
    server.listen(0, '127.0.0.1', function () {
      var port = server.address().port;
      server.close(function () {
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

/**
 * Find the Ollama CLI binary path on the system.
 * Checks known CLI paths first, then falls back to the binary inside Ollama.app.
 * Returns the path string or null if not found.
 */
function findOllamaBinary() {
  for (var i = 0; i < KNOWN_CLI_PATHS.length; i++) {
    if (fs.existsSync(KNOWN_CLI_PATHS[i])) {
      return KNOWN_CLI_PATHS[i];
    }
  }
  // Check the binary inside Ollama.app
  if (fs.existsSync(OLLAMA_APP_BINARY)) {
    return OLLAMA_APP_BINARY;
  }
  return null;
}

/**
 * Check if Ollama is reachable at the given URL.
 */
function checkServer(url) {
  return new Promise(function (resolve) {
    var http = require('http');
    var req = http.get(url, function (res) {
      resolve(true);
    });
    req.on('error', function () {
      resolve(false);
    });
    req.setTimeout(3000, function () {
      req.destroy();
      resolve(false);
    });
  });
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
 * Broadcast an IPC message to all open BrowserWindows.
 */
function broadcastToWindows(channel, data) {
  var { BrowserWindow } = require('electron');
  var wins = BrowserWindow.getAllWindows();
  for (var i = 0; i < wins.length; i++) {
    if (!wins[i].isDestroyed()) {
      try { wins[i].webContents.send(channel, data); } catch (_) {}
    }
  }
}

function emitPullProgress(progress) {
  broadcastToWindows('ollama-pull-progress', progress);
}

function showInstallNotification(body) {
  var n = new Notification({ title: 'Snip', body: body });
  n.on('click', function() {
    var { BrowserWindow } = require('electron');
    var wins = BrowserWindow.getAllWindows();
    for (var i = 0; i < wins.length; i++) {
      if (!wins[i].isDestroyed()) {
        try {
          wins[i].webContents.send('show-setup-overlay');
          wins[i].show();
          wins[i].focus();
        } catch (_) {}
      }
    }
  });
  n.show();
}

function emitInstallProgress(progress) {
  broadcastToWindows('ollama-install-progress', progress);
}

async function emitStatus() {
  var status = await getStatus();
  broadcastToWindows('ollama-status-changed', status);
}

/**
 * Check if Ollama is installed on the system.
 * Returns the path to the binary or app, or null if not found.
 * Used for install detection (UI status) — spawning uses findOllamaBinary().
 */
function findOllamaInstall() {
  // Check for Ollama.app first (most common macOS install)
  if (fs.existsSync(OLLAMA_APP_PATH)) {
    return { type: 'app', path: OLLAMA_APP_PATH };
  }

  // Check known CLI paths
  for (var i = 0; i < KNOWN_CLI_PATHS.length; i++) {
    if (fs.existsSync(KNOWN_CLI_PATHS[i])) {
      return { type: 'cli', path: KNOWN_CLI_PATHS[i] };
    }
  }

  return null;
}

/**
 * Start Ollama by spawning a dedicated `ollama serve` on a dynamic port.
 * The process is NOT detached — it dies with the parent even on crash.
 *
 * 1. Find the Ollama binary
 * 2. If not found → set not_installed status, return
 * 3. Find a free port
 * 4. Spawn `ollama serve` with OLLAMA_HOST=127.0.0.1:<port>
 * 5. Wait for server to respond
 * 6. Push host URL to worker thread via message passing
 */
async function startOllama() {
  // Kill any previously managed process first
  if (ollamaProcess) {
    try { ollamaProcess.kill('SIGTERM'); } catch (_) {}
    ollamaProcess = null;
  }

  // Step 1: Find binary
  var binaryPath = findOllamaBinary();
  if (!binaryPath) {
    ollamaInstalled = !!findOllamaInstall();
    serverRunning = false;
    startupError = 'not_installed';
    console.log('[Ollama] %s', ollamaInstalled ? 'Installed but binary not found' : 'Not installed — waiting for user to install');
    emitStatus();
    return;
  }
  ollamaInstalled = true;

  // Step 2: Find free port
  var port;
  try {
    port = await findFreePort();
  } catch (err) {
    startupError = 'Failed to find free port: ' + err.message;
    console.error('[Ollama]', startupError);
    emitStatus();
    return;
  }

  var host = 'http://127.0.0.1:' + port;
  console.log('[Ollama] Spawning server on port %d using %s', port, binaryPath);

  // Step 3: Spawn ollama serve — NOT detached, NOT unref'd (dies with parent)
  try {
    var env = Object.assign({}, process.env, {
      OLLAMA_HOST: '127.0.0.1:' + port
    });

    ollamaProcess = spawn(binaryPath, ['serve'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: env
    });

    ollamaProcess.stdout.on('data', function (data) {
      console.log('[Ollama server] %s', data.toString().trim());
    });
    ollamaProcess.stderr.on('data', function (data) {
      console.log('[Ollama server] %s', data.toString().trim());
    });

    ollamaProcess.on('error', function (err) {
      console.error('[Ollama] Process error:', err.message);
      serverRunning = false;
      startupError = err.message;
      ollamaProcess = null;
      emitStatus();
    });

    ollamaProcess.on('exit', function (code, signal) {
      console.log('[Ollama] Process exited (code=%s signal=%s)', code, signal);
      ollamaProcess = null;
      serverRunning = false;
    });
  } catch (err) {
    startupError = 'Failed to spawn ollama: ' + err.message;
    console.error('[Ollama]', startupError);
    emitStatus();
    return;
  }

  // Step 4: Wait for the server to start responding
  try {
    await waitForServer(host, 30000);
  } catch (err) {
    startupError = 'Server failed to start: ' + err.message;
    console.error('[Ollama]', startupError);
    try { ollamaProcess.kill('SIGTERM'); } catch (_) {}
    ollamaProcess = null;
    emitStatus();
    return;
  }

  // Step 5: Push the host URL to the worker thread via message passing
  managedHost = host;
  try {
    var { setOllamaHost } = require('./organizer/watcher');
    setOllamaHost(host);
  } catch (_) { /* watcher not started yet — agent will fall back to getOllamaUrl() */ }

  serverRunning = true;
  startupError = null;
  client = new Ollama({ host: host });
  console.log('[Ollama] Spawned server on port %d — ready', port);
  emitStatus();
}

/**
 * Download and install Ollama.
 * Downloads Ollama-darwin.zip, extracts Ollama.app, opens the DMG-like experience.
 */
async function installOllama() {
  if (installInProgress) {
    return { success: false, error: 'Install already in progress' };
  }

  installInProgress = true;
  // Single continuous progress: download 0-85%, extract 85-90%, install 90-95%, launch 95-100%
  installProgress = { status: 'downloading', percent: 0 };
  emitInstallProgress(installProgress);

  var { app } = require('electron');
  var tmpDir = app.getPath('temp');
  var zipPath = path.join(tmpDir, 'Ollama-darwin.zip');
  var extractDir = path.join(tmpDir, 'Ollama-extract');

  try {
    // Download the zip (0% – 85%)
    await downloadFile('https://ollama.com/download/Ollama-darwin.zip', zipPath, function (percent) {
      var scaled = Math.round(percent * 0.85);
      installProgress = { status: 'downloading', percent: scaled };
      emitInstallProgress(installProgress);
    });

    showInstallNotification('Ollama downloaded — unpacking...');
    installProgress = { status: 'extracting', percent: 87 };
    emitInstallProgress(installProgress);

    // Clean extract dir if it exists
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(extractDir, { recursive: true });

    // Extract the zip
    await new Promise(function (resolve, reject) {
      var child = spawn('unzip', ['-o', '-q', zipPath, '-d', extractDir], { stdio: 'ignore' });
      child.on('error', reject);
      child.on('close', function (code) {
        if (code === 0) resolve();
        else reject(new Error('unzip exited with code ' + code));
      });
    });

    // Move Ollama.app to /Applications/
    var extractedApp = path.join(extractDir, 'Ollama.app');
    if (!fs.existsSync(extractedApp)) {
      throw new Error('Ollama.app not found in downloaded archive');
    }

    showInstallNotification('Ollama unpacked — installing...');
    installProgress = { status: 'installing', percent: 92 };
    emitInstallProgress(installProgress);

    // Remove existing Ollama.app if present, then move
    if (fs.existsSync(OLLAMA_APP_PATH)) {
      fs.rmSync(OLLAMA_APP_PATH, { recursive: true, force: true });
    }

    await new Promise(function (resolve, reject) {
      var child = spawn('mv', [extractedApp, '/Applications/'], { stdio: 'ignore' });
      child.on('error', reject);
      child.on('close', function (code) {
        if (code === 0) resolve();
        else reject(new Error('Failed to move Ollama.app to /Applications/ (code ' + code + ')'));
      });
    });

    // Clean up temp files
    try { fs.unlinkSync(zipPath); } catch (_) {}
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (_) {}

    // Launch our own managed server (not the GUI app)
    ollamaInstalled = true;
    showInstallNotification('Ollama installed — launching...');
    installProgress = { status: 'launching', percent: 96 };
    emitInstallProgress(installProgress);

    await startOllama();

    installInProgress = false;
    installProgress = { status: 'done', percent: 100 };
    emitInstallProgress(installProgress);
    emitStatus();
    if (onInstallComplete) onInstallComplete();

    showInstallNotification('Ollama is ready!');
    console.log('[Ollama] Installed and running');
    return { success: true };
  } catch (err) {
    installInProgress = false;
    installProgress = { status: 'error', percent: 0, error: err.message };
    emitInstallProgress(installProgress);
    console.error('[Ollama] Install failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Download a file with progress tracking.
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise(function (resolve, reject) {
    function doRequest(requestUrl) {
      https.get(requestUrl, function (res) {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doRequest(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error('Download failed with status ' + res.statusCode));
        }

        var totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        var downloadedBytes = 0;
        var file = fs.createWriteStream(destPath);

        res.on('data', function (chunk) {
          downloadedBytes += chunk.length;
          if (totalBytes > 0 && onProgress) {
            onProgress(Math.round((downloadedBytes / totalBytes) * 100));
          }
        });

        res.pipe(file);

        file.on('finish', function () {
          file.close(resolve);
        });

        file.on('error', function (err) {
          fs.unlink(destPath, function () {});
          reject(err);
        });
      }).on('error', reject);
    }
    doRequest(url);
  });
}

/**
 * Pull the configured model. Called explicitly by user action.
 */
async function pullModel() {
  if (pullInProgress) {
    return { success: false, error: 'Pull already in progress' };
  }

  // Verify server is still alive; restart our managed instance if not
  var host = managedHost || getOllamaUrl() || DEFAULT_HOST;
  var alive = await checkServer(host);
  if (!alive) {
    console.log('[Ollama] Server not responding — restarting managed instance...');
    try {
      await startOllama();
    } catch (err) {
      return { success: false, error: 'Failed to restart Ollama: ' + err.message };
    }
    if (!serverRunning) {
      return { success: false, error: 'Ollama is not running. Please check that Ollama is installed.' };
    }
  }

  if (!client) {
    return { success: false, error: 'Ollama is not running' };
  }

  var modelName = getOllamaModel();
  console.log('[Ollama] Pulling model "%s"...', modelName);

  pullInProgress = true;
  pullProgress = { status: 'downloading', model: modelName, percent: 0, total: 0, completed: 0 };
  emitPullProgress(pullProgress);

  try {
    var stream = await client.pull({ model: modelName, stream: true });
    // Track per-digest progress to accumulate across all layers
    var digestSizes = {};    // digest → total bytes
    var digestDone = {};     // digest → completed bytes

    for await (var event of stream) {
      var digest = event.digest || null;
      var evtStatus = event.status || 'downloading';

      if (digest && event.total && event.total > 0) {
        digestSizes[digest] = event.total;
        digestDone[digest] = event.completed || 0;

        // Sum all layers for overall progress
        var sumTotal = 0;
        var sumDone = 0;
        var digests = Object.keys(digestSizes);
        for (var d = 0; d < digests.length; d++) {
          sumTotal += digestSizes[digests[d]];
          sumDone += (digestDone[digests[d]] || 0);
        }
        var overallPercent = sumTotal > 0 ? Math.round((sumDone / sumTotal) * 100) : 0;

        pullProgress = {
          status: evtStatus,
          model: modelName,
          percent: overallPercent,
          total: sumTotal,
          completed: sumDone
        };
      } else {
        pullProgress = {
          status: evtStatus,
          model: modelName,
          percent: pullProgress.percent,
          total: pullProgress.total,
          completed: pullProgress.completed
        };
      }
      emitPullProgress(pullProgress);
    }

    console.log('[Ollama] Model "%s" pulled successfully', modelName);
    modelReady = true;
    pullInProgress = false;
    pullProgress = { status: 'ready', model: modelName, percent: 100, total: 0, completed: 0 };
    emitPullProgress(pullProgress);
    emitStatus();
    showInstallNotification('Model downloaded — your AI assistant is ready!');
    return { success: true };
  } catch (err) {
    console.error('[Ollama] Pull failed:', err.message);
    pullInProgress = false;
    pullProgress = { status: 'error', model: modelName, percent: 0, total: 0, completed: 0, error: err.message };
    emitPullProgress(pullProgress);
    return { success: false, error: err.message };
  }
}

/**
 * Check if the required model is available on the running server.
 * Does NOT auto-pull — returns the result so the UI can prompt.
 */
async function checkModel() {
  if (!client) return false;

  var modelName = getOllamaModel();
  try {
    var models = await client.list();
    var found = (models.models || []).some(function (m) {
      return m.name === modelName || m.name === modelName + ':latest';
    });
    if (found) {
      modelReady = true;
      pullProgress = { status: 'ready', percent: 100, total: 0, completed: 0 };
    }
    return found;
  } catch (err) {
    console.warn('[Ollama] Failed to check model:', err.message);
    return false;
  }
}

/**
 * Stop the managed Ollama process and reset all state.
 * Sends SIGTERM first, then SIGKILL after a timeout.
 */
async function stopOllama() {
  if (ollamaProcess) {
    console.log('[Ollama] Stopping managed process (pid=%d)...', ollamaProcess.pid);
    try {
      ollamaProcess.kill('SIGTERM');
    } catch (_) {}

    // Give it 3s to exit gracefully, then force kill
    await new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        if (ollamaProcess) {
          try {
            ollamaProcess.kill('SIGKILL');
            console.log('[Ollama] Sent SIGKILL after timeout');
          } catch (_) {}
        }
        resolve();
      }, 3000);

      if (ollamaProcess) {
        ollamaProcess.on('exit', function () {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });
    ollamaProcess = null;
  }

  managedHost = null;
  serverRunning = false;
  client = null;
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
 * List models available on the Ollama server.
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
  var models = await listModels();
  var currentModel = getOllamaModel();

  // Update modelReady from the fresh model list so we detect
  // models downloaded externally (e.g. via `ollama pull` in terminal)
  if (!modelReady && models.length > 0) {
    var found = models.some(function (m) {
      return m.name === currentModel || m.name === currentModel + ':latest';
    });
    if (found) {
      modelReady = true;
      pullProgress = { status: 'ready', percent: 100, total: 0, completed: 0 };
    }
  }

  return {
    installed: ollamaInstalled,
    running: serverRunning,
    host: managedHost || getOllamaUrl() || DEFAULT_HOST,
    error: startupError,
    models: models.map(function (m) {
      return {
        name: m.name,
        size: m.size,
        modified: m.modified_at
      };
    }),
    currentModel: currentModel,
    modelReady: modelReady,
    pulling: pullInProgress,
    pullProgress: pullProgress,
    installing: installInProgress,
    installProgress: installProgress
  };
}

/**
 * Get the Ollama JS client (for use by other modules like animation).
 */
function getClient() {
  return client;
}

function setOnInstallComplete(fn) {
  onInstallComplete = fn;
}

module.exports = {
  startOllama,
  stopOllama,
  installOllama,
  pullModel,
  checkModel,
  isReady,
  getStatus,
  getPullProgress,
  getClient,
  setOnInstallComplete
};
