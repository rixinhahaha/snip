#!/usr/bin/env node
/**
 * Download ALL models for offline bundling.
 *
 * 1. Ollama model (minicpm-v)          — pulled via temporary Ollama server (~5 GB)
 * 2. Xenova/all-MiniLM-L6-v2           — HuggingFace embedding model (~23 MB)
 * 3. Xenova/slimsam-77-uniform         — HuggingFace SAM model (~50 MB)
 *
 * Usage:
 *   node scripts/download-models.js               # download all models
 *   node scripts/download-models.js --hf           # HuggingFace models only (MiniLM + SlimSAM)
 *   node scripts/download-models.js --ollama       # Ollama model only (minicpm-v)
 *   node scripts/download-models.js --force        # force re-pull (clean partial downloads)
 *
 * Prerequisites:
 *   - Ollama binary must exist at vendor/ollama/ollama (run: npm run download-ollama)
 *   - @huggingface/transformers must be installed (npm install)
 */

var path = require('path');
var fs = require('fs');
var child_process = require('child_process');
var http = require('http');

var PROJECT_DIR = path.join(__dirname, '..');
var VENDOR_OLLAMA = path.join(PROJECT_DIR, 'vendor', 'ollama');
var VENDOR_MODELS = path.join(PROJECT_DIR, 'vendor', 'models');
var OLLAMA_MODELS_DIR = path.join(VENDOR_OLLAMA, 'models');
var OLLAMA_BINARY = path.join(VENDOR_OLLAMA, 'ollama');
var OLLAMA_PORT = 11435; // non-standard port to avoid conflicts
var OLLAMA_HOST = '127.0.0.1:' + OLLAMA_PORT;
var DEFAULT_MODEL = 'minicpm-v';

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

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

function waitForOllama(timeoutMs) {
  var deadline = Date.now() + timeoutMs;
  return new Promise(function (resolve, reject) {
    function check() {
      if (Date.now() > deadline) {
        return reject(new Error('Ollama server did not start within ' + (timeoutMs / 1000) + 's'));
      }
      var req = http.get('http://' + OLLAMA_HOST + '/api/version', function () {
        resolve();
      });
      req.on('error', function () {
        setTimeout(check, 500);
      });
      req.setTimeout(2000, function () {
        req.destroy();
        setTimeout(check, 500);
      });
    }
    check();
  });
}

function findPartials(dir) {
  var count = 0;
  try {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        count += findPartials(fullPath);
      } else if (entry.name.includes('-partial')) {
        count++;
      }
    }
  } catch (_) {}
  return count;
}

function cleanPartials(dir) {
  try {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        cleanPartials(fullPath);
      } else if (entry.name.includes('-partial')) {
        fs.unlinkSync(fullPath);
      }
    }
  } catch (_) {}
}

// ---------------------------------------------------------------
// Ollama model download (minicpm-v)
// ---------------------------------------------------------------

async function downloadOllamaModel(force) {
  console.log('\n' + '='.repeat(60));
  console.log('  Ollama: ' + DEFAULT_MODEL);
  console.log('='.repeat(60));

  if (!fs.existsSync(OLLAMA_BINARY)) {
    console.error('ERROR: Ollama binary not found at ' + OLLAMA_BINARY);
    console.error('Run first:  npm run download-ollama');
    process.exit(1);
  }

  fs.mkdirSync(OLLAMA_MODELS_DIR, { recursive: true });

  // Clean partial downloads
  var partials = findPartials(OLLAMA_MODELS_DIR);
  if (partials > 0) {
    console.log('==> Cleaning ' + partials + ' partial blob(s) from interrupted download...');
    cleanPartials(OLLAMA_MODELS_DIR);
  }

  // Check if model already exists
  var manifestDir = path.join(
    OLLAMA_MODELS_DIR, 'manifests', 'registry.ollama.ai', 'library', DEFAULT_MODEL
  );
  if (!force && fs.existsSync(manifestDir)) {
    try {
      var files = fs.readdirSync(manifestDir);
      if (files.length > 0) {
        console.log('==> Model "' + DEFAULT_MODEL + '" already exists — skipping (use --force to re-pull)');
        return;
      }
    } catch (_) {}
  }

  // Start temporary Ollama server
  console.log('==> Starting temporary Ollama server on port ' + OLLAMA_PORT + '...');
  var ollamaProcess = child_process.spawn(OLLAMA_BINARY, ['serve'], {
    env: Object.assign({}, process.env, {
      OLLAMA_MODELS: OLLAMA_MODELS_DIR,
      OLLAMA_HOST: OLLAMA_HOST
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForOllama(30000);
    console.log('==> Server ready');

    // Pull model using CLI (shows progress natively)
    console.log('==> Pulling model "' + DEFAULT_MODEL + '" (this may take a while for ~5 GB)...');
    child_process.execSync(
      '"' + OLLAMA_BINARY + '" pull ' + DEFAULT_MODEL,
      {
        env: Object.assign({}, process.env, {
          OLLAMA_MODELS: OLLAMA_MODELS_DIR,
          OLLAMA_HOST: OLLAMA_HOST
        }),
        stdio: 'inherit',
        timeout: 30 * 60 * 1000 // 30 minute timeout for large model
      }
    );
    console.log('==> Model "' + DEFAULT_MODEL + '" pulled successfully');
  } finally {
    // Always stop server
    try {
      ollamaProcess.kill('SIGTERM');
    } catch (_) {}
  }

  // Verify
  var remainingPartials = findPartials(OLLAMA_MODELS_DIR);
  if (remainingPartials > 0) {
    console.warn('==> WARNING: ' + remainingPartials + ' partial blob(s) remain. Re-run with --force.');
  }

  console.log('==> Ollama model size: ' + formatBytes(getDirSize(OLLAMA_MODELS_DIR)));
}

// ---------------------------------------------------------------
// HuggingFace models (MiniLM + SlimSAM)
// ---------------------------------------------------------------

async function downloadHuggingFaceModels() {
  console.log('\n' + '='.repeat(60));
  console.log('  HuggingFace: MiniLM + SlimSAM');
  console.log('='.repeat(60));

  fs.mkdirSync(VENDOR_MODELS, { recursive: true });

  // Dynamic import since @huggingface/transformers is ESM
  var transformers = await import('@huggingface/transformers');
  var env = transformers.env;

  // Set cache directory to vendor/models/
  env.cacheDir = VENDOR_MODELS;
  env.allowRemoteModels = true;

  // 1. MiniLM embedding model
  console.log('\n==> [1/2] Downloading MiniLM embedding model (Xenova/all-MiniLM-L6-v2)...');
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

  console.log('\n==> HuggingFace model size: ' + formatBytes(getDirSize(VENDOR_MODELS)));
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function main() {
  var args = process.argv.slice(2);
  var force = args.includes('--force');
  var ollamaOnly = args.includes('--ollama');
  var hfOnly = args.includes('--hf');
  var downloadAll = !ollamaOnly && !hfOnly;

  console.log('Snip Model Downloader');
  console.log('=====================');

  if (downloadAll || ollamaOnly) {
    await downloadOllamaModel(force);
  }

  if (downloadAll || hfOnly) {
    await downloadHuggingFaceModels();
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  All done!');
  console.log('='.repeat(60));

  if ((downloadAll || ollamaOnly) && fs.existsSync(OLLAMA_BINARY)) {
    console.log('  Ollama binary:   ' + formatBytes(fs.statSync(OLLAMA_BINARY).size));
    console.log('  Ollama models:   ' + formatBytes(getDirSize(OLLAMA_MODELS_DIR)));
  }
  if ((downloadAll || hfOnly) && fs.existsSync(VENDOR_MODELS)) {
    console.log('  HF models:       ' + formatBytes(getDirSize(VENDOR_MODELS)));
  }
  console.log('');
  console.log('These will be bundled into the app via extraResources.');
}

main().catch(function (err) {
  console.error('\nFailed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
