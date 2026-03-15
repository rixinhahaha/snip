const path = require('path');
const fs = require('fs');
const { ipcMain, app } = require('electron');

const EXTENSIONS_DIR = path.join(__dirname, '..', 'extensions');

let extensions = [];
let context = null;

/**
 * Validate that a manifest has the required shape. Returns true if valid.
 */
function validateManifest(manifest, name) {
  if (typeof manifest.name !== 'string' || !manifest.name) {
    console.warn('[Extensions] %s: manifest missing or invalid "name" field — skipping', name);
    return false;
  }
  if (manifest.ipc !== undefined) {
    if (!Array.isArray(manifest.ipc)) {
      console.warn('[Extensions] %s: "ipc" must be an array — skipping', name);
      return false;
    }
    for (var i = 0; i < manifest.ipc.length; i++) {
      var entry = manifest.ipc[i];
      if (!entry || typeof entry !== 'object' || typeof entry.channel !== 'string' || typeof entry.method !== 'string') {
        console.warn('[Extensions] %s: ipc[%d] must have string "channel" and "method" — skipping', name, i);
        return false;
      }
    }
  }
  if (manifest.toolbarPosition !== undefined && typeof manifest.toolbarPosition !== 'number') {
    console.warn('[Extensions] %s: "toolbarPosition" must be a number — skipping', name);
    return false;
  }
  return true;
}

/**
 * Validate extension name is safe for use in path.join.
 */
function isNameSafe(name) {
  return typeof name === 'string' && name.length > 0 &&
    !name.includes('..') && !name.includes('/') && !name.includes('\\') && !path.isAbsolute(name);
}

/**
 * Load a single extension from a directory. Returns the manifest or null.
 */
function loadExtension(extDir, name, source) {
  var manifestPath = path.join(extDir, name, 'extension.json');
  if (!fs.existsSync(manifestPath)) {
    console.warn('[Extensions] %s: extension.json not found', name);
    return null;
  }

  try {
    var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!validateManifest(manifest, name)) return null;

    // User extensions: restrict to action-tool and processor types
    if (source === 'user' && manifest.type !== 'action-tool' && manifest.type !== 'processor') {
      console.warn('[Extensions] User extension %s: only action-tool and processor types are supported — skipping', name);
      return null;
    }

    // User extensions: all IPC channels must use ext: prefix
    if (source === 'user' && Array.isArray(manifest.ipc)) {
      for (var i = 0; i < manifest.ipc.length; i++) {
        if (!manifest.ipc[i].channel.startsWith('ext:')) {
          console.warn('[Extensions] User extension %s: channel "%s" must use ext: prefix — skipping', name, manifest.ipc[i].channel);
          return null;
        }
      }
    }

    manifest._dir = path.join(extDir, name);
    manifest._source = source;
    return manifest;
  } catch (err) {
    console.warn('[Extensions] Failed to load %s: %s', name, err.message);
    return null;
  }
}

/**
 * Load bundled extensions from extensions.json + user extensions from userData.
 */
function loadAll() {
  extensions = [];

  // ── Bundled extensions (trusted, from extensions.json) ──
  var registryPath = path.join(EXTENSIONS_DIR, 'extensions.json');
  try {
    var activeNames = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (Array.isArray(activeNames)) {
      for (var name of activeNames) {
        if (!isNameSafe(name)) {
          console.warn('[Extensions] Skipping unsafe extension name: %s', name);
          continue;
        }
        var manifest = loadExtension(EXTENSIONS_DIR, name, 'builtin');
        if (manifest) extensions.push(manifest);
      }
    }
  } catch {
    console.warn('[Extensions] extensions.json not found or invalid at:', registryPath);
  }

  // ── User extensions (untrusted, from userData directory) ──
  var userExtDir = getUserExtensionsDir();
  try {
    var userDirs = fs.readdirSync(userExtDir, { withFileTypes: true });
    for (var entry of userDirs) {
      if (!entry.isDirectory()) continue;
      if (!isNameSafe(entry.name)) continue;
      var manifest = loadExtension(userExtDir, entry.name, 'user');
      if (manifest) extensions.push(manifest);
    }
  } catch {
    // User extensions directory doesn't exist yet — that's fine
  }

  extensions.sort(function (a, b) {
    return (a.toolbarPosition || 999) - (b.toolbarPosition || 999);
  });

  var builtinCount = extensions.filter(function (e) { return e._source === 'builtin'; }).length;
  var userCount = extensions.filter(function (e) { return e._source === 'user'; }).length;
  console.log('[Extensions] Loaded %d extensions (%d builtin, %d user): %s',
    extensions.length, builtinCount, userCount,
    extensions.map(function (e) { return e.name; }).join(', '));
}

/**
 * Get the user extensions directory path.
 */
function getUserExtensionsDir() {
  return path.join(app.getPath('userData'), 'extensions');
}

/**
 * Set the shared context object that extension main modules receive.
 */
function setContext(ctx) {
  context = ctx;
}

/**
 * Require and initialize extension main modules, then register their IPC handlers.
 * Builtin extensions run in-process via require().
 * User extensions run in a sandboxed child process.
 */
function registerIpcHandlers() {
  var sandbox = null; // lazy-loaded

  for (const ext of extensions) {
    if (!ext.main || !ext.ipc || ext.ipc.length === 0) continue;

    // Prevent path escape via crafted main field
    if (ext.main.includes('..') || path.isAbsolute(ext.main)) {
      console.warn('[Extensions] %s: main field contains path escape — skipping', ext.name);
      continue;
    }

    // ── User extensions: sandboxed child process ──
    if (ext._source === 'user') {
      if (!sandbox) sandbox = require('./extension-sandbox');
      try {
        sandbox.startExtension(ext);
      } catch (err) {
        console.warn('[Extensions] Failed to start sandbox for %s: %s', ext.name, err.message);
        continue;
      }

      for (const ipcEntry of ext.ipc) {
        if (ipcMain.listenerCount(ipcEntry.channel) > 0) {
          console.warn('[Extensions] %s: channel "%s" already registered — skipping', ext.name, ipcEntry.channel);
          continue;
        }
        (function (extName, method, channel) {
          ipcMain.handle(channel, function (event, ...args) {
            return sandbox.callExtension(extName, method, ...args);
          });
        })(ext.name, ipcEntry.method, ipcEntry.channel);
      }

      console.log('[Extensions] Registered %d sandboxed IPC handlers for %s', ext.ipc.length, ext.name);
      continue;
    }

    // ── Builtin extensions: in-process require() ──

    // Prevent path escape via renderer field
    if (ext.renderer && (ext.renderer.includes('..') || path.isAbsolute(ext.renderer))) {
      var absRendererPath = path.resolve(ext._dir, ext.renderer);
      var realRendererPath;
      try { realRendererPath = fs.realpathSync(absRendererPath); } catch { realRendererPath = absRendererPath; }
      var appRoot = path.resolve(__dirname, '..', '..');
      if (!realRendererPath.startsWith(appRoot + path.sep)) {
        console.warn('[Extensions] %s: renderer field escapes app directory — skipping', ext.name);
        continue;
      }
    }

    // Verify main module path resolves inside app (symlink protection)
    var mainPath = path.join(ext._dir, ext.main);
    try {
      var realMainPath = fs.realpathSync(mainPath);
      var appRoot = path.resolve(__dirname, '..', '..');
      if (!realMainPath.startsWith(appRoot + path.sep)) {
        console.warn('[Extensions] %s: main module resolves outside app via symlink — skipping', ext.name);
        continue;
      }
    } catch {
      // File doesn't exist yet — will fail at require() below
    }

    let mod;
    try {
      mod = require(mainPath);
      if (typeof mod.init === 'function') {
        mod.init(context);
      }
    } catch (err) {
      console.warn('[Extensions] Failed to require %s main module: %s', ext.name, err.message);
      continue;
    }

    for (const ipcEntry of ext.ipc) {
      if (ipcMain.listenerCount(ipcEntry.channel) > 0) {
        console.warn('[Extensions] %s: channel "%s" already registered — skipping', ext.name, ipcEntry.channel);
        continue;
      }

      const method = mod[ipcEntry.method];
      if (typeof method !== 'function') {
        console.warn('[Extensions] %s: method "%s" not found in main module', ext.name, ipcEntry.method);
        continue;
      }

      if (ipcEntry.type === 'on') {
        ipcMain.on(ipcEntry.channel, function (event, ...args) {
          try {
            method.call(mod, event, ...args);
          } catch (err) {
            console.error('[Extensions] %s IPC handler error on %s:', ext.name, ipcEntry.channel, err.message);
          }
        });
      } else {
        ipcMain.handle(ipcEntry.channel, function (event, ...args) {
          return method.call(mod, event, ...args);
        });
      }
    }

    console.log('[Extensions] Registered %d IPC handlers for %s', ext.ipc.length, ext.name);
  }
}

/**
 * Load and register a single user extension (hot-load after install).
 */
function loadUserExtension(name) {
  if (!isNameSafe(name)) return false;
  var userExtDir = getUserExtensionsDir();
  var manifest = loadExtension(userExtDir, name, 'user');
  if (!manifest) return false;

  extensions.push(manifest);

  // Register IPC via sandbox
  if (manifest.main && manifest.ipc && manifest.ipc.length > 0) {
    var sandbox = require('./extension-sandbox');
    try {
      sandbox.startExtension(manifest);
    } catch (err) {
      console.warn('[Extensions] Failed to start sandbox for %s: %s', name, err.message);
      return false;
    }

    for (var ipcEntry of manifest.ipc) {
      if (ipcMain.listenerCount(ipcEntry.channel) > 0) continue;
      (function (extName, method, channel) {
        ipcMain.handle(channel, function (event, ...args) {
          return sandbox.callExtension(extName, method, ...args);
        });
      })(manifest.name, ipcEntry.method, ipcEntry.channel);
    }
  }

  console.log('[Extensions] Hot-loaded user extension: %s', name);
  return true;
}

/**
 * Return all non-processor extensions.
 */
function getToolExtensions() {
  return extensions.filter(function (e) {
    return e.type !== 'processor';
  });
}

/**
 * Return serializable extension data for sending to renderer.
 */
function getRendererManifest() {
  var rendererDir = path.join(__dirname, '..', 'renderer');

  return getToolExtensions().map(function (ext) {
    var rendererPath = null;
    if (ext.renderer) {
      var absPath = path.resolve(ext._dir, ext.renderer);
      rendererPath = path.relative(rendererDir, absPath);
    }

    return {
      name: ext.name,
      displayName: ext.displayName,
      type: ext.type,
      toolId: ext.toolId,
      buttonId: ext.buttonId,
      icon: ext.icon,
      tooltip: ext.tooltip,
      shortcut: ext.shortcut,
      toolbarPosition: ext.toolbarPosition,
      hidden: ext.hidden || false,
      toolbarGroups: ext.toolbarGroups || [],
      renderer: rendererPath
    };
  });
}

/**
 * Call a lifecycle hook on all builtin extensions that export it.
 */
function callExtensionHook(hookName) {
  for (const ext of extensions) {
    if (!ext.main || ext._source !== 'builtin') continue;
    try {
      var mainPath = path.join(ext._dir, ext.main);
      var mod = require(mainPath);
      if (typeof mod[hookName] === 'function') {
        var result = mod[hookName]();
        if (result && typeof result.catch === 'function') {
          result.catch(function (err) {
            console.warn('[Extensions] %s %s() rejected: %s', ext.name, hookName, err.message);
          });
        }
      }
    } catch (err) {
      console.warn('[Extensions] %s %s() failed: %s', ext.name, hookName, err.message);
    }
  }
}

function killWorkers() {
  callExtensionHook('killWorker');
  // Also kill sandboxed user extension processes
  try {
    var sandbox = require('./extension-sandbox');
    sandbox.killAll();
  } catch {}
}

function warmUp() {
  callExtensionHook('warmUp');
}

/**
 * Return user-installed extensions (for settings UI).
 */
function getUserExtensions() {
  return extensions
    .filter(function (e) { return e._source === 'user'; })
    .map(function (e) {
      return { name: e.name, displayName: e.displayName, type: e.type, permissions: e.permissions || [] };
    });
}

/**
 * Remove a user-installed extension by name.
 */
function removeUserExtension(name) {
  if (!isNameSafe(name)) return false;
  var userExtDir = getUserExtensionsDir();
  var extDir = path.join(userExtDir, name);
  if (!fs.existsSync(extDir)) return false;

  // Kill sandboxed process
  try {
    var sandbox = require('./extension-sandbox');
    sandbox.killExtension(name);
  } catch {}

  // Remove IPC handlers
  var ext = extensions.find(function (e) { return e.name === name && e._source === 'user'; });
  if (ext && ext.ipc) {
    for (var entry of ext.ipc) {
      try { ipcMain.removeHandler(entry.channel); } catch {}
    }
  }

  // Remove from array
  extensions = extensions.filter(function (e) { return !(e.name === name && e._source === 'user'); });

  // Delete directory
  fs.rmSync(extDir, { recursive: true, force: true });
  console.log('[Extensions] Removed user extension: %s', name);
  return true;
}

module.exports = {
  loadAll, setContext, registerIpcHandlers, getToolExtensions,
  getRendererManifest, killWorkers, warmUp, loadUserExtension,
  getUserExtensionsDir, getUserExtensions, removeUserExtension, validateManifest
};
