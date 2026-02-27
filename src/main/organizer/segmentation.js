/**
 * Segmentation module — spawns SAM inference in an isolated child process
 * using the system Node.js binary (not Electron's) because ONNX runtime
 * crashes (SIGTRAP) inside Electron's V8.
 */
const child_process = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let worker = null;
let requestId = 0;
const pendingRequests = new Map();
let resolvedNodePath = null;

/**
 * Find the system Node.js binary. Searches NVM, common paths, PATH, and FNM.
 */
function findNodeBinary() {
  if (resolvedNodePath) return resolvedNodePath;

  const candidates = [];

  const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    const versions = fs.readdirSync(nvmDir).sort();
    for (let i = versions.length - 1; i >= 0; i--) {
      candidates.push(path.join(nvmDir, versions[i], 'bin', 'node'));
    }
  } catch (_) {}

  candidates.push('/usr/local/bin/node');
  candidates.push('/opt/homebrew/bin/node');

  const pathDirs = (process.env.PATH || '').split(':');
  for (const dir of pathDirs) {
    if (dir) candidates.push(path.join(dir, 'node'));
  }

  const fnmDir = path.join(os.homedir(), '.local', 'share', 'fnm', 'node-versions');
  try {
    const versions = fs.readdirSync(fnmDir).sort();
    for (let i = versions.length - 1; i >= 0; i--) {
      candidates.push(path.join(fnmDir, versions[i], 'installation', 'bin', 'node'));
    }
  } catch (_) {}

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      resolvedNodePath = candidate;
      return candidate;
    } catch (_) {}
  }

  console.warn('[Segmentation] Could not find system Node.js, falling back to Electron binary');
  return null;
}

function getWorker() {
  if (worker && worker.connected && !worker.killed) return worker;

  const workerScript = path.join(__dirname, 'segmentation-worker.js');
  const nodeBin = findNodeBinary();

  const forkOptions = {
    serialization: 'advanced',
    stdio: ['pipe', 'inherit', 'inherit', 'ipc']
  };

  if (nodeBin) {
    forkOptions.execPath = nodeBin;
  } else {
    forkOptions.env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  }

  worker = child_process.fork(workerScript, [], forkOptions);

  worker.on('message', (msg) => {
    if (msg.type === 'ready') return;
    const pending = pendingRequests.get(msg.id);
    if (pending) {
      pendingRequests.delete(msg.id);
      if (msg.type === 'error') {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.data);
      }
    }
  });

  worker.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn('[Segmentation] Worker exited unexpectedly, code:', code, 'signal:', signal);
    }
    worker = null;
    for (const [id, { reject }] of pendingRequests) {
      reject(new Error('Segmentation worker crashed (signal: ' + (signal || code) + ')'));
    }
    pendingRequests.clear();
  });

  worker.on('error', (err) => {
    console.error('[Segmentation] Worker error:', err.message);
  });

  return worker;
}

function checkSupport() {
  const totalMem = os.totalmem();
  if (totalMem < 4 * 1024 * 1024 * 1024) {
    return { supported: false, reason: 'Insufficient memory (need 4GB+)' };
  }
  const nodeBin = findNodeBinary();
  if (!nodeBin) {
    return { supported: false, reason: 'Node.js binary not found' };
  }
  return { supported: true };
}

function generateMask(rgbaPixels, imgWidth, imgHeight, points, cssWidth, cssHeight) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const w = getWorker();
    pendingRequests.set(id, { resolve, reject });

    w.send({
      id,
      type: 'generate-mask',
      rgbaBuffer: Buffer.from(rgbaPixels.buffer, rgbaPixels.byteOffset, rgbaPixels.byteLength),
      imgWidth,
      imgHeight,
      points,
      cssWidth,
      cssHeight
    });
  });
}

function warmUp() {
  const support = checkSupport();
  if (!support.supported) return;
  try {
    const w = getWorker();
    w.send({ type: 'warm-up' });
  } catch (err) {
    console.warn('[Segmentation] Warm-up failed:', err.message);
  }
}

module.exports = { generateMask, checkSupport, warmUp };
