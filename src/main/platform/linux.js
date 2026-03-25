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

// ── Compositor shortcuts (Wayland/GNOME) ──

var GSETTINGS_BASE = 'org.gnome.settings-daemon.plugins.media-keys';
var GSETTINGS_BINDING_PATH = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings';
var SNIP_SLOT_PREFIX = 'snip-';
var VALID_ACTIONS = ['capture', 'search'];
var DISPLAY_NAMES = { 'capture': 'Snip and Annotate', 'search': 'Search snips' };
var CLI_COMMANDS = { 'capture': 'snip capture', 'search': 'snip show-search' };

function validateAction(action) {
  if (VALID_ACTIONS.indexOf(action) === -1) {
    throw new Error('Invalid shortcut action: ' + action);
  }
}

function getShortcutMode() {
  if (process.env.XDG_SESSION_TYPE !== 'wayland') return 'native';
  // Only use compositor shortcuts on GNOME (gsettings-based). KDE/Sway/etc.
  // don't support this, so fall back to native (Electron globalShortcut may
  // still fail, but it's the best we can do).
  try {
    require('child_process').execFileSync('gsettings', ['list-schemas'], { stdio: 'pipe', timeout: 3000 });
    return 'compositor';
  } catch (_) {
    return 'native';
  }
}

function electronToGnomeBinding(accel) {
  return accel
    .replace(/CommandOrControl\+/g, '<Ctrl>')
    .replace(/CmdOrCtrl\+/g, '<Ctrl>')
    .replace(/Shift\+/g, '<Shift>')
    .replace(/Alt\+/g, '<Alt>')
    .replace(/\+/g, '');
}

function slotsToGVariant(slots) {
  if (slots.length === 0) return '@as []';
  return '[' + slots.map(function (s) { return "'" + s + "'"; }).join(', ') + ']';
}

// Async gsettings helpers (don't block the main thread)
var { execFile: execFileCb } = require('child_process');
var { promisify } = require('util');
var execFileAsync = promisify(execFileCb);

async function gsettingsGet(key) {
  try {
    var { stdout } = await execFileAsync('gsettings', ['get', GSETTINGS_BASE, key]);
    return stdout.trim();
  } catch (_) { return null; }
}

async function gsettingsGetBinding(slotPath, key) {
  try {
    var { stdout } = await execFileAsync('gsettings', ['get', GSETTINGS_BASE + '.custom-keybinding:' + slotPath, key]);
    return stdout.trim().replace(/^'|'$/g, '');
  } catch (_) { return ''; }
}

async function gsettingsSet(args) {
  await execFileAsync('gsettings', ['set'].concat(args));
}

async function gsettingsSetBinding(slotPath, key, value) {
  await gsettingsSet([GSETTINGS_BASE + '.custom-keybinding:' + slotPath, key, value]);
}

async function parseCustomKeybindings() {
  var raw = await gsettingsGet('custom-keybindings');
  if (!raw || raw === '@as []') return [];
  var matches = raw.match(/'([^']+)'/g);
  if (!matches) return [];
  return matches.map(function (m) { return m.replace(/'/g, ''); });
}

async function findSnipSlot(action) {
  var slotName = SNIP_SLOT_PREFIX + action;
  var slots = await parseCustomKeybindings();
  for (var i = 0; i < slots.length; i++) {
    if (slots[i].indexOf(slotName) !== -1) return slots[i];
  }
  return null;
}

async function installCompositorShortcut(action, electronAccel) {
  validateAction(action);
  var slotName = SNIP_SLOT_PREFIX + action;
  var slotPath = GSETTINGS_BINDING_PATH + '/' + slotName + '/';
  var gnomeBinding = electronToGnomeBinding(electronAccel);

  // Update gsettings: add slot to list if not present
  var slots = await parseCustomKeybindings();
  if (slots.indexOf(slotPath) === -1) {
    slots.push(slotPath);
    await gsettingsSet([GSETTINGS_BASE, 'custom-keybindings', slotsToGVariant(slots)]);
  }

  // Set the binding properties — command is the Snip CLI
  await gsettingsSetBinding(slotPath, 'name', DISPLAY_NAMES[action] || 'Snip');
  await gsettingsSetBinding(slotPath, 'command', CLI_COMMANDS[action]);
  await gsettingsSetBinding(slotPath, 'binding', gnomeBinding);

  return { installed: true, binding: gnomeBinding };
}

async function removeCompositorShortcut(action) {
  validateAction(action);
  var slotName = SNIP_SLOT_PREFIX + action;
  var slotPath = GSETTINGS_BINDING_PATH + '/' + slotName + '/';

  var slots = (await parseCustomKeybindings()).filter(function (s) { return s !== slotPath; });
  try { await gsettingsSet([GSETTINGS_BASE, 'custom-keybindings', slotsToGVariant(slots)]); } catch (_) {}
  try { await gsettingsSetBinding(slotPath, 'name', ''); } catch (_) {}
  try { await gsettingsSetBinding(slotPath, 'command', ''); } catch (_) {}
  try { await gsettingsSetBinding(slotPath, 'binding', ''); } catch (_) {}
}

async function checkCompositorShortcut(action) {
  validateAction(action);
  var slot = await findSnipSlot(action);
  if (!slot) return { installed: false, binding: null };
  var binding = await gsettingsGetBinding(slot, 'binding');
  return { installed: !!binding, binding: binding || null };
}

// ── Capture behavior ──

function shouldStealFocusOnCapture() { return true; }
function getBlurCancelDelay() { return 300; }

// ── Clipboard ──

function copyImageToClipboard(nativeImage, clipboard) {
  // On Wayland, Electron's clipboard dies when the window closes.
  // Use wl-copy or xclip to persist the clipboard independently.
  var pngBuf = nativeImage.toPNG();
  var tools = [
    { cmd: 'wl-copy', args: ['--type', 'image/png'] },
    { cmd: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-i'] }
  ];
  for (var i = 0; i < tools.length; i++) {
    try {
      require('child_process').execFileSync('which', [tools[i].cmd], { stdio: 'pipe' });
      var proc = require('child_process').spawn(tools[i].cmd, tools[i].args, { stdio: ['pipe', 'pipe', 'pipe'] });
      proc.on('error', function () {});
      proc.stdin.write(pngBuf);
      proc.stdin.end();
      return;
    } catch (_) {}
  }
  // Fallback to Electron clipboard (may not persist after window close on Wayland)
  clipboard.writeImage(nativeImage);
}

// ── Dependency check ──

function checkDependencies() {
  var wayland = process.env.XDG_SESSION_TYPE === 'wayland';
  var { execFileSync } = require('child_process');
  var wlCopy = false;
  try { execFileSync('which', ['wl-copy'], { stdio: 'pipe' }); wlCopy = true; } catch (_) {}
  var python3Gi = false;
  try { execFileSync('python3', ['-c', 'import gi'], { stdio: 'pipe', timeout: 5000 }); python3Gi = true; } catch (_) {}
  var distro = 'unknown';
  try {
    var fs = require('fs');
    var osRelease = fs.readFileSync('/etc/os-release', 'utf8');
    if (/ID_LIKE=.*debian|ID=ubuntu|ID=debian/i.test(osRelease)) distro = 'debian';
    else if (/ID_LIKE=.*fedora|ID=fedora|ID_LIKE=.*rhel/i.test(osRelease)) distro = 'fedora';
    else if (/ID=arch|ID_LIKE=.*arch/i.test(osRelease)) distro = 'arch';
  } catch (_) {}
  return { wayland: wayland, wlCopy: wlCopy, python3Gi: python3Gi, distro: distro };
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
  requestScreenCaptureAccess: function () { return false; },
  getCliInstallPaths: shared.getCliInstallPaths,
  getCliWrapperContent: shared.getCliWrapperContent,
  getTrayIcon,
  shouldStealFocusOnCapture,
  getBlurCancelDelay,
  copyImageToClipboard,
  checkDependencies,
  getShortcutMode,
  installCompositorShortcut,
  removeCompositorShortcut,
  checkCompositorShortcut
};
