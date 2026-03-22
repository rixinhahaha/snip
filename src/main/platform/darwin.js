/**
 * macOS platform implementations.
 *
 * Contains all darwin-specific code extracted from shared modules.
 * Electron is loaded lazily so this module can be required by the CLI
 * and MCP server which run as standalone Node.js scripts.
 */

var path = require('path');
var fs = require('fs');
var os = require('os');
var { spawn } = require('child_process');
var shared = require('./shared');

// Lazy Electron reference — null when running outside Electron (CLI, MCP)
var app = null;
try {
  app = require('electron').app;
} catch (_) {
  // Running outside Electron (CLI or MCP server context)
}

// ── Native addon (lazy-loaded, cached after first call) ──

var _windowUtils = undefined; // undefined = not yet loaded, null = failed to load

function getWindowUtils() {
  if (_windowUtils !== undefined) return _windowUtils;
  try {
    var packedPath = path.join(process.resourcesPath, 'native', 'window_utils.node');
    var devPath = path.join(__dirname, '..', '..', '..', 'build', 'Release', 'window_utils.node');
    _windowUtils = require(app && app.isPackaged ? packedPath : devPath);
  } catch (e) {
    console.warn('[Snip] Native window_utils addon not found — overlay may appear on wrong Space.', e.message);
    _windowUtils = null;
  }
  return _windowUtils;
}

// Eagerly warm the addon when running inside Electron so the first capture
// doesn't pay the dlopen cost (~50-200ms). Safe to call outside Electron
// (getWindowUtils returns null and caches that result).
if (app) {
  // Defer slightly so module loading completes first
  process.nextTick(getWindowUtils);
}

// ── Window management ──

function getWindowList(cursorDisplay) {
  var windowUtils = getWindowUtils();
  var windowList = [];
  if (windowUtils && windowUtils.getWindowList) {
    try {
      var size = cursorDisplay.size;
      var bounds = cursorDisplay.bounds;
      windowList = windowUtils.getWindowList(bounds.x, bounds.y, size.width, size.height);
      // Convert macOS global coords (bottom-left origin) to display-relative
      windowList = windowList.map(function (w) {
        return {
          x: w.x - bounds.x,
          y: w.y - bounds.y,
          width: w.width,
          height: w.height,
          owner: w.owner,
          name: w.name,
          pid: w.pid
        };
      });
    } catch (e) {
      console.warn('[Snip] Failed to get window list:', e.message);
    }
  }
  return windowList;
}

function setMoveToActiveSpace(overlayWindow) {
  var windowUtils = getWindowUtils();
  if (windowUtils) {
    try {
      var handle = overlayWindow.getNativeWindowHandle();
      windowUtils.setMoveToActiveSpace(handle);
    } catch (e) {
      console.warn('[Snip] Failed to set MoveToActiveSpace:', e.message);
    }
  }
}

// ── Window chrome ──

var WINDOW_OPTIONS = {
  home: { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 }, transparent: true, backgroundColor: '#00000000' },
  editor: { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 14 }, transparent: true, backgroundColor: '#00000000' }
};

function getWindowOptions(type) {
  return WINDOW_OPTIONS[type] || WINDOW_OPTIONS.editor;
}

function hideFromDock(electronApp) {
  if (electronApp.dock) {
    electronApp.dock.hide();
  }
}

// ── Ollama ──

function getOllamaConfig() {
  return {
    knownPaths: ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama'],
    appPath: '/Applications/Ollama.app',
    appBinary: '/Applications/Ollama.app/Contents/Resources/ollama'
  };
}

/**
 * Download and install Ollama on macOS.
 * @param {Object} callbacks
 * @param {Function} callbacks.onProgress - called with { status, percent }
 * @param {Function} callbacks.onNotification - called with message string
 * @param {Function} callbacks.downloadFile - async (url, dest, onPercent) => void
 * @param {Function} callbacks.onInstalled - called after files installed (before server start)
 */
async function installOllama(callbacks) {
  if (!app) throw new Error('installOllama requires Electron context');
  var tmpDir = app.getPath('temp');
  var zipPath = path.join(tmpDir, 'Ollama-darwin.zip');
  var extractDir = path.join(tmpDir, 'Ollama-extract');
  var OLLAMA_APP_PATH = '/Applications/Ollama.app';

  await callbacks.downloadFile('https://ollama.com/download/Ollama-darwin.zip', zipPath, function (percent) {
    var scaled = Math.round(percent * 0.85);
    callbacks.onProgress({ status: 'downloading', percent: scaled });
  });

  callbacks.onNotification('Ollama downloaded — unpacking...');
  callbacks.onProgress({ status: 'extracting', percent: 87 });

  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(extractDir, { recursive: true });

  await new Promise(function (resolve, reject) {
    var child = spawn('unzip', ['-o', '-q', zipPath, '-d', extractDir], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', function (code) {
      if (code === 0) resolve();
      else reject(new Error('unzip exited with code ' + code));
    });
  });

  var extractedApp = path.join(extractDir, 'Ollama.app');
  if (!fs.existsSync(extractedApp)) {
    throw new Error('Ollama.app not found in downloaded archive');
  }

  callbacks.onNotification('Ollama unpacked — installing...');
  callbacks.onProgress({ status: 'installing', percent: 92 });

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

  try { fs.unlinkSync(zipPath); } catch (_) {}
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (_) {}

  callbacks.onNotification('Ollama installed — launching...');
  callbacks.onProgress({ status: 'launching', percent: 96 });

  callbacks.onInstalled();
}

// ── Node.js binary ──

function getNodeBinaryName() {
  return 'node';
}

function getNodeSearchPaths() {
  return ['/usr/local/bin', '/opt/homebrew/bin'];
}

// ── IPC / Socket ──

function getSocketPath() {
  return path.join(os.homedir(), 'Library', 'Application Support', 'snip', 'snip.sock');
}

// ── App launch ──

function launchApp() {
  if (fs.existsSync('/Applications/Snip.app')) {
    require('child_process').execFile('open', ['-a', 'Snip']);
    return true;
  }
  return false;
}

// ── Capabilities ──

function canTranscribe() {
  return true;
}

// ── Tray ──

function getTrayIcon() {
  return { file: 'tray-iconTemplate.png', resize: false };
}

module.exports = {
  getOllamaConfig,
  installOllama,
  killProcess: shared.killProcess,
  getWindowList,
  setMoveToActiveSpace,
  getWindowOptions,
  hideFromDock,
  getNodeBinaryName,
  getNodeSearchPaths,
  getSocketPath,
  pollForSocket: shared.pollForSocket,
  launchApp,
  canTranscribe,
  getCliInstallPaths: shared.getCliInstallPaths,
  getCliWrapperContent: shared.getCliWrapperContent,
  getTrayIcon,
  getShortcutMode: function () { return 'native'; },
  installCompositorShortcut: function () { throw new Error('Compositor shortcuts not supported on macOS'); },
  removeCompositorShortcut: function () {},
  checkCompositorShortcut: function () { return { installed: false, binding: null }; },
  shouldStealFocusOnCapture: function () { return false; },
  getBlurCancelDelay: function () { return 0; },
  copyImageToClipboard: function (nativeImage, clipboard) { clipboard.writeImage(nativeImage); },
  checkDependencies: function () { return { wayland: false, wlCopy: true, python3Gi: true }; }
};
