/**
 * Extension Sandbox Worker — runs in a forked child process.
 * Blocks dangerous Node.js modules and exposes only safe APIs.
 */
var path = require('path');

// ── Neuter dangerous process APIs before anything else ──
// These provide raw access to C++ bindings and native modules, bypassing JS-level blocks.
process.binding = function () { throw new Error('process.binding is not available in sandboxed extensions'); };
process._linkedBinding = function () { throw new Error('process._linkedBinding is not available in sandboxed extensions'); };
process.dlopen = function () { throw new Error('process.dlopen is not available in sandboxed extensions'); };

// ── Module blocklist ──
// Override require resolution to block dangerous modules (including node: prefix)
var Module = require('module');
var originalResolve = Module._resolveFilename;
var BLOCKED_MODULES = [
  'child_process', 'cluster', 'dgram', 'dns', 'net', 'tls',
  'http', 'https', 'http2', 'worker_threads', 'vm', 'v8',
  'perf_hooks', 'electron', 'fs', 'os', 'module'
];

Module._resolveFilename = function (request, parent, isMain, options) {
  // Strip node: prefix (Node 16.17+ resolves node:* through a different code path)
  var name = request.startsWith('node:') ? request.slice(5) : request;
  if (BLOCKED_MODULES.includes(name)) {
    throw new Error('Module "' + request + '" is not available in sandboxed extensions');
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

// Freeze the override so extensions cannot reassign it
Object.defineProperty(Module, '_resolveFilename', {
  value: Module._resolveFilename,
  writable: false,
  configurable: false
});

// ── Permission APIs ──
// These proxy requests to the parent process which validates permissions
var permissions = [];
try {
  permissions = JSON.parse(process.env.SNIP_EXT_PERMISSIONS || '[]');
} catch {}

var apiRequestId = 0;
var apiPending = new Map();

function callParentApi(method, args) {
  return new Promise(function (resolve, reject) {
    var id = 'api-' + (++apiRequestId);
    apiPending.set(id, { resolve: resolve, reject: reject });
    process.send({ type: 'api', id: id, method: method, args: args });
  });
}

// Expose safe APIs to extensions via a global
var ExtensionAPI = {
  readScreenshot: function (filepath) {
    return callParentApi('readScreenshot', [filepath]);
  },
  writeTemp: function (filename, data) {
    return callParentApi('writeTemp', [filename, data]);
  }
};

// ── Load extension module ──
var extDir = process.env.SNIP_EXT_DIR;
var extMain = process.env.SNIP_EXT_MAIN;

if (!extDir || !extMain) {
  console.error('[Sandbox Worker] Missing SNIP_EXT_DIR or SNIP_EXT_MAIN');
  process.exit(1);
}

var mod;
try {
  mod = require(path.join(extDir, extMain));
  if (typeof mod.init === 'function') {
    mod.init({ api: ExtensionAPI, permissions: permissions });
  }
} catch (err) {
  console.error('[Sandbox Worker] Failed to load extension:', err.message);
  process.exit(1);
}

process.send({ type: 'ready' });

// ── Message handler ──
process.on('message', function (msg) {
  // Handle API responses from parent
  if (msg.type === 'api-result' || msg.type === 'api-error') {
    var pending = apiPending.get(msg.id);
    if (pending) {
      apiPending.delete(msg.id);
      if (msg.type === 'api-result') {
        pending.resolve(msg.data);
      } else {
        pending.reject(new Error(msg.error));
      }
    }
    return;
  }

  // Handle IPC method calls from parent
  if (msg.type !== 'call') return;

  var method = mod[msg.method];
  if (typeof method !== 'function') {
    process.send({ id: msg.id, type: 'error', error: 'Method not found: ' + msg.method });
    return;
  }

  try {
    var result = method(null, ...msg.args); // null for event (not available in sandbox)
    Promise.resolve(result).then(function (data) {
      process.send({ id: msg.id, type: 'result', data: data });
    }).catch(function (err) {
      process.send({ id: msg.id, type: 'error', error: err.message || String(err) });
    });
  } catch (err) {
    process.send({ id: msg.id, type: 'error', error: err.message || String(err) });
  }
});
