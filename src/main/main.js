const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const { registerShortcuts, unregisterShortcuts, reregisterShortcuts } = require('./shortcuts');
const { createTray, rebuildTrayMenu } = require('./tray');
const { registerIpcHandlers } = require('./ipc-handlers');
const { captureScreen } = require('./capturer');
const { initStore } = require('./store');
const { startWatcher } = require('./organizer/watcher');
const { startOllama, stopOllama, setOnInstallComplete } = require('./ollama-manager');
const { BASE_WEB_PREFERENCES } = require('./constants');

// Native Liquid Glass (macOS 26+) — safe no-op on older systems
let liquidGlass = null;
try {
  const lg = require('electron-liquid-glass');
  // isGlassSupported() checks macOS >= 26; _addon confirms the native binary loaded
  if (lg.isGlassSupported() && lg._addon) liquidGlass = lg;
} catch {
  // Not available — fall back to vibrancy
}
if (!liquidGlass) console.log('[Snip] Liquid glass not available — using vibrancy fallback');

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let overlayWindow = null;
let prewarmedOverlay = null;
let homeWindow = null;
let editorWindow = null;

const OVERLAY_WINDOW_OPTIONS = {
  width: 1,
  height: 1,
  x: -9999,
  y: -9999,
  frame: false,
  transparent: true,
  alwaysOnTop: false,
  fullscreenable: false,
  skipTaskbar: true,
  hasShadow: false,
  resizable: false,
  show: false,
  webPreferences: { ...BASE_WEB_PREFERENCES }
};

const OVERLAY_HTML = path.join(__dirname, '..', 'renderer', 'index.html');

/**
 * Pre-warm a hidden overlay window so it's ready instantly on next capture.
 * The window is created off-screen with show:false and loads index.html.
 */
function prewarmOverlay() {
  if (prewarmedOverlay && !prewarmedOverlay.isDestroyed()) return;

  try {
    prewarmedOverlay = new BrowserWindow(OVERLAY_WINDOW_OPTIONS);
    prewarmedOverlay.loadFile(OVERLAY_HTML);
    prewarmedOverlay.on('closed', () => { prewarmedOverlay = null; });
  } catch (e) {
    // App may be shutting down
    prewarmedOverlay = null;
  }
}

/**
 * Get or create an overlay window for capture.
 * Reuses the pre-warmed window if available (instant), otherwise creates fresh (slower).
 * Returns a Promise that resolves to the ready BrowserWindow.
 */
async function createOverlayWindow() {
  // Destroy old active overlay if it exists
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
    overlayWindow = null;
  }

  if (prewarmedOverlay && !prewarmedOverlay.isDestroyed()) {
    // Reuse pre-warmed window (already loaded — no wait needed)
    overlayWindow = prewarmedOverlay;
    prewarmedOverlay = null;
  } else {
    // Fallback: create fresh and wait for load
    overlayWindow = new BrowserWindow(OVERLAY_WINDOW_OPTIONS);
    overlayWindow.loadFile(OVERLAY_HTML);
    await new Promise(resolve => {
      overlayWindow.webContents.once('did-finish-load', resolve);
    });
  }

  // Re-prewarm after this overlay closes
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    prewarmOverlay();
  });

  return overlayWindow;
}

function getOverlayWindow() {
  return overlayWindow;
}

function createHomeWindow() {
  if (homeWindow && !homeWindow.isDestroyed()) {
    homeWindow.show();
    homeWindow.focus();
    return;
  }

  const homeOpts = {
    width: 900,
    height: 620,
    title: 'Snip',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { ...BASE_WEB_PREFERENCES }
  };

  // Use native vibrancy only if liquid glass is not available
  if (!liquidGlass) {
    homeOpts.vibrancy = 'under-window';
  }

  homeWindow = new BrowserWindow(homeOpts);
  homeWindow.loadFile(path.join(__dirname, '..', 'renderer', 'home.html'));
  // Apply native liquid glass if available, with vibrancy fallback
  if (liquidGlass) {
    homeWindow.setWindowButtonVisibility(true);
    homeWindow.webContents.once('did-finish-load', () => {
      try {
        var glassId = liquidGlass.addView(homeWindow.getNativeWindowHandle(), {
          cornerRadius: 12,
          tintColor: '#22000008'
        });
        if (glassId < 0) throw new Error('addView returned ' + glassId);
        console.log('[Snip] Liquid glass active on home window (id=' + glassId + ')');
      } catch (e) {
        console.warn('[Snip] Liquid glass failed for home window, falling back to vibrancy:', e.message);
        homeWindow.setVibrancy('under-window');
      }
    });
  }

  homeWindow.on('closed', () => {
    homeWindow = null;
  });
}

function createEditorWindow(cssWidth, cssHeight) {
  // Close existing editor if open
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.close();
    editorWindow = null;
  }

  const TOOLBAR_HEIGHT = 48;
  const MARGIN = 48; // breathing room around image
  const TOOLBAR_MIN_WIDTH = 1100; // wide enough for all toolbar controls + tag swatches + outline controls

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  const PANEL_CLEARANCE = 260; // space below image for animate preset panel
  const winWidth = Math.min(Math.max(cssWidth + MARGIN, TOOLBAR_MIN_WIDTH), screenW);
  const winHeight = Math.min(Math.max(cssHeight + TOOLBAR_HEIGHT + MARGIN, cssHeight + TOOLBAR_HEIGHT + PANEL_CLEARANCE, 500), screenH);
  const x = Math.round((screenW - winWidth) / 2);
  const y = Math.round((screenH - winHeight) / 2);

  const editorOpts = {
    width: winWidth,
    height: winHeight,
    x,
    y,
    frame: true,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
    webPreferences: { ...BASE_WEB_PREFERENCES }
  };

  if (!liquidGlass) {
    editorOpts.vibrancy = 'under-window';
  }

  editorWindow = new BrowserWindow(editorOpts);
  editorWindow.loadFile(path.join(__dirname, '..', 'renderer', 'editor.html'));

  // Apply native liquid glass if available, with vibrancy fallback
  if (liquidGlass) {
    editorWindow.setWindowButtonVisibility(true);
    editorWindow.webContents.once('did-finish-load', () => {
      try {
        var glassId = liquidGlass.addView(editorWindow.getNativeWindowHandle(), {
          cornerRadius: 12,
          tintColor: '#22000008'
        });
        if (glassId < 0) throw new Error('addView returned ' + glassId);
        console.log('[Snip] Liquid glass active on editor window (id=' + glassId + ')');
      } catch (e) {
        console.warn('[Snip] Liquid glass failed for editor window, falling back to vibrancy:', e.message);
        editorWindow.setVibrancy('under-window');
      }
    });
  }

  // Destroy overlay (will be recreated fresh next capture)
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
    overlayWindow = null;
  }

  editorWindow.on('closed', () => {
    editorWindow = null;
  });

  return editorWindow;
}

async function triggerCapture(opts) {
  // Don't start a new capture while the overlay is already active
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return;
  }

  // Don't start a new capture while the editor is open (unless quick-snip mode)
  var mode = (opts && opts.mode) || 'capture';
  if (mode !== 'quick-snip' && editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.focus();
    return;
  }

  // Hide home window so it doesn't appear behind the capture overlay
  if (homeWindow && !homeWindow.isDestroyed()) {
    homeWindow.hide();
  }

  try {
    await captureScreen(createOverlayWindow, getOverlayWindow, { mode });
  } catch (err) {
    console.error('[Snip] Capture failed:', err.message);
    // Permission errors show their own dialog from capturer.js —
    // only restore the home window for unexpected failures.
    if (!err.message.includes('permission') && !err.message.includes('Permission')) {
      showHomeWindow();
    }
  }
}

async function triggerQuickSnip() {
  return triggerCapture({ mode: 'quick-snip' });
}

function showHomeWindow() {
  createHomeWindow();
}

function sendToHomeWindow(channel) {
  if (homeWindow && !homeWindow.isDestroyed()) {
    if (homeWindow.webContents.isLoading()) {
      homeWindow.webContents.once('did-finish-load', () => {
        homeWindow.webContents.send(channel);
      });
    } else {
      homeWindow.webContents.send(channel);
    }
  }
}

function showSearchPage() {
  showHomeWindow();
  // Send IPC to switch to search page after window is ready
  if (homeWindow && !homeWindow.isDestroyed()) {
    if (homeWindow.webContents.isLoading()) {
      homeWindow.webContents.once('did-finish-load', () => {
        homeWindow.webContents.send('navigate-to-search');
      });
    } else {
      homeWindow.webContents.send('navigate-to-search');
    }
  }
}

app.whenReady().then(() => {
  initStore();

  // Hide dock icon to match production LSUIElement:true behavior.
  // This prevents macOS from switching Spaces when the capture shortcut fires.
  // The app is tray-only — users interact via the menu-bar icon.
  if (app.dock) {
    app.dock.hide();
  }

  createTray(triggerCapture, showSearchPage, showHomeWindow, triggerQuickSnip);
  registerShortcuts(triggerCapture, showSearchPage, triggerQuickSnip);
  registerIpcHandlers(getOverlayWindow, createEditorWindow, reregisterShortcuts, rebuildTrayMenu);

  // Start background organizer
  startWatcher();

  // Show setup overlay when Ollama install completes so user can accept model download
  setOnInstallComplete(function () {
    sendToHomeWindow('show-setup-overlay');
  });

  // Detect system Ollama and connect (no bundled binary) — skip if AI not explicitly enabled
  var { getAiEnabled } = require('./store');
  if (getAiEnabled() === true) {
    startOllama().then(async function () {
      var { checkModel } = require('./ollama-manager');
      await checkModel();
    }).catch(function (err) {
      console.error('[Snip] Ollama startup failed:', err.message);
    });
  } else {
    console.log('[Snip] AI disabled — skipping Ollama startup');
  }

  // Pre-warm SAM segmentation model
  const { warmUp } = require('./segmentation/segmentation');
  warmUp();

  // Pre-warm overlay window for fast first capture
  prewarmOverlay();

  // Open home window on startup
  showHomeWindow();
});

app.on('will-quit', () => {
  unregisterShortcuts();
  stopOllama();
});

app.on('window-all-closed', (e) => {
  // Prevent quit — tray app stays alive
  e.preventDefault();
});

// Show home window if second instance tries to launch
app.on('second-instance', () => {
  showHomeWindow();
});
