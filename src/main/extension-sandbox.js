/**
 * Extension Sandbox — manages sandboxed child processes for user extensions.
 * Reuses the proven child_process.fork pattern from segmentation.js / upscaler.js.
 */
const path = require('path');
const { findNodeBinary } = require('./node-binary');

var workers = new Map(); // extensionName -> { child, pendingRequests, nextId }

var WORKER_PATH = path.join(__dirname, 'extension-sandbox-worker.js');

// Handle asar-packed path
if (WORKER_PATH.includes('app.asar')) {
  WORKER_PATH = WORKER_PATH.replace('app.asar', 'app.asar.unpacked');
}

var CALL_TIMEOUT = 30000; // 30 seconds per IPC call

/**
 * Start a sandboxed child process for an extension.
 */
function startExtension(ext) {
  if (workers.has(ext.name)) return;

  var nodeBin = findNodeBinary();
  var env = {};
  // Only pass safe env vars — don't inherit full process.env to the sandbox
  env.SNIP_EXT_DIR = ext._dir;
  env.SNIP_EXT_MAIN = ext.main;
  env.SNIP_EXT_PERMISSIONS = JSON.stringify(ext.permissions || []);
  if (nodeBin) {
    // Using system Node — no special env needed
  } else {
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  // PATH is needed for the child process to function
  env.PATH = process.env.PATH || '';

  var child = require('child_process').fork(WORKER_PATH, [], {
    execPath: nodeBin || process.execPath,
    env: env,
    serialization: 'advanced',
    stdio: ['pipe', 'inherit', 'inherit', 'ipc']
  });

  var pendingRequests = new Map();
  var requestId = 0;

  child.on('message', function (msg) {
    if (msg.type === 'ready') {
      console.log('[Sandbox] %s ready', ext.name);
      return;
    }

    // Handle permission API requests from the worker
    if (msg.type === 'api') {
      handleApiRequest(ext, child, msg);
      return;
    }

    var pending = pendingRequests.get(msg.id);
    if (!pending) return;
    pendingRequests.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.type === 'result') {
      pending.resolve(msg.data);
    } else {
      pending.reject(new Error(msg.error || 'Extension error'));
    }
  });

  child.on('exit', function (code) {
    console.warn('[Sandbox] %s exited with code %s', ext.name, code);
    for (var [, p] of pendingRequests) {
      clearTimeout(p.timer);
      p.reject(new Error('Extension process exited'));
    }
    pendingRequests.clear();
    workers.delete(ext.name);
  });

  workers.set(ext.name, {
    child: child,
    pendingRequests: pendingRequests,
    ext: ext,
    nextId: function () { return ++requestId; }
  });
}

/**
 * Handle permission API requests from sandboxed workers.
 */
function handleApiRequest(ext, child, msg) {
  var permissions = ext.permissions || [];
  var id = msg.id;

  if (msg.method === 'readScreenshot') {
    if (!permissions.includes('screenshots:read')) {
      child.send({ id: id, type: 'api-error', error: 'Permission denied: screenshots:read' });
      return;
    }
    try {
      var store = require('./store');
      var screenshotsDir = store.getScreenshotsDir();
      var filepath = path.resolve(msg.args[0]);
      var base = path.resolve(screenshotsDir);
      if (!filepath.startsWith(base + path.sep)) {
        child.send({ id: id, type: 'api-error', error: 'Path outside screenshots directory' });
        return;
      }
      var data = require('fs').readFileSync(filepath);
      child.send({ id: id, type: 'api-result', data: data });
    } catch (err) {
      child.send({ id: id, type: 'api-error', error: err.message });
    }
    return;
  }

  if (msg.method === 'writeTemp') {
    if (!permissions.includes('temp:write')) {
      child.send({ id: id, type: 'api-error', error: 'Permission denied: temp:write' });
      return;
    }
    try {
      var app = require('electron').app;
      var tempDir = path.join(app.getPath('temp'), 'snip-ext-' + ext.name);
      require('fs').mkdirSync(tempDir, { recursive: true });
      var filename = String(msg.args[0]).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      var tempPath = path.resolve(path.join(tempDir, filename));
      if (!tempPath.startsWith(tempDir + path.sep)) {
        child.send({ id: id, type: 'api-error', error: 'Invalid filename' });
        return;
      }
      require('fs').writeFileSync(tempPath, Buffer.from(msg.args[1]));
      child.send({ id: id, type: 'api-result', data: tempPath });
    } catch (err) {
      child.send({ id: id, type: 'api-error', error: err.message });
    }
    return;
  }

  child.send({ id: id, type: 'api-error', error: 'Unknown API method: ' + msg.method });
}

/**
 * Call a method on a sandboxed extension. Returns a Promise.
 */
function callExtension(extName, method, ...args) {
  var w = workers.get(extName);
  if (!w) return Promise.reject(new Error('Extension "' + extName + '" is not running'));

  var id = w.nextId();

  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      w.pendingRequests.delete(id);
      // Kill the child on timeout — it will be restarted on next call
      if (w.child && !w.child.killed) w.child.kill();
      reject(new Error('Extension call timed out (30s)'));
    }, CALL_TIMEOUT);

    w.pendingRequests.set(id, { resolve: resolve, reject: reject, timer: timer });
    w.child.send({ id: id, type: 'call', method: method, args: args });
  });
}

/**
 * Kill all sandboxed extension processes.
 */
function killAll() {
  for (var [name, w] of workers) {
    if (w.child && !w.child.killed) w.child.kill();
    for (var [, p] of w.pendingRequests) {
      clearTimeout(p.timer);
    }
  }
  workers.clear();
}

/**
 * Kill a single sandboxed extension process.
 */
function killExtension(name) {
  var w = workers.get(name);
  if (w) {
    if (w.child && !w.child.killed) w.child.kill();
    for (var [, p] of w.pendingRequests) clearTimeout(p.timer);
    workers.delete(name);
  }
}

module.exports = { startExtension, callExtension, killAll, killExtension };
