const { globalShortcut } = require('electron');
const { getShortcuts, getDefaultShortcuts } = require('./store');
const platform = require('./platform');

let captureCallback = null;
let searchCallback = null;
let quickSnipCallback = null;

function registerShortcuts(captureCb, searchCb, quickSnipCb) {
  captureCallback = captureCb;
  searchCallback = searchCb;
  quickSnipCallback = quickSnipCb;
  registerGlobalShortcuts();
}

function registerGlobalShortcuts() {
  const shortcuts = getShortcuts();
  const defaults = getDefaultShortcuts();
  const useCompositor = platform.getShortcutMode && platform.getShortcutMode() === 'compositor';

  if (useCompositor) {
    // On Wayland, Electron's globalShortcut can't grab keys.
    // Compositor shortcuts (capture, search) are registered via gsettings by the
    // onboarding flow or settings page — not here. They persist across reboots.
    // quick-snip has no CLI command, so try Electron's globalShortcut as best-effort.
    var quickSnipAccel = shortcuts['quick-snip'] || defaults['quick-snip'];
    try {
      globalShortcut.register(quickSnipAccel, function () {
        if (quickSnipCallback) quickSnipCallback().catch(function () {});
      });
    } catch (_) {}
    return;
  }

  var nativeCaptureAccel = shortcuts['capture'];
  try {
    const captureRegistered = globalShortcut.register(nativeCaptureAccel, () => {
      if (captureCallback) {
        captureCallback().catch((err) => {
          console.error('[Snip] Capture shortcut error:', err);
        });
      }
    });
    if (!captureRegistered) {
      console.error('[Snip] Failed to register capture shortcut (%s)', nativeCaptureAccel);
    }
  } catch (err) {
    console.error('[Snip] Invalid capture accelerator "%s", falling back to default', nativeCaptureAccel);
    try {
      globalShortcut.register(defaults['capture'], () => {
        if (captureCallback) captureCallback().catch(() => {});
      });
    } catch (fallbackErr) {
      console.error('[Snip] Failed to register default capture shortcut:', fallbackErr);
    }
  }

  var nativeSearchAccel = shortcuts['search'];
  try {
    const searchRegistered = globalShortcut.register(nativeSearchAccel, () => {
      if (searchCallback) searchCallback();
    });
    if (!searchRegistered) {
      console.error('[Snip] Failed to register search shortcut (%s)', nativeSearchAccel);
    }
  } catch (err) {
    console.error('[Snip] Invalid search accelerator "%s", falling back to default', nativeSearchAccel);
    try {
      globalShortcut.register(defaults['search'], () => {
        if (searchCallback) searchCallback();
      });
    } catch (fallbackErr) {
      console.error('[Snip] Failed to register default search shortcut:', fallbackErr);
    }
  }

  var nativeQuickSnipAccel = shortcuts['quick-snip'];
  try {
    const quickSnipRegistered = globalShortcut.register(nativeQuickSnipAccel, () => {
      if (quickSnipCallback) {
        quickSnipCallback().catch((err) => {
          console.error('[Snip] Quick snip shortcut error:', err);
        });
      }
    });
    if (!quickSnipRegistered) {
      console.error('[Snip] Failed to register quick snip shortcut (%s)', nativeQuickSnipAccel);
    }
  } catch (err) {
    console.error('[Snip] Invalid quick snip accelerator "%s", falling back to default', nativeQuickSnipAccel);
    try {
      globalShortcut.register(defaults['quick-snip'], () => {
        if (quickSnipCallback) quickSnipCallback().catch(() => {});
      });
    } catch (fallbackErr) {
      console.error('[Snip] Failed to register default quick snip shortcut:', fallbackErr);
    }
  }
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
  // Compositor shortcuts (gsettings) are managed by onboarding/settings — not here.
  // They persist across reboots and should not be removed on re-register.
}

function reregisterShortcuts() {
  unregisterShortcuts();
  registerGlobalShortcuts();
}

module.exports = { registerShortcuts, unregisterShortcuts, reregisterShortcuts };
