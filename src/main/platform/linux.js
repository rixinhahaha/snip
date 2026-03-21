/**
 * Linux platform implementations.
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
    knownPaths: ['/usr/local/bin/ollama', '/usr/bin/ollama', '/snap/bin/ollama'],
    appPath: null,
    appBinary: null
  };
}

async function installOllama() {
  throw new Error('Auto-install is not supported on Linux. Install Ollama with: curl -fsSL https://ollama.com/install.sh | sh');
}

// ── Node.js binary ──

function getNodeBinaryName() {
  return 'node';
}

function getNodeSearchPaths() {
  return ['/usr/bin', '/usr/local/bin', '/snap/bin'];
}

// ── IPC / Socket ──

function getSocketPath() {
  // XDG spec: runtime files (sockets, PIDs) go in $XDG_RUNTIME_DIR (tmpfs, cleared on logout)
  var runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir) return path.join(runtimeDir, 'snip', 'snip.sock');
  return path.join(os.homedir(), '.config', 'snip', 'snip.sock');
}

// ── App launch ──

function launchApp() {
  return false;
}

// ── Capabilities ──

function canTranscribe() {
  return false;
}

// ── Tray ──

function getTrayIcon() {
  return { file: 'icon.png', resize: 22 };
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
  getTrayIcon
};
