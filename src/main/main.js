const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const { registerShortcuts, unregisterShortcuts } = require('./shortcuts');
const { createTray } = require('./tray');
const { registerIpcHandlers } = require('./ipc-handlers');
const { captureScreen } = require('./capturer');
const { initStore } = require('./store');
const { startWatcher } = require('./organizer/watcher');
const { BASE_WEB_PREFERENCES } = require('./constants');

// Native Liquid Glass (macOS 26+) — safe no-op on older systems
let liquidGlass = null;
try {
  liquidGlass = require('electron-liquid-glass');
} catch {
  // Not available — fall back to vibrancy
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let overlayWindow = null;
let homeWindow = null;
let editorWindow = null;

function createOverlayWindow() {
  // Destroy old overlay if it exists
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
    overlayWindow = null;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
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

  // Apply native liquid glass if available
  if (liquidGlass) {
    homeWindow.webContents.once('did-finish-load', () => {
      try {
        liquidGlass.addView(homeWindow.getNativeWindowHandle(), {
          cornerRadius: 12,
          tintColor: '#22000008',
          opaque: true
        });
      } catch (e) {
        console.warn('[Snip] Liquid glass failed for home window:', e.message);
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
  const TOOLBAR_MIN_WIDTH = 900; // wide enough for all toolbar controls + slack

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  const winWidth = Math.min(Math.max(cssWidth + MARGIN, TOOLBAR_MIN_WIDTH), Math.round(screenW * 0.9));
  const winHeight = Math.min(Math.max(cssHeight + TOOLBAR_HEIGHT + MARGIN, 300), Math.round(screenH * 0.9));
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

  // Apply native liquid glass if available
  if (liquidGlass) {
    editorWindow.webContents.once('did-finish-load', () => {
      try {
        liquidGlass.addView(editorWindow.getNativeWindowHandle(), {
          cornerRadius: 12,
          tintColor: '#22000008',
          opaque: true
        });
      } catch (e) {
        console.warn('[Snip] Liquid glass failed for editor window:', e.message);
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
    console.error('[Snip] Capture failed, restoring window:', err.message);
    // Re-show dock and home window so the app doesn't appear dead
    showHomeWindow();
  }
}

function showHomeWindow() {
  createHomeWindow();
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
  registerIpcHandlers(getOverlayWindow, createEditorWindow);

  // Start background organizer
  startWatcher();

  // Pre-warm SAM segmentation model
  const { warmUp } = require('./organizer/segmentation');
  warmUp();

  // Open home window on startup
  showHomeWindow();
});

app.on('will-quit', () => {
  unregisterShortcuts();
});

app.on('window-all-closed', (e) => {
  // Prevent quit — tray app stays alive
  e.preventDefault();
});

// Show home window if second instance tries to launch
app.on('second-instance', () => {
  showHomeWindow();
});
