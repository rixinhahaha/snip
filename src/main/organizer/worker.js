/**
 * Background worker thread for screenshot processing.
 * Runs Claude API calls, embedding generation, and index management
 * off the main Electron thread to keep the UI responsive.
 */
const { parentPort, workerData } = require('worker_threads');
const path = require('path');

// Initialize store with paths from main thread (electron.app unavailable in workers)
const { setExternalPaths, rebuildIndex, addToIndex } = require('../store');
setExternalPaths(workerData.screenshotsDir, workerData.configPath);

const { processScreenshot, setWorkerApiKey } = require('./agent');

// Receive decrypted API key from main thread (safeStorage unavailable in workers)
if (workerData.apiKey) {
  setWorkerApiKey(workerData.apiKey);
}

const queue = [];
let processing = false;

parentPort.on('message', (msg) => {
  if (msg.type === 'process') {
    queue.push(msg.filepath);
    processQueue();
  } else if (msg.type === 'update-api-key') {
    setWorkerApiKey(msg.apiKey);
  }
});

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  while (queue.length > 0) {
    const filepath = queue.shift();
    console.log('[Worker] Processing (%d remaining in queue): %s', queue.length, path.basename(filepath));
    try {
      const result = await processScreenshot(filepath);
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
      const fs = require('fs');
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
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  processing = false;
}

console.log('[Worker] Ready — processing screenshots in background thread');
parentPort.postMessage({ type: 'ready' });
