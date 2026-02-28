/**
 * Background worker thread for screenshot processing.
 * Runs Ollama API calls and index management off the main Electron thread
 * to keep the UI responsive.
 */
const { parentPort, workerData } = require('worker_threads');
const path = require('path');

// Initialize store with paths from main thread (electron.app unavailable in workers)
const { setExternalPaths, rebuildIndex, addToIndex } = require('../store');
setExternalPaths(workerData.screenshotsDir, workerData.configPath);

const { processScreenshot } = require('./agent');

const queue = [];
let processing = false;

parentPort.on('message', function (msg) {
  if (msg.type === 'process') {
    queue.push(msg.filepath);
    processQueue();
  }
});

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  while (queue.length > 0) {
    var filepath = queue.shift();
    console.log('[Worker] Processing (%d remaining in queue): %s', queue.length, path.basename(filepath));
    try {
      var result = await processScreenshot(filepath);
      // Rebuild index after each successful organization — prunes stale entries
      rebuildIndex();
      console.log('[Worker] Done: %s', path.basename(filepath));
      // Send embedding text to main thread (ONNX can't run in worker threads)
      parentPort.postMessage({
        type: 'done',
        filepath: path.basename(filepath),
        finalPath: result ? result.finalPath : null,
        textToEmbed: result ? result.textToEmbed : null
      });
    } catch (err) {
      console.error('[Worker] Agent failed, adding basic index entry:', err.message);
      // Still index the file so it's searchable by filename
      var fs = require('fs');
      if (fs.existsSync(filepath)) {
        addToIndex({
          filename: path.basename(filepath),
          path: filepath,
          category: 'other',
          name: path.basename(filepath, path.extname(filepath)),
          description: '',
          tags: [],
          embedding: null,
          createdAt: new Date().toISOString()
        });
      }
      parentPort.postMessage({ type: 'error', filepath: path.basename(filepath), error: err.message });
    }
    // Rate limiting — 1s delay between API calls
    if (queue.length > 0) {
      await new Promise(function (resolve) { setTimeout(resolve, 1000); });
    }
  }

  processing = false;
}

console.log('[Worker] Ready — processing screenshots in background thread');
parentPort.postMessage({ type: 'ready' });
