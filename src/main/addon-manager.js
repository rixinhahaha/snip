/**
 * Add-on manager — handles optional AI feature installation.
 *
 * Three add-ons: segment, upscale, smart-search.
 * All share a runtime (transformers.js + onnxruntime-node) downloaded once.
 * Each add-on has its own HuggingFace model downloaded on install.
 *
 * Storage: ~/Library/Application Support/snip/addons/
 *   runtime/node_modules/   — shared AI runtime
 *   models/Xenova/...       — downloaded model files
 *   addons.json             — installed state
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const { execFile, execFileSync, fork } = require('child_process');
const { promisify } = require('util');
var execFileAsync = promisify(execFile);
const { findNodeBinary } = require('./node-binary');

// ── Add-on definitions ──

const ADDON_DEFS = {
  segment: {
    displayName: 'Segment',
    description: 'AI object segmentation — select and cut out objects from your snips.',
    modelId: 'Xenova/slimsam-77-uniform',
    modelSize: '38 MB',
    modelBytes: 38 * 1024 * 1024,
    modelType: 'sam'
  },
  upscale: {
    displayName: 'Upscale',
    description: '2x image upscaling using AI super-resolution.',
    modelId: 'Xenova/swin2SR-lightweight-x2-64',
    modelSize: '8 MB',
    modelBytes: 8 * 1024 * 1024,
    modelType: 'pipeline'
  },
  'smart-search': {
    displayName: 'Smart Search',
    description: 'AI-powered semantic search across your snip library.',
    modelId: 'Xenova/all-MiniLM-L6-v2',
    modelSize: '97 MB',
    modelBytes: 97 * 1024 * 1024,
    modelType: 'pipeline'
  }
};

// GitHub release asset URL for the shared AI runtime (platform-specific)
var RUNTIME_ASSET_NAME = 'snip-ai-runtime-' + process.platform + '-' + process.arch + '.tar.gz';

function getRuntimeDownloadUrl() {
  var owner = 'rixinhahaha';
  var repo = 'snip';
  // Pin to the app's own version — each release ships a matching runtime tarball.
  var version;
  try {
    version = require('electron').app.getVersion();
  } catch (_) {
    version = require('../../package.json').version;
  }
  return 'https://github.com/' + owner + '/' + repo + '/releases/download/v' + version + '/' + RUNTIME_ASSET_NAME;
}

// ── Paths ──

function getAddonsDir() {
  try {
    var app = require('electron').app;
    return path.join(app.getPath('userData'), 'addons');
  } catch (_) {
    // Fallback for test environment or when app is not ready
    return path.join(process.env.HOME || '/tmp', '.snip-addons');
  }
}

function getRuntimeDir() {
  return path.join(getAddonsDir(), 'runtime');
}

function getRuntimeNodeModules() {
  return path.join(getRuntimeDir(), 'node_modules');
}

function getModelsDir() {
  return path.join(getAddonsDir(), 'models');
}

function getStateFilePath() {
  return path.join(getAddonsDir(), 'addons.json');
}

// ── State persistence ──

function readState() {
  try {
    return JSON.parse(fs.readFileSync(getStateFilePath(), 'utf8'));
  } catch (_) {
    return { runtime: false, addons: {} };
  }
}

function writeState(state) {
  var dir = getAddonsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getStateFilePath(), JSON.stringify(state, null, 2));
}

// ── Status queries ──

function isRuntimeInstalled() {
  var nmDir = getRuntimeNodeModules();
  try {
    var pkgPath = path.join(nmDir, '@huggingface', 'transformers', 'package.json');
    return fs.existsSync(pkgPath);
  } catch (_) {
    return false;
  }
}

function isModelInstalled(addonName) {
  var def = ADDON_DEFS[addonName];
  if (!def) return false;
  var modelDir = path.join(getModelsDir(), def.modelId, 'onnx');
  try {
    var entries = fs.readdirSync(modelDir);
    return entries.some(function (f) { return f.endsWith('.onnx'); });
  } catch (_) {
    return false;
  }
}

function isAddonInstalled(addonName) {
  return isRuntimeInstalled() && isModelInstalled(addonName);
}

/**
 * Get status of all add-ons.
 * Returns { runtime: bool, addons: { [name]: { installed, displayName, description, modelSize } } }
 */
function getStatus() {
  var runtimeOk = isRuntimeInstalled();
  var addons = {};
  for (var name in ADDON_DEFS) {
    var def = ADDON_DEFS[name];
    addons[name] = {
      installed: runtimeOk && isModelInstalled(name),
      displayName: def.displayName,
      description: def.description,
      modelSize: def.modelSize
    };
  }
  return { runtime: runtimeOk, addons: addons };
}

// ── Download helpers ──

var activeDownloads = new Map(); // addonName → AbortController
var runtimeInstallPromise = null; // mutex for concurrent runtime installs

var MAX_REDIRECTS = 5;

/**
 * Download a file via HTTPS with progress. Follows HTTPS-only redirects.
 * Returns a Promise that resolves when file is written.
 */
function downloadFile(url, destPath, onProgress, signal, _redirectCount) {
  var redirectCount = _redirectCount || 0;
  return new Promise(function (resolve, reject) {
    if (signal && signal.aborted) return reject(new Error('Cancelled'));

    if (!url.startsWith('https:')) {
      return reject(new Error('Refusing non-HTTPS download URL: ' + url));
    }

    var req = https.get(url, { headers: { 'User-Agent': 'Snip' } }, function (res) {
      // Follow HTTPS-only redirects (GitHub releases redirect to S3)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        if (redirectCount >= MAX_REDIRECTS) {
          return reject(new Error('Too many redirects'));
        }
        var location = res.headers.location;
        if (!location.startsWith('https:')) {
          return reject(new Error('Refusing non-HTTPS redirect to: ' + location));
        }
        downloadFile(location, destPath, onProgress, signal, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.destroy();
        reject(new Error('Download failed: HTTP ' + res.statusCode));
        return;
      }

      var totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      var receivedBytes = 0;

      var dir = path.dirname(destPath);
      fs.mkdirSync(dir, { recursive: true });
      var fileStream = fs.createWriteStream(destPath);

      if (signal) {
        signal.addEventListener('abort', function () {
          res.destroy();
          fileStream.destroy();
          try { fs.unlinkSync(destPath); } catch (_) {}
          reject(new Error('Cancelled'));
        }, { once: true });
      }

      res.on('data', function (chunk) {
        receivedBytes += chunk.length;
        if (onProgress && totalBytes > 0) {
          onProgress({ received: receivedBytes, total: totalBytes, percent: Math.round(receivedBytes / totalBytes * 100) });
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', function () {
        fileStream.close();
        resolve();
      });
      fileStream.on('error', reject);
    });

    req.on('error', reject);
  });
}

// ── Runtime install ──

/**
 * Download and extract the shared AI runtime.
 * @param {function} onProgress - ({ phase, received, total, percent })
 * @param {AbortSignal} signal
 */
async function installRuntime(onProgress, signal) {
  if (isRuntimeInstalled()) return;

  var addonsDir = getAddonsDir();
  fs.mkdirSync(addonsDir, { recursive: true });

  var tarPath = path.join(addonsDir, RUNTIME_ASSET_NAME);
  var url = getRuntimeDownloadUrl();

  console.log('[Addons] Downloading AI runtime from: ' + url);

  await downloadFile(url, tarPath, function (p) {
    if (onProgress) onProgress({ phase: 'runtime', received: p.received, total: p.total, percent: p.percent });
  }, signal);

  if (signal && signal.aborted) return;

  // Validate tarball: check for path traversal (Zip Slip)
  console.log('[Addons] Validating tarball...');
  var listResult = await execFileAsync('tar', ['tzf', tarPath], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  var entries = listResult.stdout.split('\n').filter(Boolean);
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].startsWith('/') || entries[i].includes('..')) {
      try { fs.unlinkSync(tarPath); } catch (_) {}
      throw new Error('Tarball contains unsafe path: ' + entries[i]);
    }
  }

  // Extract tarball (async to avoid blocking main thread)
  console.log('[Addons] Extracting runtime...');
  if (onProgress) onProgress({ phase: 'runtime-extract', percent: 0 });

  var runtimeDir = getRuntimeDir();
  fs.mkdirSync(runtimeDir, { recursive: true });

  await execFileAsync('tar', ['xzf', tarPath, '-C', runtimeDir]);

  // Clean up tarball
  try { fs.unlinkSync(tarPath); } catch (_) {}

  // Verify
  if (!isRuntimeInstalled()) {
    throw new Error('Runtime extraction failed — transformers package not found');
  }

  console.log('[Addons] AI runtime installed');
}

// ── Model install ──

/**
 * Download a model using transformers.js from the addon runtime.
 * Forks a helper script that loads transformers.js from the addon runtime dir
 * and downloads the model to addons/models/.
 *
 * @param {string} addonName
 * @param {function} onProgress - ({ phase, percent, file, loaded, total })
 * @param {AbortSignal} signal
 */
async function installModel(addonName, onProgress, signal) {
  var def = ADDON_DEFS[addonName];
  if (!def) throw new Error('Unknown addon: ' + addonName);

  if (isModelInstalled(addonName)) return;

  if (!isRuntimeInstalled()) {
    throw new Error('Runtime must be installed before downloading models');
  }

  var modelsDir = getModelsDir();
  fs.mkdirSync(modelsDir, { recursive: true });

  // Use the model-downloader helper script
  var helperScript = path.join(__dirname, 'addon-model-downloader.js');
  // Worker scripts need to be unpacked from asar
  if (helperScript.includes('app.asar')) {
    helperScript = helperScript.replace('app.asar', 'app.asar.unpacked');
  }

  var nodeBin = findNodeBinary();
  var childEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_PATH: getRuntimeNodeModules(),
    SNIP_ADDON_MODELS_PATH: modelsDir,
    SNIP_MODEL_ID: def.modelId,
    SNIP_MODEL_TYPE: def.modelType
  };

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

  return new Promise(function (resolve, reject) {
    if (signal && signal.aborted) return reject(new Error('Cancelled'));

    var child = fork(helperScript, [], forkOptions);

    if (signal) {
      signal.addEventListener('abort', function () {
        child.kill();
        reject(new Error('Cancelled'));
      }, { once: true });
    }

    child.on('message', function (msg) {
      if (msg.type === 'progress' && onProgress) {
        onProgress({ phase: 'model', percent: msg.percent || 0, file: msg.file, loaded: msg.loaded, total: msg.total });
      }
      if (msg.type === 'done') {
        resolve();
      }
      if (msg.type === 'error') {
        reject(new Error(msg.error));
      }
    });

    child.on('exit', function (code) {
      if (code !== 0) {
        reject(new Error('Model download failed (exit code ' + code + ')'));
      }
    });

    child.on('error', reject);
  });
}

// ── Public API ──

/**
 * Install an add-on. Downloads runtime (if needed) then model.
 * @param {string} addonName
 * @param {function} onProgress - ({ phase, percent, ... })
 * @returns {Promise<void>}
 */
async function installAddon(addonName, onProgress) {
  if (!ADDON_DEFS[addonName]) throw new Error('Unknown addon: ' + addonName);

  // Guard against double-click / concurrent install of the same addon
  if (activeDownloads.has(addonName)) {
    throw new Error('Install already in progress for ' + addonName);
  }

  var controller = new AbortController();
  activeDownloads.set(addonName, controller);
  var signal = controller.signal;

  try {
    // Step 1: Runtime (if needed) — mutex prevents concurrent runtime downloads
    if (!isRuntimeInstalled()) {
      if (!runtimeInstallPromise) {
        runtimeInstallPromise = installRuntime(onProgress, signal).finally(function () {
          runtimeInstallPromise = null;
        });
      }
      await runtimeInstallPromise;
    }

    // Step 2: Model
    await installModel(addonName, onProgress, signal);

    // Step 3: Update state (atomic read-modify-write)
    updateAddonState(addonName, true);

    console.log('[Addons] Installed: ' + addonName);
  } finally {
    activeDownloads.delete(addonName);
  }
}

/**
 * Atomically update a single addon's installed state.
 */
function updateAddonState(addonName, installed) {
  var state = readState();
  state.runtime = isRuntimeInstalled();
  if (!state.addons) state.addons = {};
  if (installed) {
    state.addons[addonName] = { installed: true, installedAt: new Date().toISOString() };
  } else {
    delete state.addons[addonName];
  }
  writeState(state);
}

/**
 * Cancel an in-progress download.
 */
function cancelDownload(addonName) {
  var controller = activeDownloads.get(addonName);
  if (controller) {
    controller.abort();
    activeDownloads.delete(addonName);
  }
}

/**
 * Remove an add-on (deletes its model files).
 */
function removeAddon(addonName) {
  var def = ADDON_DEFS[addonName];
  if (!def) return;

  var modelDir = path.join(getModelsDir(), def.modelId);
  if (fs.existsSync(modelDir)) {
    fs.rmSync(modelDir, { recursive: true, force: true });
    console.log('[Addons] Removed model: ' + def.modelId);
  }

  updateAddonState(addonName, false);

  // If no addons remain, optionally clean up runtime
  var state = readState();
  var anyInstalled = Object.keys(state.addons || {}).length > 0;
  if (!anyInstalled) {
    var runtimeDir = getRuntimeDir();
    if (fs.existsSync(runtimeDir)) {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
      state.runtime = false;
      writeState(state);
      console.log('[Addons] Removed shared runtime (no addons left)');
    }
  }
}

/**
 * Migrate models from old bundled location to addons directory.
 * Called on first launch after update.
 */
function migrateFromBundled() {
  // Check if there are models at the old bundled location
  var oldModelsDir = null;
  if (process.resourcesPath) {
    oldModelsDir = path.join(process.resourcesPath, 'models');
  }
  if (!oldModelsDir || !fs.existsSync(oldModelsDir)) return;

  var newModelsDir = getModelsDir();
  if (fs.existsSync(newModelsDir)) {
    // Already migrated
    var entries = [];
    try { entries = fs.readdirSync(newModelsDir); } catch (_) {}
    if (entries.length > 0) return;
  }

  console.log('[Addons] Migrating bundled models to addons directory...');

  try {
    // Copy models (can't move from read-only Resources/)
    fs.mkdirSync(newModelsDir, { recursive: true });
    fs.cpSync(oldModelsDir, newModelsDir, { recursive: true });

    // Mark addons as installed if their models exist
    var state = readState();
    state.addons = state.addons || {};

    for (var name in ADDON_DEFS) {
      if (isModelInstalled(name)) {
        state.addons[name] = { installed: true, installedAt: new Date().toISOString(), migrated: true };
        console.log('[Addons] Migrated: ' + name);
      }
    }

    // Note: runtime still needs to be downloaded — bundled app had it in node_modules
    // but the new build won't. We mark runtime as false.
    state.runtime = isRuntimeInstalled();
    writeState(state);
  } catch (err) {
    console.warn('[Addons] Migration failed:', err.message);
  }
}

module.exports = {
  ADDON_DEFS,
  getAddonsDir,
  getRuntimeDir,
  getRuntimeNodeModules,
  getModelsDir,
  getStatus,
  isAddonInstalled,
  isRuntimeInstalled,
  isModelInstalled,
  installAddon,
  cancelDownload,
  removeAddon,
  migrateFromBundled
};
