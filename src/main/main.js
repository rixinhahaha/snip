const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const { registerShortcuts, unregisterShortcuts } = require('./shortcuts');
const { createTray } = require('./tray');
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
let homeWindow = null;
let editorWindow = null;
let setupWindow = null;

function createOverlayWindow() {
  // Destroy old overlay if it exists
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
    overlayWindow = null;
  }

  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width, height } = cursorDisplay.size;
  const { x, y } = cursorDisplay.bounds;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    show: false,
    webPreferences: { ...BASE_WEB_PREFERENCES }
  });

  overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

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
  const winWidth = Math.min(Math.max(cssWidth + MARGIN, TOOLBAR_MIN_WIDTH), Math.round(screenW * 0.9));
  const winHeight = Math.min(Math.max(cssHeight + TOOLBAR_HEIGHT + MARGIN, cssHeight + TOOLBAR_HEIGHT + PANEL_CLEARANCE, 500), Math.round(screenH * 0.9));
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

async function triggerCapture() {
  // Don't start a new capture while the editor is open
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.focus();
    return;
  }

  // Hide home window so it doesn't appear behind the capture overlay
  if (homeWindow && !homeWindow.isDestroyed()) {
    homeWindow.hide();
  }

  try {
    await captureScreen(createOverlayWindow, getOverlayWindow);
  } catch (err) {
    console.error('[Snip] Capture failed:', err.message);
    // Permission errors show their own dialog from capturer.js —
    // only restore the home window for unexpected failures.
    if (!err.message.includes('permission') && !err.message.includes('Permission')) {
      showHomeWindow();
    }
  }
}

function showHomeWindow() {
  createHomeWindow();
}

function createSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.show();
    setupWindow.focus();
    return;
  }

  const setupOpts = {
    width: 440,
    height: 520,
    title: 'Set Up AI Assistant',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: { ...BASE_WEB_PREFERENCES }
  };

  if (!liquidGlass) {
    setupOpts.vibrancy = 'under-window';
  }

  setupWindow = new BrowserWindow(setupOpts);
  setupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'ollama-setup.html'));

  if (liquidGlass) {
    setupWindow.setWindowButtonVisibility(true);
    setupWindow.webContents.once('did-finish-load', () => {
      try {
        var glassId = liquidGlass.addView(setupWindow.getNativeWindowHandle(), {
          cornerRadius: 12,
          tintColor: '#22000008'
        });
        if (glassId < 0) throw new Error('addView returned ' + glassId);
      } catch (e) {
        setupWindow.setVibrancy('under-window');
      }
    });
  }

  setupWindow.on('closed', () => {
    setupWindow = null;
  });
}

function closeSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.close();
    setupWindow = null;
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

  createTray(triggerCapture, showSearchPage, showHomeWindow);
  registerShortcuts(triggerCapture, showSearchPage);
  registerIpcHandlers(getOverlayWindow, createEditorWindow, {
    openSetupWindow: createSetupWindow,
    closeSetupWindow: closeSetupWindow
  });

  // Start background organizer
  startWatcher();

  // Reopen setup window when Ollama install completes so user can accept model download
  setOnInstallComplete(function () {
    createSetupWindow();
  });

  // Detect system Ollama and connect (no bundled binary)
  startOllama().then(async function () {
    var { checkModel, isReady } = require('./ollama-manager');
    await checkModel();
    // Show setup popup if Ollama is not fully ready
    var ready = await isReady();
    if (!ready) {
      createSetupWindow();
    }
  }).catch(function (err) {
    console.error('[Snip] Ollama startup failed:', err.message);
    // Not installed or failed — show setup popup
    createSetupWindow();
  });

  // Pre-warm SAM segmentation model
  const { warmUp } = require('./segmentation/segmentation');
  warmUp();

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
