const chokidar = require('chokidar');
const path = require('path');
const { Worker } = require('worker_threads');
const { Notification } = require('electron');
const { getScreenshotsDir, addCustomCategory, addToIndex } = require('../store');
const { isReady } = require('../ollama-manager');

let watcher = null;
let worker = null;
const pendingFiles = new Set(); // files saved by the app, awaiting agent processing

function startWatcher() {
  var watchDir = getScreenshotsDir();
  var fs = require('fs');
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

  watcher.on('add', async function (filepath) {
    var ext = path.extname(filepath).toLowerCase();
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

    // Check if Ollama is ready
    var ollamaReady = await isReady();
    if (!ollamaReady) {
      console.log('[Organizer] Ollama not ready — adding basic index entry:', path.basename(filepath));
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
      worker.postMessage({ type: 'process', filepath: filepath });
    }
  });

  console.log('[Organizer] Watching:', watchDir);
  return watcher;
}

function spawnWorker() {
  var { app } = require('electron');
  var workerPath = path.join(__dirname, 'worker.js');

  worker = new Worker(workerPath, {
    workerData: {
      screenshotsDir: getScreenshotsDir(),
      configPath: path.join(app.getPath('userData'), 'snip-config.json')
    }
  });

  worker.on('message', function (msg) {
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
          var notification = new Notification({
            title: msg.title,
            body: msg.body
          });
          if (msg.onClickCategory) {
            notification.on('click', function () {
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

  worker.on('error', function (err) {
    console.error('[Organizer] Worker error:', err.message);
    // Respawn worker on crash
    setTimeout(function () {
      console.log('[Organizer] Respawning worker...');
      spawnWorker();
    }, 2000);
  });

  worker.on('exit', function (code) {
    if (code !== 0) {
      console.warn('[Organizer] Worker exited with code:', code);
      setTimeout(function () {
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
    var { embedText } = require('./embeddings');
    console.log('[Organizer] Generating embedding for: "%s"', textToEmbed.slice(0, 80));
    var embedding = await embedText(textToEmbed);
    console.log('[Organizer] Embedding generated (%d dimensions)', embedding ? embedding.length : 0);

    // Update the existing index entry with the embedding
    var { readIndex, writeIndex } = require('../store');
    var index = readIndex();
    var entry = index.find(function (e) { return e.path === filepath; });
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

module.exports = { startWatcher, queueNewFile };
