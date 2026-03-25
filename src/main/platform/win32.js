/**
 * Windows platform implementations (stubs).
 *
 * Safe defaults for every function. Fill in for Phase 3.
 */

var path = require('path');
var os = require('os');
var shared = require('./shared');

// ── Window management ──

function getWindowList() {
  return [];
}

function setMoveToActiveSpace() {}

// ── Window chrome ──

function getWindowOptions() {
  return {};
}

function hideFromDock() {}

// ── Ollama ──

function getOllamaConfig() {
  return {
    knownPaths: [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'Ollama', 'ollama.exe')
    ],
    appPath: null,
    appBinary: null
  };
}

async function installOllama() {
  throw new Error('Auto-install is not supported on Windows. Download Ollama from https://ollama.com/download');
}

// ── Process management ──

function killProcess(proc) {
  return new Promise(function (resolve) {
    if (!proc) return resolve();
    try { proc.kill(); } catch (_) {}
    var timeout = setTimeout(function () { resolve(); }, 3000);
    proc.on('exit', function () {
      clearTimeout(timeout);
      resolve();
    });
  });
}

// ── Node.js binary ──

function getNodeBinaryName() {
  return 'node.exe';
}

function getNodeSearchPaths() {
  return [
    path.join('C:', 'Program Files', 'nodejs'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'nvm')
  ];
}

// ── IPC / Socket ──

function getSocketPath() {
  return '\\\\.\\pipe\\snip-socket';
}

// ── App launch ──

function launchApp() {
  return false;
}

// ── Capabilities ──

function canTranscribe() {
  return false;
}

// ── CLI install ──

function getCliInstallPaths() {
  return [];
}

function getCliWrapperContent() {
  return '';
}

// ── Tray ──

function getTrayIcon() {
  return { file: 'icon.png', resize: 22 };
}

module.exports = {
  getOllamaConfig,
  installOllama,
  killProcess,
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
  requestScreenCaptureAccess: function () { return false; },
  getCliInstallPaths,
  getCliWrapperContent,
  getTrayIcon,
  getShortcutMode: function () { return 'native'; },
  installCompositorShortcut: function () { throw new Error('Compositor shortcuts not supported on Windows'); },
  removeCompositorShortcut: function () {},
  checkCompositorShortcut: function () { return { installed: false, binding: null }; },
  shouldStealFocusOnCapture: function () { return false; },
  getBlurCancelDelay: function () { return 0; },
  copyImageToClipboard: function (nativeImage, clipboard) { clipboard.writeImage(nativeImage); },
  checkDependencies: function () { return { wayland: false, wlCopy: true, python3Gi: true }; }
};
