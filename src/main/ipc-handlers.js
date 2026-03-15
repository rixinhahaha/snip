const { ipcMain, clipboard, nativeImage, app, Notification, shell, BrowserWindow, screen, systemPreferences, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  getScreenshotsDir, getOllamaModel, setOllamaModel, getOllamaUrl, setOllamaUrl,
  getAllCategories, addCustomCategory, removeCustomCategory,
  getAllTagsWithDescriptions, setTagDescription, addCustomCategoryWithDescription,
  readIndex, removeFromIndex, removeFromIndexByDir, rebuildIndex,
  getTheme, setTheme,
  getAiEnabled, setAiEnabled,
  getFalApiKey, setFalApiKey,
  getShortcuts, getDefaultShortcuts, setShortcut, resetShortcuts,
  getMcpConfig, setMcpConfig
} = require('./store');
const { queueNewFile } = require('./organizer/watcher');
const ollamaManager = require('./ollama-manager');
const { getCapturedImage } = require('./capturer');

let pendingEditorData = null;
let editorWindowRef = null;
let toastWindow = null;

// Theme tokens for the floating toast — mirrors theme.css design language
const TOAST_THEMES = {
  dark: {
    bg: 'rgba(20, 20, 20, 0.7)',
    shadow: '0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 0 rgba(255,255,255,0.06)',
    specular: 'rgba(255, 255, 255, 0.08)',
    color: '#e0e0e0',
    accent: '#8B5CF6',
    blur: '24px'
  },
  light: {
    bg: 'rgba(255, 253, 250, 0.85)',
    shadow: '0 4px 16px rgba(0,0,0,0.08), inset 0 1px 0 0 rgba(255,255,255,0.5)',
    specular: 'rgba(124, 58, 237, 0.15)',
    color: '#1a1a1a',
    accent: '#7C3AED',
    blur: '24px'
  },
  glass: {
    bg: 'rgba(22, 10, 42, 0.75)',
    shadow: '0 8px 24px rgba(20,8,40,0.55), inset 0 1px 0 0 rgba(255,255,255,0.14)',
    specular: 'rgba(167, 139, 250, 0.25)',
    color: '#f0eafa',
    accent: '#A78BFA',
    blur: '0px'
  }
};

function showFloatingToast(message) {
  // Destroy previous toast if still showing
  if (toastWindow && !toastWindow.isDestroyed()) {
    toastWindow.destroy();
    toastWindow = null;
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width: screenW } = display.workArea;
  const toastW = 260;
  const toastH = 48;
  const x = display.workArea.x + Math.round((screenW - toastW) / 2);
  const y = display.workArea.y + 32;

  toastWindow = new BrowserWindow({
    width: toastW,
    height: toastH,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  const theme = getTheme() || 'dark';
  const t = TOAST_THEMES[theme] || TOAST_THEMES.dark;

  // Escape message for safe HTML insertion
  const safeMessage = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    -webkit-app-region: no-drag;
    background: transparent;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
  }
  .toast {
    background: ${t.bg};
    backdrop-filter: blur(${t.blur});
    -webkit-backdrop-filter: blur(${t.blur});
    border: 1px solid ${t.specular};
    border-radius: 10px;
    box-shadow: ${t.shadow};
    padding: 10px 18px;
    font-family: -apple-system, BlinkMacSystemFont, 'Plus Jakarta Sans', sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: ${t.color};
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 8px;
    opacity: 0;
    transform: translateY(-6px);
    animation: fadeIn 0.25s ease forwards, fadeOut 0.3s ease 1.1s forwards;
  }
  .icon { color: ${t.accent}; font-size: 14px; }
  @keyframes fadeIn { to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeOut { to { opacity: 0; transform: translateY(-6px); } }
</style></head><body>
  <div class="toast"><span class="icon">✓</span>${safeMessage}</div>
</body></html>`;

  toastWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  toastWindow.setIgnoreMouseEvents(true);
  toastWindow.once('ready-to-show', () => {
    if (toastWindow && !toastWindow.isDestroyed()) toastWindow.show();
  });

  // Auto-destroy after animation completes
  setTimeout(() => {
    if (toastWindow && !toastWindow.isDestroyed()) {
      toastWindow.destroy();
      toastWindow = null;
    }
  }, 1600);
}

function registerIpcHandlers(getOverlayWindow, createEditorWindowFn, reregisterShortcutsFn, rebuildTrayMenuFn) {
  // Copy annotated image to clipboard
  ipcMain.handle('copy-to-clipboard', async (event, dataURL) => {
    const image = nativeImage.createFromDataURL(dataURL);
    clipboard.writeImage(image);
    return true;
  });

  // Save screenshot to disk
  ipcMain.handle('save-screenshot', async (event, { dataURL, timestamp }) => {
    const screenshotsDir = getScreenshotsDir();
    fs.mkdirSync(screenshotsDir, { recursive: true });

    const filename = `${timestamp}.jpg`;
    const filepath = path.join(screenshotsDir, filename);

    const base64Data = dataURL.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filepath, buffer);
    console.log('[Snip] Saved snip: %s (%s KB)', filename, (buffer.length / 1024).toFixed(1));

    // Mark for agent processing before watcher picks it up
    queueNewFile(filepath);

    return filepath;
  });

  // Show a floating toast near the top of the screen
  ipcMain.on('show-notification', (event, body) => {
    showFloatingToast(body);
  });

  // Return the captured screenshot as a data URL (deferred from capture time)
  ipcMain.handle('get-capture-image', async () => {
    return getCapturedImage();
  });

  // Close/destroy the overlay (will be recreated fresh next capture)
  ipcMain.on('close-overlay', () => {
    const overlayWindow = getOverlayWindow();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy();
    }
  });

  // Open editor window with cropped image
  ipcMain.handle('open-editor', async (event, data) => {
    pendingEditorData = data;
    const win = createEditorWindowFn(data.cssWidth, data.cssHeight);
    editorWindowRef = win;

    // Attach extension manifest so the renderer can build the toolbar dynamically
    const extensionRegistry = require('./extension-registry');
    data.extensions = extensionRegistry.getRendererManifest();

    // Push image data to the editor once its content is ready
    const pushData = () => {
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

    // Clear references when editor closes to free memory (base64 image data)
    win.on('closed', () => {
      pendingEditorData = null;
      editorWindowRef = null;
    });

    return true;
  });

  // Editor requests image data on load (fallback for non-prewarmed windows)
  ipcMain.handle('get-editor-image', async () => {
    if (pendingEditorData && !pendingEditorData.extensions) {
      const extensionRegistry = require('./extension-registry');
      pendingEditorData.extensions = extensionRegistry.getRendererManifest();
    }
    return pendingEditorData;
  });

  // Close editor window
  ipcMain.on('close-editor', () => {
    if (editorWindowRef && !editorWindowRef.isDestroyed()) {
      editorWindowRef.close();
    }
  });

  // Get system fonts
  ipcMain.handle('get-system-fonts', async () => {
    return [
      'Plus Jakarta Sans', 'SF Pro', 'Helvetica Neue', 'Arial', 'Menlo', 'Monaco',
      'Courier New', 'Georgia', 'Times New Roman', 'Verdana',
      'Comic Sans MS', 'Impact', 'Futura', 'Avenir'
    ];
  });

  // Screen recording permission
  ipcMain.handle('get-screen-permission', async () => {
    return systemPreferences.getMediaAccessStatus('screen');
  });

  ipcMain.handle('request-screen-permission', async () => {
    try {
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    } catch (e) { console.log('[Snip] Screen permission probe error (expected):', e.message); }
    return systemPreferences.getMediaAccessStatus('screen');
  });

  ipcMain.handle('restart-app', () => {
    app.relaunch();
    app.exit(0);
  });

  // AI preference
  ipcMain.handle('get-ai-enabled', async () => {
    return getAiEnabled();
  });

  ipcMain.handle('set-ai-enabled', async (event, enabled) => {
    setAiEnabled(enabled);
    if (enabled) {
      // User opted in — start Ollama immediately
      const { startOllama } = require('./ollama-manager');
      startOllama().catch(err => {
        console.warn('[Snip] Ollama start after AI enable failed:', err.message);
      });
    } else {
      // User opted out — stop Ollama to free resources
      const { stopOllama } = require('./ollama-manager');
      stopOllama();
    }
    return true;
  });

  // Settings: Ollama
  ipcMain.handle('get-ollama-config', async () => {
    return { model: getOllamaModel(), url: getOllamaUrl() };
  });

  ipcMain.handle('set-ollama-config', async (event, { model, url }) => {
    if (model) {
      const oldModel = getOllamaModel();
      if (oldModel !== model) {
        console.log('[Snip] Model switched: %s → %s at %s', oldModel, model, new Date().toISOString());
      }
      setOllamaModel(model);
    }
    if (url) setOllamaUrl(url);
    return true;
  });

  ipcMain.handle('get-ollama-status', async () => {
    return ollamaManager.getStatus();
  });

  ipcMain.handle('get-ollama-pull-progress', async () => {
    return ollamaManager.getPullProgress();
  });

  ipcMain.handle('install-ollama', async () => {
    return ollamaManager.installOllama();
  });

  ipcMain.handle('pull-ollama-model', async () => {
    return ollamaManager.pullModel();
  });

  ipcMain.handle('check-ollama-model', async () => {
    return ollamaManager.checkModel();
  });

  // Setup overlay controls (broadcast to all windows)
  ipcMain.handle('close-setup-overlay', async () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('hide-setup-overlay');
    }
    return true;
  });

  ipcMain.handle('open-setup-overlay', async () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('show-setup-overlay');
    }
    return true;
  });

  // Settings: Animation (fal.ai)
  ipcMain.handle('get-animation-config', async () => {
    return { falApiKey: getFalApiKey() };
  });

  ipcMain.handle('set-animation-config', async (event, { falApiKey }) => {
    if (falApiKey !== undefined) setFalApiKey(falApiKey);
    return true;
  });

  // Settings: MCP Server
  ipcMain.handle('get-mcp-config', async () => {
    return getMcpConfig();
  });

  ipcMain.handle('set-mcp-config', async (event, update) => {
    var before = getMcpConfig();
    setMcpConfig(update);
    var after = getMcpConfig();

    // Start or stop the socket server based on toggle
    if (after.enabled && !before.enabled) {
      var { startMcpServer } = require('./main');
      startMcpServer();
    } else if (!after.enabled && before.enabled) {
      var { stopSocketServer } = require('./socket-server');
      stopSocketServer();
    }

    // Broadcast change to all windows
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('mcp-config-changed', after);
    }
    return after;
  });

  // MCP: resolve paths for client config snippet
  ipcMain.handle('get-mcp-client-config', async () => {
    var nodePath;
    var serverPath;

    if (app.isPackaged) {
      // Packaged: use bundled Node + unpacked MCP server
      nodePath = path.join(process.resourcesPath, 'node', 'node');
      serverPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'mcp', 'server.js');
    } else {
      // Dev: use system node + source file
      var { findNodeBinary } = require('./node-binary');
      nodePath = findNodeBinary() || 'node';
      serverPath = path.join(__dirname, '..', 'mcp', 'server.js');
    }

    return {
      mcpServers: {
        snip: {
          command: nodePath,
          args: [serverPath]
        }
      }
    };
  });

  // Settings: User Extensions
  var extensionRegistry = require('./extension-registry');

  ipcMain.handle('get-user-extensions', async () => {
    return extensionRegistry.getUserExtensions();
  });

  ipcMain.handle('remove-user-extension', async (event, name) => {
    extensionRegistry.removeUserExtension(name);
    return extensionRegistry.getUserExtensions();
  });

  ipcMain.handle('install-extension-from-folder', async () => {
    var { dialog } = require('electron');
    var result = await dialog.showOpenDialog({
      title: 'Select Extension Folder',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { error: 'Cancelled' };

    var srcFolder = result.filePaths[0];
    var manifestPath = path.join(srcFolder, 'extension.json');
    if (!fs.existsSync(manifestPath)) return { error: 'No extension.json found in selected folder' };

    var manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch { return { error: 'Invalid JSON in extension.json' }; }

    // Validate manifest schema
    if (!extensionRegistry.validateManifest(manifest, manifest.name || 'unknown')) {
      return { error: 'Invalid manifest — check name, ipc, and toolbarPosition fields' };
    }

    // Validate name is safe for filesystem
    if (!/^[a-zA-Z0-9\-]+$/.test(manifest.name)) {
      return { error: 'Extension name must be alphanumeric with hyphens only' };
    }

    // User extensions: type restriction
    if (manifest.type !== 'action-tool' && manifest.type !== 'processor') {
      return { error: 'Only action-tool and processor types are supported for user extensions' };
    }

    // User extensions: ext: prefix required
    if (Array.isArray(manifest.ipc)) {
      for (var i = 0; i < manifest.ipc.length; i++) {
        if (!manifest.ipc[i].channel.startsWith('ext:')) {
          return { error: 'IPC channel "' + manifest.ipc[i].channel + '" must use ext: prefix' };
        }
      }
    }

    // Check main file exists
    if (manifest.main && !fs.existsSync(path.join(srcFolder, manifest.main))) {
      return { error: 'File "' + manifest.main + '" not found in folder' };
    }

    // Check name doesn't conflict
    var existing = extensionRegistry.getUserExtensions();
    if (existing.find(function (e) { return e.name === manifest.name; })) {
      return { error: 'Extension "' + manifest.name + '" is already installed' };
    }

    // Approval dialog
    var detail = 'Type: ' + manifest.type + '\n';
    if (manifest.ipc) detail += 'IPC channels: ' + manifest.ipc.length + '\n';
    if (manifest.permissions && manifest.permissions.length > 0) {
      detail += 'Permissions: ' + manifest.permissions.join(', ') + '\n';
    }

    var approval = await dialog.showMessageBox({
      type: 'question',
      title: 'Install Extension',
      message: 'Install "' + (manifest.displayName || manifest.name) + '"?',
      detail: detail + '\nOnly install extensions from sources you trust.',
      buttons: ['Cancel', 'Install'],
      defaultId: 0, cancelId: 0
    });
    if (approval.response !== 1) return { error: 'Installation cancelled' };

    // Copy files (skip symlinks and subdirectories)
    var destDir = path.join(extensionRegistry.getUserExtensionsDir(), manifest.name);
    fs.mkdirSync(destDir, { recursive: true });
    var files = fs.readdirSync(srcFolder);
    for (var j = 0; j < files.length; j++) {
      var srcPath = path.join(srcFolder, files[j]);
      var destPath = path.join(destDir, files[j]);
      var stat = fs.lstatSync(srcPath);
      if (stat.isFile() && !stat.isSymbolicLink()) {
        fs.copyFileSync(srcPath, destPath);
      }
    }

    var loaded = extensionRegistry.loadUserExtension(manifest.name);
    if (!loaded) return { error: 'Extension installed but failed to load' };
    return { installed: true, name: manifest.name };
  });

  // Settings: Categories
  ipcMain.handle('get-categories', async () => {
    return getAllCategories();
  });

  ipcMain.handle('add-category', async (event, category) => {
    return addCustomCategory(category);
  });

  ipcMain.handle('remove-category', async (event, category) => {
    return removeCustomCategory(category);
  });

  // Settings: Tags with descriptions
  ipcMain.handle('get-tags-with-descriptions', async () => {
    return getAllTagsWithDescriptions();
  });

  ipcMain.handle('set-tag-description', async (event, { tag, description }) => {
    setTagDescription(tag, description);
    return getAllTagsWithDescriptions();
  });

  ipcMain.handle('add-category-with-description', async (event, { name, description }) => {
    return addCustomCategoryWithDescription(name, description);
  });

  // Search: get index
  ipcMain.handle('get-screenshot-index', async () => {
    return readIndex();
  });

  // Search: get thumbnail
  ipcMain.handle('get-thumbnail', async (event, filepath) => {
    try {
      // GIFs: return full file as data URL (nativeImage strips animation)
      if (filepath.toLowerCase().endsWith('.gif')) {
        const buf = fs.readFileSync(filepath);
        return 'data:image/gif;base64,' + buf.toString('base64');
      }
      const image = nativeImage.createFromPath(filepath);
      const resized = image.resize({ width: 200 });
      return resized.toDataURL();
    } catch (err) {
      console.warn('[Snip] Thumbnail failed:', filepath, err.message);
      return null;
    }
  });

  // Reveal in Finder
  ipcMain.handle('reveal-in-finder', async (event, filepath) => {
    shell.showItemInFolder(filepath);
    return true;
  });

  ipcMain.handle('open-external-url', async (event, url) => {
    shell.openExternal(url);
    return true;
  });

  // Search: embed query
  ipcMain.handle('search-screenshots', async (event, query) => {
    const { searchScreenshots } = require('./organizer/embeddings');
    return searchScreenshots(query);
  });

  // Home: get screenshots directory path
  ipcMain.handle('get-screenshots-dir', async () => {
    return getScreenshotsDir();
  });

  // Home: list folder contents
  ipcMain.handle('list-folder', async (event, subdir) => {
    const baseDir = getScreenshotsDir();
    const targetDir = subdir ? path.join(baseDir, subdir) : baseDir;

    // Prevent path traversal
    const resolved = path.resolve(targetDir);
    if (!resolved.startsWith(path.resolve(baseDir))) {
      return [];
    }

    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      return entries.map(entry => {
        const fullPath = path.join(resolved, entry.name);
        let stat;
        try { stat = fs.statSync(fullPath); } catch { stat = null; }
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          fullPath: fullPath,
          size: stat ? stat.size : 0,
          mtime: stat ? stat.mtimeMs : 0
        };
      });
    } catch (err) {
      console.warn('[Snip] List folder failed:', resolved, err.message);
      return [];
    }
  });

  // Home: open screenshots folder in Finder
  ipcMain.handle('open-screenshots-folder', async () => {
    shell.openPath(getScreenshotsDir());
    return true;
  });

  // Delete a screenshot (move to Trash) and remove from index
  ipcMain.handle('delete-screenshot', async (event, filepath) => {
    const baseDir = path.resolve(getScreenshotsDir());
    const resolved = path.resolve(filepath);
    if (!resolved.startsWith(baseDir)) {
      return { success: false, error: 'Path outside screenshots directory' };
    }
    try {
      console.log('[Snip] Deleting file:', resolved);
      await shell.trashItem(resolved);
      const before = readIndex().length;
      removeFromIndex(resolved);
      const after = readIndex().length;
      console.log('[Snip] Index updated: removed %d entry (%d → %d)', before - after, before, after);
      return { success: true };
    } catch (err) {
      console.error('[Snip] Delete failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Delete a folder (move to Trash) and remove all its entries from index
  ipcMain.handle('delete-folder', async (event, folderPath) => {
    const baseDir = path.resolve(getScreenshotsDir());
    const resolved = path.resolve(folderPath);
    // Don't allow deleting the root screenshots directory
    if (!resolved.startsWith(baseDir) || resolved === baseDir) {
      return { success: false, error: 'Cannot delete this directory' };
    }
    try {
      console.log('[Snip] Deleting folder:', resolved);
      await shell.trashItem(resolved);
      const before = readIndex().length;
      removeFromIndexByDir(resolved);
      const after = readIndex().length;
      console.log('[Snip] Index updated: removed %d entries (%d → %d)', before - after, before, after);
      return { success: true };
    } catch (err) {
      console.error('[Snip] Delete folder failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Refresh index: prune stale entries and regenerate missing embeddings
  ipcMain.handle('refresh-index', async () => {
    const before = readIndex().length;
    const cleaned = rebuildIndex();
    const pruned = before - cleaned.length;
    console.log('[Snip] Refresh: pruned %d stale entries', pruned);

    // Find entries missing embeddings and regenerate them
    const { generateEmbeddingForEntry } = require('./organizer/watcher');
    const needsEmbedding = cleaned.filter(e => !e.embedding && e.name && e.description);
    let generated = 0;
    for (const entry of needsEmbedding) {
      const textToEmbed = `${entry.name} ${entry.description || ''} ${(entry.tags || []).join(' ')}`;
      try {
        await generateEmbeddingForEntry(entry.path, textToEmbed);
        generated++;
      } catch (err) {
        console.warn('[Snip] Embedding failed for %s: %s', entry.filename, err.message);
      }
    }
    console.log('[Snip] Refresh: generated %d embeddings', generated);
    return { pruned, embeddings: generated };
  });

  // Shortcuts
  ipcMain.handle('get-shortcuts', async () => {
    return getShortcuts();
  });

  ipcMain.handle('get-default-shortcuts', async () => {
    return getDefaultShortcuts();
  });

  ipcMain.handle('set-shortcut', async (event, { action, accelerator }) => {
    setShortcut(action, accelerator);
    // Re-register global shortcuts if a global shortcut changed
    if ((action === 'capture' || action === 'search' || action === 'quick-snip') && reregisterShortcutsFn) {
      reregisterShortcutsFn();
    }
    if (rebuildTrayMenuFn) rebuildTrayMenuFn();
    // Broadcast to all windows
    const shortcuts = getShortcuts();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('shortcuts-changed', shortcuts);
    }
    return true;
  });

  ipcMain.handle('reset-shortcuts', async () => {
    resetShortcuts();
    if (reregisterShortcutsFn) reregisterShortcutsFn();
    if (rebuildTrayMenuFn) rebuildTrayMenuFn();
    const shortcuts = getShortcuts();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('shortcuts-changed', shortcuts);
    }
    return true;
  });

  // Theme
  ipcMain.handle('get-theme', async () => {
    return getTheme();
  });

  ipcMain.handle('set-theme', async (event, theme) => {
    setTheme(theme);
    // Broadcast to all windows
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('theme-changed', theme);
      }
    }
    return true;
  });

  // Resize editor window to fit toolbar
  ipcMain.handle('resize-editor', async (event, { minWidth }) => {
    try {
      if (!editorWindowRef || editorWindowRef.isDestroyed()) return;
      const [currentW, currentH] = editorWindowRef.getContentSize();
      if (currentW < minWidth) {
        editorWindowRef.setContentSize(minWidth, currentH);
        editorWindowRef.center();
      }
    } catch (e) {
      console.warn('[Snip] resize-editor failed:', e.message);
    }
  });
}

function getPendingEditorData() {
  return pendingEditorData;
}

function setPendingEditorData(data) {
  pendingEditorData = data;
}

module.exports = { registerIpcHandlers, getPendingEditorData, setPendingEditorData };
