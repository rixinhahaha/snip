const chokidar = require('chokidar');
const path = require('path');
const { Worker } = require('worker_threads');
const { Notification } = require('electron');
const { getScreenshotsDir, getApiKey, addCustomCategory, addToIndex } = require('../store');

let watcher = null;
let worker = null;
const pendingFiles = new Set(); // files saved by the app, awaiting agent processing

function startWatcher() {
  const watchDir = getScreenshotsDir();
  const fs = require('fs');
  fs.mkdirSync(watchDir, { recursive: true });

  // Spawn background worker thread for processing
  spawnWorker();

  watcher = chokidar.watch(watchDir, {
    ignored: /(^|[\/\\])\.|\.index\.json$/,  // ignore dotfiles and index
    persistent: true,
    depth: 0,          // only top-level files
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 200
    }
  });

  watcher.on('add', (filepath) => {
    const ext = path.extname(filepath).toLowerCase();
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) return;

    // Only run the agent on files saved by the app (not manual renames/copies)
    if (!pendingFiles.has(filepath)) {
      console.log('[Organizer] External file detected, indexing without agent:', path.basename(filepath));
      addToIndex({
        filename: path.basename(filepath),
        path: filepath,
        category: 'other',
        name: path.basename(filepath, ext),
        description: '',
        tags: [],
        embedding: null,
        createdAt: new Date().toISOString()
      });
      return;
    }
    pendingFiles.delete(filepath);

    // Check if API key is configured
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log('[Organizer] No API key — adding basic index entry:', path.basename(filepath));
      addToIndex({
        filename: path.basename(filepath),
        path: filepath,
        category: 'other',
        name: path.basename(filepath, ext),
        description: '',
        tags: [],
        embedding: null,
        createdAt: new Date().toISOString()
      });
      return;
    }

    console.log('[Organizer] Queued for processing:', path.basename(filepath));

    // Delegate to background worker thread
    if (worker) {
      worker.postMessage({ type: 'process', filepath });
    }
  });

  console.log('[Organizer] Watching:', watchDir);
  return watcher;
}

function spawnWorker() {
  const { app } = require('electron');
  const workerPath = path.join(__dirname, 'worker.js');

  worker = new Worker(workerPath, {
    workerData: {
      screenshotsDir: getScreenshotsDir(),
      configPath: path.join(app.getPath('userData'), 'snip-config.json'),
      apiKey: getApiKey() // pass decrypted key since safeStorage is unavailable in workers
    }
  });

  worker.on('message', (msg) => {
    switch (msg.type) {
      case 'ready':
        console.log('[Organizer] Worker thread ready');
        break;
      case 'done':
        console.log('[Organizer] Processed:', msg.filepath);
        // Generate embedding on main thread (ONNX crashes in worker threads)
        if (msg.finalPath && msg.textToEmbed) {
          generateEmbeddingForEntry(msg.finalPath, msg.textToEmbed);
        }
        break;
      case 'error':
        console.error('[Organizer] Error processing:', msg.filepath, msg.error);
        break;
      case 'notification':
        // Show Notification on main thread (not available in workers)
        try {
          const notification = new Notification({
            title: msg.title,
            body: msg.body
          });
          if (msg.onClickCategory) {
            notification.on('click', () => {
              addCustomCategory(msg.onClickCategory);
              console.log('[Organizer] Added new category:', msg.onClickCategory);
            });
          }
          notification.show();
        } catch (e) {
          console.warn('[Organizer] Notification failed:', e.message);
        }
        break;
    }
  });

  worker.on('error', (err) => {
    console.error('[Organizer] Worker error:', err.message);
    // Respawn worker on crash
    setTimeout(() => {
      console.log('[Organizer] Respawning worker...');
      spawnWorker();
    }, 2000);
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      console.warn('[Organizer] Worker exited with code:', code);
      setTimeout(() => {
        console.log('[Organizer] Respawning worker...');
        spawnWorker();
      }, 2000);
    }
  });
}

/**
 * Generate embedding on the main thread and update the index entry.
 * ONNX Runtime crashes inside Electron worker threads, so this must run here.
 */
async function generateEmbeddingForEntry(filepath, textToEmbed) {
  try {
    const { embedText } = require('./embeddings');
    console.log('[Organizer] Generating embedding for: "%s"', textToEmbed.slice(0, 80));
    const embedding = await embedText(textToEmbed);
    console.log('[Organizer] Embedding generated (%d dimensions)', embedding ? embedding.length : 0);

    // Update the existing index entry with the embedding
    const { readIndex, writeIndex } = require('../store');
    const index = readIndex();
    const entry = index.find(e => e.path === filepath);
    if (entry) {
      entry.embedding = Array.from(embedding);
      writeIndex(index);
      console.log('[Organizer] Index updated with embedding for: %s', path.basename(filepath));
    }
  } catch (err) {
    console.error('[Organizer] Embedding generation failed:', err.message);
  }
}

/**
 * Mark a file as app-saved so the watcher will run the agent on it.
 * Call this right after writing the screenshot to disk.
 */
function queueNewFile(filepath) {
  pendingFiles.add(filepath);
}

/**
 * Forward updated API key to the worker thread.
 */
function updateWorkerApiKey(key) {
  if (worker) {
    worker.postMessage({ type: 'update-api-key', apiKey: key });
  }
}

module.exports = { startWatcher, queueNewFile, updateWorkerApiKey };
