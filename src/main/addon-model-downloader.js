/**
 * Helper script forked by addon-manager to download HuggingFace models.
 * Runs in a child process with NODE_PATH pointing to the addon runtime.
 *
 * Environment variables:
 *   NODE_PATH             — path to addon runtime node_modules
 *   SNIP_ADDON_MODELS_PATH — where to cache downloaded models
 *   SNIP_MODEL_ID          — HuggingFace model ID (e.g. Xenova/slimsam-77-uniform)
 *   SNIP_MODEL_TYPE        — 'sam' or 'pipeline'
 */

var modelId = process.env.SNIP_MODEL_ID;
var modelType = process.env.SNIP_MODEL_TYPE;
var modelsPath = process.env.SNIP_ADDON_MODELS_PATH;

if (!modelId || !modelsPath) {
  process.send({ type: 'error', error: 'Missing SNIP_MODEL_ID or SNIP_ADDON_MODELS_PATH' });
  process.exit(1);
}

// Validate model ID to prevent downloading arbitrary models
if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(modelId)) {
  process.send({ type: 'error', error: 'Invalid model ID: ' + modelId });
  process.exit(1);
}

function progressCallback(progress) {
  if (progress.status === 'progress') {
    process.send({
      type: 'progress',
      percent: Math.round(progress.progress || 0),
      file: progress.file || '',
      loaded: progress.loaded || 0,
      total: progress.total || 0
    });
  }
}

async function main() {
  var { importTransformers } = require('./addon-resolve');
  var transformers = await importTransformers();

  // Configure cache directory and enable remote downloads
  transformers.env.cacheDir = modelsPath;
  transformers.env.allowRemoteModels = true;

  console.log('[Model Downloader] Downloading ' + modelId + ' to ' + modelsPath);

  if (modelType === 'sam') {
    // SAM model needs both SamModel and AutoProcessor — download in parallel
    await Promise.all([
      transformers.SamModel.from_pretrained(modelId, { progress_callback: progressCallback }),
      transformers.AutoProcessor.from_pretrained(modelId, { progress_callback: progressCallback })
    ]);
  } else {
    // Pipeline-based models (embeddings, upscale)
    // Determine the task from the model ID
    var task = 'feature-extraction';
    if (modelId.includes('swin2SR')) {
      task = 'image-to-image';
    }
    await transformers.pipeline(task, modelId, {
      quantized: true,
      progress_callback: progressCallback
    });
  }

  console.log('[Model Downloader] Done: ' + modelId);
  process.send({ type: 'done' });
  process.exit(0);
}

main().catch(function (err) {
  console.error('[Model Downloader] Failed:', err.message);
  process.send({ type: 'error', error: err.message });
  process.exit(1);
});
