const { ipcMain, clipboard, nativeImage, app, Notification, shell, BrowserWindow, screen, systemPreferences, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const platform = require('./platform');
const {
  getScreenshotsDir, getDefaultScreenshotsDir, setScreenshotsDir,
  getOllamaModel, setOllamaModel, getOllamaUrl, setOllamaUrl,
  getAllCategories, addCustomCategory, removeCustomCategory,
  getAllTagsWithDescriptions, setTagDescription, addCustomCategoryWithDescription,
  readIndex, writeIndex, removeFromIndex, removeFromIndexByDir, rebuildIndex,
  getTheme, setTheme,
  getAiEnabled, setAiEnabled,
  getFalApiKey, setFalApiKey,
  getShortcuts, getDefaultShortcuts, setShortcut, resetShortcuts,
  getMcpConfig, setMcpConfig,
  getShortcutsSkipped, setShortcutsSkipped
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

function broadcastToWindows(channel, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      if (data !== undefined) win.webContents.send(channel, data);
      else win.webContents.send(channel);
    }
  }
}

function registerIpcHandlers(getOverlayWindow, createEditorWindowFn, reregisterShortcutsFn, rebuildTrayMenuFn) {
  // Copy annotated image to clipboard
  ipcMain.handle('copy-to-clipboard', async (event, dataURL) => {
    const image = nativeImage.createFromDataURL(dataURL);
    platform.copyImageToClipboard(image, clipboard);
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
    await fs.promises.writeFile(filepath, buffer);
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

  // Screen recording permission (macOS-specific; other platforms return 'granted')
  function getScreenPermissionStatus() {
    return systemPreferences.getMediaAccessStatus
      ? systemPreferences.getMediaAccessStatus('screen')
      : 'granted';
  }

  ipcMain.handle('get-screen-permission', async () => {
    return getScreenPermissionStatus();
  });

  var screenPermissionFirstCall = true;
  ipcMain.handle('request-screen-permission', async () => {
    // CGRequestScreenCaptureAccess registers the app in the Screen Recording
    // list and shows a system dialog on first call (from a separate process).
    // On subsequent calls it does nothing silently.
    var isFirst = screenPermissionFirstCall;
    if (screenPermissionFirstCall) {
      screenPermissionFirstCall = false;
      platform.requestScreenCaptureAccess();
    }
    return { status: getScreenPermissionStatus(), firstCall: isFirst };
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
    setMcpConfig(update);
    var after = getMcpConfig();

    broadcastToWindows('mcp-config-changed', after);
    return after;
  });

  // MCP: resolve paths for client config snippet
  ipcMain.handle('get-mcp-client-config', async () => {
    var nodePath;
    var serverPath;

    if (app.isPackaged) {
      // Packaged: use bundled Node + unpacked MCP server
      nodePath = path.join(process.resourcesPath, 'node', platform.getNodeBinaryName());
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

  // CLI + AI Integration
  ipcMain.handle('install-cli', async () => {
    var { findNodeBinary } = require('./node-binary');
    var nodePath, cliPath;
    var nodeBin = platform.getNodeBinaryName();
    if (app.isPackaged) {
      nodePath = findNodeBinary() || path.join(platform.getNodeSearchPaths()[0] || '/usr/local/bin', nodeBin);
      cliPath = path.join(process.resourcesPath, 'cli', 'snip.js');
    } else {
      nodePath = findNodeBinary() || path.join(platform.getNodeSearchPaths()[0] || '/usr/local/bin', nodeBin);
      cliPath = path.join(__dirname, '..', 'cli', 'snip.js');
    }

    var wrapper = platform.getCliWrapperContent(nodePath, cliPath);
    if (!wrapper) {
      return { error: 'CLI install is not supported on this platform' };
    }

    var targets = platform.getCliInstallPaths();
    var home = require('os').homedir();
    var commonShellPaths = targets.map(function (t) { return path.dirname(t); });

    for (var target of targets) {
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, wrapper, { mode: 0o755 });
        var dir = path.dirname(target);
        var inPath = (process.env.PATH || '').split(path.delimiter).includes(dir) || commonShellPaths.includes(dir);
        return {
          installed: true,
          path: target,
          inPath: inPath,
          addToPath: inPath ? null : 'export PATH="' + dir + ':$PATH"'
        };
      } catch {}
    }
    return { error: 'Could not install CLI to any target path' };
  });

  ipcMain.handle('detect-ai-providers', async () => {
    var home = require('os').homedir();
    var providers = [];
    if (fs.existsSync(path.join(home, '.claude'))) {
      providers.push({ id: 'claude-code', name: 'Claude Code' });
    }
    if (fs.existsSync(path.join(home, '.cursor')) || fs.existsSync(path.join(home, 'Library', 'Application Support', 'Cursor'))) {
      providers.push({ id: 'cursor', name: 'Cursor' });
    }
    if (fs.existsSync(path.join(home, '.windsurf')) || fs.existsSync(path.join(home, 'Library', 'Application Support', 'Windsurf'))) {
      providers.push({ id: 'windsurf', name: 'Windsurf' });
    }
    if (fs.existsSync(path.join(home, '.cline'))) {
      providers.push({ id: 'cline', name: 'Cline' });
    }
    return providers;
  });

  // Shared: map provider ID → file path for Snip rules
  var SNIP_MARKER_START = '<!-- snip-start -->';
  var SNIP_MARKER_END = '<!-- snip-end -->';

  function getProviderFilePath(providerId) {
    var home = require('os').homedir();
    switch (providerId) {
      case 'claude-code': return path.join(home, '.claude', 'CLAUDE.md');
      case 'cursor': return path.join(home, '.cursor', 'rules', 'snip.mdc');
      case 'windsurf': return path.join(home, '.windsurf', 'rules', 'snip.md');
      case 'cline': return path.join(home, '.cline', 'rules', 'snip.md');
      default: return null;
    }
  }

  var SNIP_RULES_VERSION = 'snip-rules-v6';

  var snipRulesContent = [
    '# Snip — Visual Communication Tool',
    '<!-- ' + SNIP_RULES_VERSION + ' -->',
    'Use `snip` CLI for visual communication. You MUST run `snip --help` before your first snip call in a session.',
    '',
    '## ALWAYS use Snip for these:',
    '- **Diagrams/architecture/flows** → `echo \'<mermaid>\' | snip render --format mermaid`',
    '- **UI previews/HTML/components** → `echo \'<html>\' | snip render --format html`',
    '- **Show an image for review** → `snip open <path> --message "context"`',
    '- **Find a past screenshot** → `snip search "<query>"`',
    '- **Read text from an image** → `snip transcribe <path>`',
    '',
    'Do NOT describe visual structures in text. Render them with Snip.',
    'When the user returns from `snip open` or `snip render`, check the response — if `edited: true`, use the Read tool to view the image at the returned `path`.',
    ''
  ].join('\n');

  ipcMain.handle('check-ai-provider-status', async (event, providerId) => {
    var filePath = getProviderFilePath(providerId);
    if (!filePath) return false;
    try {
      var content = fs.readFileSync(filePath, 'utf8');
      if (providerId === 'claude-code') {
        if (!content.includes(SNIP_MARKER_START)) return false;
      }
      // Check for Snip rules identifier
      if (!content.includes('# Snip')) return false;
      // Check version — outdated if rules present but version tag missing
      if (!content.includes(SNIP_RULES_VERSION)) return 'outdated';
      return true;
    } catch { return false; }
  });

  ipcMain.handle('configure-ai-provider', async (event, providerId) => {
    var filePath = getProviderFilePath(providerId);
    if (!filePath) return { error: 'Unknown provider' };

    try {
      if (providerId === 'claude-code') {
        var block = '\n' + SNIP_MARKER_START + '\n' + snipRulesContent + SNIP_MARKER_END + '\n';
        var existing = '';
        try { existing = fs.readFileSync(filePath, 'utf8'); } catch {}
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        var startIdx = existing.indexOf(SNIP_MARKER_START);
        var endIdx = existing.indexOf(SNIP_MARKER_END);
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          // Replace existing block with updated rules
          endIdx += SNIP_MARKER_END.length;
          if (startIdx > 0 && existing[startIdx - 1] === '\n') startIdx--;
          if (endIdx < existing.length && existing[endIdx] === '\n') endIdx++;
          fs.writeFileSync(filePath, existing.slice(0, startIdx) + block + existing.slice(endIdx));
        } else {
          fs.appendFileSync(filePath, block);
        }
      } else {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, snipRulesContent);
      }
      return { configured: true, provider: providerId };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('remove-ai-provider', async (event, providerId) => {
    var filePath = getProviderFilePath(providerId);
    if (!filePath) return { error: 'Unknown provider' };

    try {
      if (providerId === 'claude-code') {
        // Remove the marked block from CLAUDE.md
        var content = '';
        try { content = fs.readFileSync(filePath, 'utf8'); } catch { return { removed: true }; }
        var startIdx = content.indexOf(SNIP_MARKER_START);
        var endIdx = content.indexOf(SNIP_MARKER_END);
        if (startIdx === -1) return { removed: true }; // already gone
        if (endIdx === -1 || endIdx < startIdx) return { removed: true }; // corrupt markers, leave file alone
        // Remove the block including surrounding newlines
        var cutStart = startIdx;
        if (cutStart > 0 && content[cutStart - 1] === '\n') cutStart--;
        var cutEnd = endIdx + SNIP_MARKER_END.length;
        if (cutEnd < content.length && content[cutEnd] === '\n') cutEnd++;
        var before = content.slice(0, cutStart);
        var after = content.slice(cutEnd);
        fs.writeFileSync(filePath, before + after);
      } else {
        fs.rmSync(filePath, { force: true });
      }
      return { removed: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('check-cli-installed', async () => {
    var targets = platform.getCliInstallPaths();
    for (var target of targets) {
      if (fs.existsSync(target)) {
        try {
          var content = fs.readFileSync(target, 'utf8');
          // Verify this is our wrapper, not another app's binary
          if (content.indexOf('Snip CLI') === -1) continue;
          // Verify the wrapper still points to a valid node binary
          var match = content.match(/exec ['"]([^'"]+)['"]/);
          if (match && match[1] && !fs.existsSync(match[1])) {
            return 'stale'; // wrapper exists but points to deleted app
          }
          return true;
        } catch { continue; }
      }
    }
    return false;
  });

  ipcMain.handle('uninstall-cli', async () => {
    var targets = platform.getCliInstallPaths();
    var removed = false;
    for (var target of targets) {
      try {
        fs.rmSync(target, { force: true });
        removed = true;
      } catch {}
    }
    return { removed: removed };
  });

  // Platform dependency check (Wayland clipboard, portal screenshot on Linux; no-op elsewhere)
  ipcMain.handle('check-linux-deps', async () => {
    return platform.checkDependencies();
  });

  ipcMain.handle('get-shortcuts-skipped', async () => {
    return getShortcutsSkipped();
  });

  ipcMain.handle('set-shortcuts-skipped', async (event, skipped) => {
    setShortcutsSkipped(skipped);
    return true;
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

  // Settings: Add-ons (optional AI features)
  var addonManager = require('./addon-manager');

  function isValidAddonName(name) {
    return typeof name === 'string' && addonManager.ADDON_DEFS.hasOwnProperty(name);
  }

  ipcMain.handle('get-addon-status', async () => {
    return addonManager.getStatus();
  });

  ipcMain.handle('install-addon', async (event, addonName) => {
    if (!isValidAddonName(addonName)) return { success: false, error: 'Invalid addon name' };
    try {
      await addonManager.installAddon(addonName, function (progress) {
        broadcastToWindows('addon-download-progress', {
          addon: addonName,
          phase: progress.phase,
          percent: progress.percent || 0,
          received: progress.received || 0,
          total: progress.total || 0
        });
      });
      broadcastToWindows('addon-status-changed', addonManager.getStatus());
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('remove-addon', async (event, addonName) => {
    if (!isValidAddonName(addonName)) return { success: false, error: 'Invalid addon name' };
    addonManager.removeAddon(addonName);
    broadcastToWindows('addon-status-changed', addonManager.getStatus());
    return { success: true };
  });

  ipcMain.handle('cancel-addon-download', async (event, addonName) => {
    if (!isValidAddonName(addonName)) return { success: false, error: 'Invalid addon name' };
    addonManager.cancelDownload(addonName);
    return { success: true };
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

  // Search: get thumbnail (path-validated to screenshots dir)
  ipcMain.handle('get-thumbnail', async (event, filepath) => {
    try {
      var screenshotsDir = getScreenshotsDir();
      var resolved = path.resolve(filepath);
      if (!resolved.startsWith(screenshotsDir + path.sep) && resolved !== screenshotsDir) return null;
      // GIFs: return full file as data URL (nativeImage strips animation)
      if (resolved.toLowerCase().endsWith('.gif')) {
        const buf = fs.readFileSync(resolved);
        return 'data:image/gif;base64,' + buf.toString('base64');
      }
      const image = nativeImage.createFromPath(resolved);
      const resized = image.resize({ width: 200 });
      return resized.toDataURL();
    } catch (err) {
      console.warn('[Snip] Thumbnail failed:', filepath, err.message);
      return null;
    }
  });

  // Reveal in Finder (path-validated to screenshots dir)
  ipcMain.handle('reveal-in-finder', async (event, filepath) => {
    var screenshotsDir = getScreenshotsDir();
    var resolved = path.resolve(filepath);
    if (!resolved.startsWith(screenshotsDir + path.sep) && resolved !== screenshotsDir) return false;
    shell.showItemInFolder(resolved);
    return true;
  });

  ipcMain.handle('open-external-url', async (event, url) => {
    if (typeof url !== 'string' || (!url.startsWith('https://') && !url.startsWith('http://') && !url.startsWith('x-apple.systempreferences:'))) {
      return false;
    }
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
      const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
      return Promise.all(entries.map(async entry => {
        const fullPath = path.join(resolved, entry.name);
        let stat;
        try { stat = await fs.promises.stat(fullPath); } catch { stat = null; }
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          fullPath: fullPath,
          size: stat ? stat.size : 0,
          mtime: stat ? stat.mtimeMs : 0
        };
      }));
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

  // Save location: get default path
  ipcMain.handle('get-default-screenshots-dir', async () => {
    return getDefaultScreenshotsDir();
  });

  // Save location: open native folder picker
  ipcMain.handle('choose-screenshots-dir', async () => {
    var result = await dialog.showOpenDialog({
      title: 'Choose Save Location',
      defaultPath: getScreenshotsDir(),
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  // Save location: change directory with optional migration
  ipcMain.handle('set-screenshots-dir', async (event, { newDir, migration }) => {
    // Validate migration option
    if (!['copy', 'move', 'none'].includes(migration)) {
      return { error: 'Invalid migration option' };
    }

    var oldDir = getScreenshotsDir();
    var resolvedNew = path.resolve(newDir);
    var resolvedOld = path.resolve(oldDir);

    // Validate: same directory
    if (resolvedNew === resolvedOld) {
      return { success: true, noChange: true };
    }

    // Validate: writable (also ensures resolvedNew exists for realpath below)
    try {
      await fs.promises.mkdir(resolvedNew, { recursive: true });
      var testFile = path.join(resolvedNew, '.snip-write-test');
      await fs.promises.writeFile(testFile, 'test');
      await fs.promises.unlink(testFile);
    } catch (err) {
      return { error: 'Cannot write to selected folder: ' + err.message };
    }

    // Resolve symlinks for accurate containment check
    try { resolvedNew = await fs.promises.realpath(resolvedNew); } catch (_) {}
    try { resolvedOld = await fs.promises.realpath(resolvedOld); } catch (_) {}

    // Validate: new dir is not inside old dir (would create recursive structure)
    if (resolvedNew.startsWith(resolvedOld + path.sep)) {
      return { error: 'Cannot use a subfolder of the current save location' };
    }

    // Re-check same directory after symlink resolution
    if (resolvedNew === resolvedOld) {
      return { success: true, noChange: true };
    }

    var { restartWatcher } = require('./organizer/watcher');

    try {
      if (migration === 'copy' || migration === 'move') {
        // Copy files from old to new, skipping symlinks (async to avoid blocking main process)
        var entries = await fs.promises.readdir(resolvedOld, { withFileTypes: true });
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.name === '.index.json' || entry.name === '.tmp') continue;
          if (entry.name.startsWith('.snip-write-test')) continue;
          var src = path.join(resolvedOld, entry.name);
          // Skip symlinks to avoid copying files outside the screenshots tree
          var stat = await fs.promises.lstat(src);
          if (stat.isSymbolicLink()) continue;
          var dest = path.join(resolvedNew, entry.name);
          if (stat.isDirectory()) {
            await fs.promises.cp(src, dest, { recursive: true });
          } else if (stat.isFile()) {
            await fs.promises.copyFile(src, dest);
          }
        }

        // Rewrite index paths (use path.sep to avoid prefix-collision with similarly-named dirs)
        var index = readIndex();
        var oldPrefix = resolvedOld + path.sep;
        for (var j = 0; j < index.length; j++) {
          if (index[j].path && index[j].path.startsWith(oldPrefix)) {
            index[j].path = resolvedNew + path.sep + index[j].path.slice(oldPrefix.length);
          }
        }
        // Write index to new location (setScreenshotsDir changes where getIndexPath points)
        setScreenshotsDir(resolvedNew);
        writeIndex(index);

        // Remove old files if moving
        if (migration === 'move') {
          for (var k = 0; k < entries.length; k++) {
            var rmSrc = path.join(resolvedOld, entries[k].name);
            try { await fs.promises.rm(rmSrc, { recursive: true, force: true }); } catch (_) {}
          }
          try { await fs.promises.unlink(path.join(resolvedOld, '.index.json')); } catch (_) {}
        }
      } else {
        // 'none' — start fresh
        setScreenshotsDir(resolvedNew);
        writeIndex([]);
      }
    } catch (err) {
      return { error: 'Migration failed: ' + err.message };
    }

    // Restart watcher on new directory
    restartWatcher();

    // Broadcast change to all windows
    broadcastToWindows('screenshots-dir-changed', resolvedNew);

    return { success: true };
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
      var remaining = removeFromIndex(resolved);
      console.log('[Snip] Index updated: %d entries remaining', remaining.length);
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
      var remaining = removeFromIndexByDir(resolved);
      console.log('[Snip] Index updated: %d entries remaining', remaining.length);
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
    broadcastToWindows('shortcuts-changed', getShortcuts());
    return true;
  });

  ipcMain.handle('reset-shortcuts', async () => {
    resetShortcuts();
    if (reregisterShortcutsFn) reregisterShortcutsFn();
    if (rebuildTrayMenuFn) rebuildTrayMenuFn();
    broadcastToWindows('shortcuts-changed', getShortcuts());
    return true;
  });

  // Compositor shortcuts (Wayland)
  var VALID_SHORTCUT_ACTIONS = ['capture', 'search'];

  ipcMain.handle('get-shortcut-mode', async () => {
    return platform.getShortcutMode();
  });

  ipcMain.handle('install-compositor-shortcut', async (event, { action, binding }) => {
    if (!VALID_SHORTCUT_ACTIONS.includes(action)) throw new Error('Invalid action');
    if (typeof binding !== 'string' || binding.length > 100) throw new Error('Invalid binding');
    return platform.installCompositorShortcut(action, binding);
  });

  ipcMain.handle('check-compositor-shortcut', async (event, { action }) => {
    if (!VALID_SHORTCUT_ACTIONS.includes(action)) return { installed: false, binding: null, unsupported: true };
    return platform.checkCompositorShortcut(action);
  });

  // Theme
  ipcMain.handle('get-theme', async () => {
    return getTheme();
  });

  ipcMain.handle('set-theme', async (event, theme) => {
    setTheme(theme);
    broadcastToWindows('theme-changed', theme);
    return true;
  });

}

function getPendingEditorData() {
  return pendingEditorData;
}

function setPendingEditorData(data) {
  pendingEditorData = data;
}

function setEditorWindowRef(win) {
  editorWindowRef = win;
}

module.exports = { registerIpcHandlers, getPendingEditorData, setPendingEditorData, setEditorWindowRef };
