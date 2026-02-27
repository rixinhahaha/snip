const { globalShortcut } = require('electron');

function registerShortcuts(captureCallback, searchCallback) {
  const captureRegistered = globalShortcut.register('CommandOrControl+Shift+2', () => {
    captureCallback().catch((err) => {
      console.error('[Snip] Capture shortcut error:', err);
    });
  });

  if (!captureRegistered) {
    console.error('[Snip] Failed to register capture shortcut (Cmd+Shift+2)');
  }

  const searchRegistered = globalShortcut.register('CommandOrControl+Shift+F', () => {
    searchCallback();
  });

  if (!searchRegistered) {
    console.error('[Snip] Failed to register search shortcut (Cmd+Shift+F)');
  }
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}

module.exports = { registerShortcuts, unregisterShortcuts };
