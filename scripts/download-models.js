#!/usr/bin/env node
/**
 * Download HuggingFace models for offline bundling.
 *
 * 1. Xenova/all-MiniLM-L6-v2           — embedding model (~23 MB)
 * 2. Xenova/slimsam-77-uniform         — SAM segmentation model (~50 MB)
 *
 * Usage:
 *   node scripts/download-models.js
 *
 * Ollama models (minicpm-v) are pulled at runtime by the app — not bundled.
 *
 * Prerequisites:
 *   - @huggingface/transformers must be installed (npm install)
 */

var path = require('path');
var fs = require('fs');

var PROJECT_DIR = path.join(__dirname, '..');
var VENDOR_MODELS = path.join(PROJECT_DIR, 'vendor', 'models');

function getDirSize(dir) {
  var total = 0;
  try {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(fullPath);
      } else {
        total += fs.statSync(fullPath).size;
      }
    }
  } catch (_) {}
  return total;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

async function main() {
  console.log('Snip Model Downloader');
  console.log('=====================');
  console.log('  HuggingFace: MiniLM + SlimSAM');
  console.log('');

  fs.mkdirSync(VENDOR_MODELS, { recursive: true });

  // Dynamic import since @huggingface/transformers is ESM
  var transformers = await import('@huggingface/transformers');
  var env = transformers.env;

  // Set cache directory to vendor/models/
  env.cacheDir = VENDOR_MODELS;
  env.allowRemoteModels = true;

  // 1. MiniLM embedding model
  console.log('==> [1/2] Downloading MiniLM embedding model (Xenova/all-MiniLM-L6-v2)...');
  var pipe = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true
  });
  var testOutput = await pipe('test embedding', { pooling: 'mean', normalize: true });
  console.log('==> MiniLM loaded — embedding dim: ' + testOutput.data.length);

  // 2. SlimSAM segmentation model
  console.log('\n==> [2/2] Downloading SlimSAM model (Xenova/slimsam-77-uniform)...');
  await transformers.SamModel.from_pretrained('Xenova/slimsam-77-uniform');
  await transformers.AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform');
  console.log('==> SlimSAM model + processor loaded');

  // Summary
  console.log('\n==> Done! HF models: ' + formatBytes(getDirSize(VENDOR_MODELS)));
  console.log('These will be bundled into the app via extraResources.');
}

main().catch(function (err) {
  console.error('\nFailed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
