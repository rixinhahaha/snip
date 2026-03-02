/**
 * Ollama lifecycle manager.
 *
 * Detects system Ollama (running or installed), auto-starts if needed,
 * and prompts the user to install if missing. Never bundles a binary.
 */

const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { Ollama } = require('ollama');
const https = require('https');

const { getOllamaModel, getOllamaUrl } = require('./store');

let client = null;
let serverRunning = false;
let startupError = null;
let ollamaInstalled = false;

// Model pull state
let pullInProgress = false;
let pullProgress = { status: 'idle', percent: 0, total: 0, completed: 0 };
let modelReady = false;

// Install state
let installInProgress = false;
let installProgress = { status: 'idle', percent: 0 };

// Known install paths for macOS (packaged apps don't inherit shell PATH)
var KNOWN_PATHS = [
  '/usr/local/bin/ollama',
  '/opt/homebrew/bin/ollama'
];

var OLLAMA_APP_PATH = '/Applications/Ollama.app';
var DEFAULT_HOST = 'http://127.0.0.1:11434';

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
 * Send install progress to all open BrowserWindows.
 */
function emitInstallProgress(progress) {
  var { BrowserWindow } = require('electron');
  var wins = BrowserWindow.getAllWindows();
  for (var i = 0; i < wins.length; i++) {
    if (!wins[i].isDestroyed()) {
      try {
        wins[i].webContents.send('ollama-install-progress', progress);
      } catch (_) { /* ignore destroyed windows */ }
    }
  }
}

/**
 * Emit the full Ollama status to all windows (used after state changes).
 */
async function emitStatus() {
  var status = await getStatus();
  var { BrowserWindow } = require('electron');
  var wins = BrowserWindow.getAllWindows();
  for (var i = 0; i < wins.length; i++) {
    if (!wins[i].isDestroyed()) {
      try {
        wins[i].webContents.send('ollama-status-changed', status);
      } catch (_) {}
    }
  }
}

/**
 * Check if Ollama is installed on the system.
 * Returns the path to the binary or app, or null if not found.
 */
function findOllamaInstall() {
  // Check for Ollama.app first (most common macOS install)
  if (fs.existsSync(OLLAMA_APP_PATH)) {
    return { type: 'app', path: OLLAMA_APP_PATH };
  }

  // Check known CLI paths
  for (var i = 0; i < KNOWN_PATHS.length; i++) {
    if (fs.existsSync(KNOWN_PATHS[i])) {
      return { type: 'cli', path: KNOWN_PATHS[i] };
    }
  }

  return null;
}

/**
 * Auto-start Ollama if installed but not running.
 */
function autoStartOllama(install) {
  return new Promise(function (resolve, reject) {
    if (install.type === 'app') {
      // open -a Ollama launches the menu bar app
      var child = spawn('open', ['-a', 'Ollama'], { stdio: 'ignore', detached: true });
      child.unref();
      child.on('error', function (err) {
        reject(new Error('Failed to launch Ollama.app: ' + err.message));
      });
      child.on('close', function () {
        resolve();
      });
    } else {
      // CLI binary — spawn ollama serve in background
      var child = spawn(install.path, ['serve'], {
        stdio: 'ignore',
        detached: true
      });
      child.unref();
      child.on('error', function (err) {
        reject(new Error('Failed to start ollama serve: ' + err.message));
      });
      // Give it a moment to start
      setTimeout(resolve, 500);
    }
  });
}

/**
 * Start Ollama by detecting system install.
 * 1. Check if already running
 * 2. Check if installed → auto-start
 * 3. If not installed → set status, let UI prompt user
 */
async function startOllama() {
  var host = getOllamaUrl() || DEFAULT_HOST;

  // Step 1: Check if Ollama is already running
  var running = await checkServer(host);
  if (running) {
    console.log('[Ollama] Server already running at %s', host);
    serverRunning = true;
    ollamaInstalled = true;
    startupError = null;
    client = new Ollama({ host: host });
    emitStatus();
    return;
  }

  // Step 2: Check if installed
  var install = findOllamaInstall();
  if (install) {
    ollamaInstalled = true;
    console.log('[Ollama] Found install: %s (%s)', install.path, install.type);

    try {
      await autoStartOllama(install);
      await waitForServer(host, 30000);
      serverRunning = true;
      startupError = null;
      client = new Ollama({ host: host });
      console.log('[Ollama] Server started and connected at %s', host);
      emitStatus();
    } catch (err) {
      startupError = err.message;
      console.error('[Ollama] Auto-start failed:', err.message);
      emitStatus();
    }
    return;
  }

  // Step 3: Not installed
  ollamaInstalled = false;
  serverRunning = false;
  startupError = 'not_installed';
  console.log('[Ollama] Not installed — waiting for user to install');
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
  installProgress = { status: 'downloading', percent: 0 };
  emitInstallProgress(installProgress);

  var { app } = require('electron');
  var tmpDir = app.getPath('temp');
  var zipPath = path.join(tmpDir, 'Ollama-darwin.zip');
  var extractDir = path.join(tmpDir, 'Ollama-extract');

  try {
    // Download the zip
    await downloadFile('https://ollama.com/download/Ollama-darwin.zip', zipPath, function (percent) {
      installProgress = { status: 'downloading', percent: percent };
      emitInstallProgress(installProgress);
    });

    installProgress = { status: 'extracting', percent: 100 };
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

    installProgress = { status: 'installing', percent: 100 };
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

    // Launch it
    ollamaInstalled = true;
    installProgress = { status: 'launching', percent: 100 };
    emitInstallProgress(installProgress);

    await autoStartOllama({ type: 'app', path: OLLAMA_APP_PATH });

    var host = getOllamaUrl() || DEFAULT_HOST;
    await waitForServer(host, 30000);

    serverRunning = true;
    startupError = null;
    client = new Ollama({ host: host });

    installInProgress = false;
    installProgress = { status: 'done', percent: 100 };
    emitInstallProgress(installProgress);
    emitStatus();

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
  if (!client) {
    return { success: false, error: 'Ollama is not running' };
  }
  if (pullInProgress) {
    return { success: false, error: 'Pull already in progress' };
  }

  var modelName = getOllamaModel();
  console.log('[Ollama] Pulling model "%s"...', modelName);

  pullInProgress = true;
  pullProgress = { status: 'downloading', model: modelName, percent: 0, total: 0, completed: 0 };
  emitPullProgress(pullProgress);

  try {
    var stream = await client.pull({ model: modelName, stream: true });
    for await (var event of stream) {
      if (event.total && event.total > 0) {
        pullProgress = {
          status: event.status || 'downloading',
          model: modelName,
          percent: Math.round((event.completed / event.total) * 100),
          total: event.total,
          completed: event.completed
        };
      } else {
        pullProgress = {
          status: event.status || 'downloading',
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
 * Stop tracking (we no longer spawn our own process, but reset state).
 */
async function stopOllama() {
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
  return {
    installed: ollamaInstalled,
    running: serverRunning,
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

module.exports = {
  startOllama,
  stopOllama,
  installOllama,
  pullModel,
  checkModel,
  isReady,
  getStatus,
  getPullProgress,
  getClient
};
