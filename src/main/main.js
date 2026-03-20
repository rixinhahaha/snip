const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { registerShortcuts, unregisterShortcuts, reregisterShortcuts } = require('./shortcuts');
const { createTray, rebuildTrayMenu } = require('./tray');
const { registerIpcHandlers } = require('./ipc-handlers');
const { captureScreen } = require('./capturer');
const { initStore, readIndex, getAllCategories, getMcpConfig, flushConfig } = require('./store');
const { startWatcher } = require('./organizer/watcher');
const { startOllama, stopOllama, setOnInstallComplete } = require('./ollama-manager');
const { BASE_WEB_PREFERENCES } = require('./constants');
const extensionRegistry = require('./extension-registry');
const { startSocketServer, stopSocketServer } = require('./socket-server');

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
let prewarmedEditor = null;

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

const EDITOR_HTML = path.join(__dirname, '..', 'renderer', 'editor.html');

/**
 * Pre-warm a hidden editor window so HTML + JS (Fabric.js, tools) are
 * already parsed and ready when the user captures a screenshot.
 */
function prewarmEditor() {
  if (prewarmedEditor && !prewarmedEditor.isDestroyed()) return;

  try {
    prewarmedEditor = new BrowserWindow({
      width: 1,
      height: 1,
      x: -9999,
      y: -9999,
      show: false,
      frame: true,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 14 },
      webPreferences: { ...BASE_WEB_PREFERENCES }
    });
    prewarmedEditor.loadFile(EDITOR_HTML);
    prewarmedEditor.on('closed', () => { prewarmedEditor = null; });
  } catch (e) {
    prewarmedEditor = null;
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
    overlayWindow = prewarmedOverlay;
    prewarmedOverlay = null;
    // Ensure the prewarmed window has finished loading before use.
    // loadFile() is async — if capture triggers before it completes,
    // the IPC listener in the renderer won't be registered yet.
    if (overlayWindow.webContents.isLoading()) {
      await new Promise(resolve => {
        overlayWindow.webContents.once('did-finish-load', resolve);
      });
    }
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

function computeEditorBounds(cssWidth, cssHeight) {
  const TOOLBAR_HEIGHT = 48;
  const MARGIN = 48;
  const TOOLBAR_MIN_WIDTH = 1100;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
  const PANEL_CLEARANCE = 260;
  const winWidth = Math.min(Math.max(cssWidth + MARGIN, TOOLBAR_MIN_WIDTH), screenW);
  const winHeight = Math.min(Math.max(cssHeight + TOOLBAR_HEIGHT + MARGIN, cssHeight + TOOLBAR_HEIGHT + PANEL_CLEARANCE, 500), screenH);
  const x = Math.round((screenW - winWidth) / 2);
  const y = Math.round((screenH - winHeight) / 2);
  return { winWidth, winHeight, x, y };
}

function createEditorWindow(cssWidth, cssHeight) {
  // Close existing editor if open
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.close();
    editorWindow = null;
  }

  const { winWidth, winHeight, x, y } = computeEditorBounds(cssWidth, cssHeight);

  // Reuse pre-warmed editor if available (HTML + JS already loaded)
  if (prewarmedEditor && !prewarmedEditor.isDestroyed()) {
    editorWindow = prewarmedEditor;
    prewarmedEditor = null;

    editorWindow.setContentSize(winWidth, winHeight);
    editorWindow.setPosition(x, y);

    if (!liquidGlass) {
      editorWindow.setVibrancy('under-window');
    }
  } else {
    // Fallback: create fresh window (show: false — IPC handler will show after data push)
    const editorOpts = {
      width: winWidth,
      height: winHeight,
      x,
      y,
      show: false,
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
    editorWindow.loadFile(EDITOR_HTML);
  }

  // Apply native liquid glass if available, with vibrancy fallback
  if (liquidGlass) {
    editorWindow.setWindowButtonVisibility(true);
    // Apply glass when content is ready (may already be loaded for pre-warmed)
    const applyGlass = () => {
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
    };
    if (editorWindow.webContents.isLoading()) {
      editorWindow.webContents.once('did-finish-load', applyGlass);
    } else {
      applyGlass();
    }
  }

  // Destroy overlay (will be recreated fresh next capture)
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
    overlayWindow = null;
  }

  editorWindow.on('closed', () => {
    editorWindow = null;
    // Re-prewarm for next capture
    prewarmEditor();
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
    if (err.message.includes('permission') || err.message.includes('Permission')) {
      // Show the in-app permission view instead of a native dialog
      showHomeWindow();
      sendToHomeWindow('show-permission-view');
    } else {
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
  sendToHomeWindow('navigate-to-search');
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
  // Register core IPC handlers FIRST (protects channels from extension squatting)
  registerIpcHandlers(getOverlayWindow, createEditorWindow, reregisterShortcuts, rebuildTrayMenu);

  // Migrate bundled models to addon directory (one-time, for users upgrading from older versions)
  var addonManager = require('./addon-manager');
  addonManager.migrateFromBundled();

  // Load extension registry and register extension IPC handlers AFTER core
  extensionRegistry.loadAll();
  extensionRegistry.setContext({
    getEditorData: function () { return require('./ipc-handlers').getPendingEditorData(); },
    getOverlayWindow: getOverlayWindow
  });
  extensionRegistry.registerIpcHandlers();

  // Pre-warm editor window (load HTML + Fabric.js + tools in background)
  prewarmEditor();

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

  // Warm up extension models (SAM segmentation, etc.)
  extensionRegistry.warmUp();

  // Pre-warm overlay window for fast first capture
  prewarmOverlay();

  // Always start socket server (CLI depends on it; MCP toggle only controls UI visibility)
  startSocketHandlers();

  // Open home window on startup
  showHomeWindow();

  // Auto-update (packaged app only)
  if (app.isPackaged) {
    const { initAutoUpdater } = require('./auto-updater');
    initAutoUpdater();
  }
});

var isQuitting = false;
app.on('will-quit', (e) => {
  if (isQuitting) return; // already shutting down
  isQuitting = true;

  // If auto-updater is installing, let the quit proceed (it handles relaunch)
  var updatingInstall = false;
  try { updatingInstall = require('./auto-updater').isPendingInstall(); } catch (_) {}
  if (updatingInstall) {
    // Synchronous cleanup only — let quitAndInstall manage the quit
    try { require('./auto-updater').cancelAutoUpdater(); } catch (_) {}
    unregisterShortcuts();
    flushConfig();
    extensionRegistry.killWorkers();
    stopSocketServer();
    // Kill Ollama synchronously (SIGTERM fires immediately even though stopOllama is async)
    try { stopOllama(); } catch (_) {}
    // Safety net: if quitAndInstall fails, force exit after 5s
    setTimeout(() => app.exit(0), 5000);
    return;
  }

  e.preventDefault();
  try { require('./auto-updater').cancelAutoUpdater(); } catch (_) {}
  unregisterShortcuts();
  flushConfig();
  extensionRegistry.killWorkers();
  stopSocketServer();
  // Safety timeout: force exit after 5s no matter what
  var forceExit = setTimeout(() => app.exit(0), 5000);
  stopOllama().finally(() => { clearTimeout(forceExit); app.exit(0); });
});

app.on('window-all-closed', (e) => {
  // Prevent quit — tray app stays alive
  e.preventDefault();
});

// Show home window if second instance tries to launch
app.on('second-instance', () => {
  showHomeWindow();
});

// ── MCP Server ──

var screenshotsDir = null;

function requireScreenshotPath(filepath) {
  // Always re-read in case the user changed the save location
  screenshotsDir = require('./store').getScreenshotsDir();
  if (!filepath) throw new Error('Missing filepath parameter');
  var resolved = path.resolve(filepath);
  var base = path.resolve(screenshotsDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('Path outside screenshots directory');
  }
  if (!require('fs').existsSync(resolved)) {
    throw new Error('File not found');
  }
  return resolved;
}

function requireCategory(category) {
  var config = getMcpConfig();
  if (!config.categories[category]) {
    throw new Error(category + ' is disabled in MCP settings');
  }
}

// ── Diagram rendering (hidden BrowserWindow + Mermaid.js) ──

const DIAGRAM_HTML = path.join(__dirname, '..', 'renderer', 'diagram.html');
const DIAGRAM_PRELOAD = path.join(__dirname, '..', 'preload', 'diagram-preload.js');

function renderDiagramToImage(code, format) {
  return new Promise(function (resolve, reject) {
    var diagramWin = new BrowserWindow({
      width: 4096,
      height: 4096,
      show: false,
      frame: false,
      webPreferences: {
        preload: DIAGRAM_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        offscreen: true
      }
    });

    // Offscreen rendering needs a frame rate and an initial paint
    diagramWin.webContents.setFrameRate(30);

    var settled = false;
    var timeoutId = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Diagram rendering timed out (30s)'));
    }, 30000);

    function cleanup() {
      clearTimeout(timeoutId);
      if (diagramWin && !diagramWin.isDestroyed()) {
        diagramWin.destroy();
      }
      diagramWin = null;
    }

    function onRendered(event, result) {
      if (settled) return;
      if (!diagramWin || event.sender.id !== diagramWin.webContents.id) return;

      if (!result.success) {
        settled = true;
        cleanup();
        reject(new Error('Mermaid syntax error: ' + (result.error || 'unknown')));
        return;
      }

      // In offscreen mode, invalidate to force a fresh paint then capture
      diagramWin.webContents.invalidate();
      setTimeout(function () {
        if (settled || !diagramWin || diagramWin.isDestroyed()) return;

        var captureRect = { x: 0, y: 0, width: result.width, height: result.height };

        diagramWin.webContents.capturePage(captureRect).then(function (nativeImage) {
          if (settled) return;
          settled = true;
          var pngDataURL = nativeImage.toDataURL();
          var size = nativeImage.getSize();
          cleanup();
          resolve({
            imageDataURL: pngDataURL,
            width: size.width,
            height: size.height
          });
        }).catch(function (err) {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('Capture failed: ' + err.message));
        });
      }, 100); // Wait for offscreen paint to complete
    }

    ipcMain.once('diagram-rendered', onRendered);

    diagramWin.loadFile(DIAGRAM_HTML);
    diagramWin.webContents.once('did-finish-load', function () {
      diagramWin.webContents.send('render-diagram-code', { code: code, format: format });
    });
  });
}

// ── MCP editor helpers ──

var pendingMcpResolve = null; // { resolve, reject, webContentsId, win }

/**
 * Open an image in the editor and block until the user finishes annotating.
 * Shared by open_in_snip and render_diagram.
 * Caller must set pendingMcpResolve = true before calling.
 */
function openEditorWithData(data) {
  return new Promise(function (resolve, reject) {
    data.extensions = extensionRegistry.getRendererManifest();

    var { setPendingEditorData } = require('./ipc-handlers');
    setPendingEditorData(data);

    var win = createEditorWindow(data.cssWidth, data.cssHeight);
    pendingMcpResolve = { resolve: resolve, reject: reject, webContentsId: win.webContents.id, win: win };

    app.focus({ steal: true });

    var pushData = function () {
      if (win && !win.isDestroyed()) {
        win.webContents.send('editor-image-data', data);
        win.show();
      }
    };
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', pushData);
    } else {
      pushData();
    }

    win.on('closed', function () {
      var { setPendingEditorData } = require('./ipc-handlers');
      setPendingEditorData(null);

      if (pendingMcpResolve && typeof pendingMcpResolve === 'object' && pendingMcpResolve.reject) {
        pendingMcpResolve.reject(new Error('Editor closed without saving'));
        pendingMcpResolve = null;
      }
      prewarmEditor();
    });
  });
}

ipcMain.on('editor-result', function (event, dataURL) {
  if (!pendingMcpResolve || typeof pendingMcpResolve !== 'object') return;
  // Only accept results from the editor window that was opened for this upload
  if (event.sender.id !== pendingMcpResolve.webContentsId) return;
  var { resolve, reject, win } = pendingMcpResolve;
  pendingMcpResolve = null;
  if (dataURL && typeof dataURL === 'string' && dataURL.startsWith('data:image/')) {
    // Save annotated image to Snip temp space for CLI access
    try {
      var store = require('./store');
      var tmpDir = path.join(store.getScreenshotsDir(), '.tmp');
      require('fs').mkdirSync(tmpDir, { recursive: true });
      var filename = 'annotated-' + Date.now() + '.png';
      var outputPath = path.join(tmpDir, filename);
      var raw = Buffer.from(dataURL.split(',')[1], 'base64');
      require('fs').writeFileSync(outputPath, raw);
      resolve({ dataURL: dataURL, outputPath: outputPath });
    } catch (e) {
      resolve({ dataURL: dataURL });
    }
  } else if (dataURL) {
    reject(new Error('Invalid editor result'));
  } else {
    reject(new Error('User cancelled editing'));
  }
  // Close the editor window (close-editor IPC won't find it since it's not in editorWindowRef)
  if (win && !win.isDestroyed()) win.destroy();
});

function startSocketHandlers() {
  startSocketServer({
    search_screenshots: async function (params) {
      requireCategory('library');
      const { searchScreenshots } = require('./organizer/embeddings');
      return searchScreenshots(params.query);
    },
    list_screenshots: async function () {
      requireCategory('library');
      return readIndex();
    },
    get_screenshot: async function (params) {
      requireCategory('library');
      var filepath = requireScreenshotPath(params.filepath);
      var fs = require('fs');
      var buf = fs.readFileSync(filepath);
      var ext = path.extname(filepath).slice(1).toLowerCase() || 'png';
      var mimeType = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
      var entry = readIndex().find(function (e) { return e.path === filepath; });
      return {
        dataURL: 'data:' + mimeType + ';base64,' + buf.toString('base64'),
        width: entry ? entry.width : null,
        height: entry ? entry.height : null,
        metadata: entry || null
      };
    },
    transcribe_screenshot: async function (params) {
      requireCategory('transcribe');
      var filepath = requireScreenshotPath(params.filepath);
      var buf = require('fs').readFileSync(filepath);
      var base64 = buf.toString('base64');
      const { transcribe } = require('./transcription/transcription');
      return transcribe(base64);
    },
    organize_screenshot: async function (params) {
      requireCategory('organize');
      var filepath = requireScreenshotPath(params.filepath);
      const { queueNewFile } = require('./organizer/watcher');
      queueNewFile(filepath);
      return { queued: true, filepath: filepath };
    },
    get_categories: async function () {
      requireCategory('library');
      return getAllCategories();
    },
    open_in_snip: async function (params) {
      requireCategory('upload');

      if (!params.filepath && !params.imageDataURL) {
        throw new Error('Provide either filepath or imageDataURL');
      }

      // Check editor is not already busy
      if (pendingMcpResolve) throw new Error('Editor is busy with another upload');

      // Reserve the slot with a truthy sentinel (not destructurable — prevents crash if editor-result fires early)
      pendingMcpResolve = true;

      try {

      // Resolve image to raw bytes + data URL
      var imageDataURL;
      var headerBytes; // first bytes for dimension parsing (avoids re-decoding)
      var fs = require('fs');
      var ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg'];

      if (params.filepath) {
        var filepath = path.resolve(params.filepath);
        if (!fs.existsSync(filepath)) throw new Error('File not found');
        var ext = path.extname(filepath).slice(1).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) throw new Error('Unsupported format — use PNG or JPEG');
        var stat = fs.statSync(filepath);
        if (stat.size > 15 * 1024 * 1024) throw new Error('Image too large (max 15 MB)');
        var buf = fs.readFileSync(filepath);
        headerBytes = Buffer.from(buf.buffer, buf.byteOffset, Math.min(buf.length, 65536));
        var mimeType = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
        imageDataURL = 'data:' + mimeType + ';base64,' + buf.toString('base64');
        buf = null; // release raw buffer — base64 string is the only reference needed
      } else {
        imageDataURL = params.imageDataURL;
        var commaIdx = imageDataURL.indexOf(',');
        var base64Len = commaIdx >= 0 ? imageDataURL.length - commaIdx - 1 : imageDataURL.length;
        if (base64Len > 20 * 1024 * 1024) throw new Error('Image too large (max ~15 MB)');
        // Decode only the first 64KB for dimension parsing
        var base64Start = commaIdx >= 0 ? commaIdx + 1 : 0;
        headerBytes = Buffer.from(imageDataURL.slice(base64Start, base64Start + 87382), 'base64'); // 87382 base64 chars ≈ 64KB
      }

      // Parse image dimensions from header bytes (PNG/JPEG)
      var imgWidth = 0;
      var imgHeight = 0;

      // PNG: bytes 1-3 = "PNG", width at 16-19, height at 20-23
      if (headerBytes.length > 24 && headerBytes[1] === 0x50 && headerBytes[2] === 0x4E && headerBytes[3] === 0x47) {
        imgWidth = headerBytes.readUInt32BE(16);
        imgHeight = headerBytes.readUInt32BE(20);
      }
      // JPEG: starts with FF D8, search for SOF0/SOF2 marker (cap scan at 64KB)
      if (!imgWidth && headerBytes.length > 2 && headerBytes[0] === 0xFF && headerBytes[1] === 0xD8) {
        var scanLimit = Math.min(headerBytes.length - 9, 65536);
        for (var i = 2; i <= scanLimit; i++) {
          if (headerBytes[i] === 0xFF && (headerBytes[i + 1] === 0xC0 || headerBytes[i + 1] === 0xC2)) {
            imgHeight = headerBytes.readUInt16BE(i + 5);
            imgWidth = headerBytes.readUInt16BE(i + 7);
            break;
          }
        }
      }

      if (!imgWidth || !imgHeight) throw new Error('Could not determine image dimensions — ensure the file is a valid PNG or JPEG');

      } catch (err) {
        pendingMcpResolve = null;
        throw err;
      }

      return openEditorWithData({
        croppedDataURL: imageDataURL,
        cssWidth: imgWidth,
        cssHeight: imgHeight,
        mcpUpload: true
      });
    },
    render_diagram: async function (params) {
      requireCategory('upload');

      if (!params.code || typeof params.code !== 'string') {
        throw new Error('Missing "code" parameter');
      }
      if (params.code.length > 100 * 1024) {
        throw new Error('Diagram code too large (max 100 KB)');
      }
      var format = params.format || 'mermaid';
      if (format !== 'mermaid') {
        throw new Error('Unsupported format: ' + format + ' (supported: mermaid)');
      }

      // Check editor is not already busy
      if (pendingMcpResolve) throw new Error('Editor is busy with another upload');
      pendingMcpResolve = true;

      try {
        var renderResult = await renderDiagramToImage(params.code, format);

        return openEditorWithData({
          croppedDataURL: renderResult.imageDataURL,
          cssWidth: renderResult.width,
          cssHeight: renderResult.height,
          mcpUpload: true
        });
      } catch (err) {
        pendingMcpResolve = null;
        throw err;
      }
    },
    install_extension: async function (params) {
      if (!params.name || !params.manifest) throw new Error('Provide name and manifest');

      var extName = String(params.name);
      // Validate name: alphanumeric + hyphens only
      if (!/^[a-zA-Z0-9\-]+$/.test(extName)) throw new Error('Extension name must be alphanumeric with hyphens only');

      var manifest = params.manifest;
      if (typeof manifest !== 'object') throw new Error('manifest must be an object');

      // Validate type restriction
      if (manifest.type !== 'action-tool' && manifest.type !== 'processor') {
        throw new Error('User extensions must be action-tool or processor type');
      }

      // Validate IPC channels use ext: prefix
      if (Array.isArray(manifest.ipc)) {
        for (var i = 0; i < manifest.ipc.length; i++) {
          if (!manifest.ipc[i].channel || !manifest.ipc[i].channel.startsWith('ext:')) {
            throw new Error('All IPC channels must use ext: prefix');
          }
        }
      }

      // Show approval dialog
      var { dialog } = require('electron');
      var detail = 'Type: ' + manifest.type + '\n';
      if (manifest.ipc) detail += 'IPC channels: ' + manifest.ipc.length + '\n';
      detail += 'Backend code: ' + (params.mainCode ? 'Yes' : 'No') + '\n';
      if (manifest.permissions && manifest.permissions.length > 0) {
        detail += 'Permissions: ' + manifest.permissions.join(', ') + '\n';
      }

      app.focus({ steal: true });
      var result = await dialog.showMessageBox({
        type: 'question',
        title: 'Install Extension',
        message: 'Install "' + (manifest.displayName || extName) + '"?',
        detail: detail + '\nOnly install extensions from sources you trust.',
        buttons: ['Cancel', 'Install'],
        defaultId: 0,
        cancelId: 0
      });

      if (result.response !== 1) throw new Error('User declined installation');

      // Check name doesn't conflict with existing extension
      var existingExts = extensionRegistry.getUserExtensions();
      if (existingExts.find(function (e) { return e.name === extName; })) {
        throw new Error('Extension "' + extName + '" is already installed');
      }

      // Write extension files
      var userExtDir = extensionRegistry.getUserExtensionsDir();
      var extDir = path.join(userExtDir, extName);
      var fs = require('fs');
      fs.mkdirSync(extDir, { recursive: true });

      // Write files
      manifest.name = extName;
      if (params.mainCode) {
        manifest.main = 'main.js';
        fs.writeFileSync(path.join(extDir, 'main.js'), params.mainCode);
      }
      fs.writeFileSync(path.join(extDir, 'extension.json'), JSON.stringify(manifest, null, 2));

      // Hot-load the extension
      var loaded = extensionRegistry.loadUserExtension(extName);
      if (!loaded) throw new Error('Extension installed but failed to load');

      // Notify Settings UI
      for (var win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('user-extensions-changed');
      }

      return { installed: true, name: extName, path: extDir };
    }
  });
}

module.exports = { startSocketHandlers };
