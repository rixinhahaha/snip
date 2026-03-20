/**
 * Embeddings worker — runs text embedding inference in an isolated child process.
 * Spawned with NODE_PATH pointing to addon runtime so it can find transformers.js.
 *
 * Message protocol:
 *   Parent → Worker: { id, type: 'embed', text: '...' }
 *   Worker → Parent: { id, type: 'result', data: [...] }
 *   Worker → Parent: { id, type: 'error', error: '...' }
 *   Worker → Parent: { type: 'ready' }
 */

var { importTransformers } = require('../addon-resolve');

let transformersModule = null;
let pipeline = null;
let envConfigured = false;

async function getTransformers() {
  if (!transformersModule) transformersModule = await importTransformers();
  return transformersModule;
}

async function configureEnv() {
  if (envConfigured) return;
  envConfigured = true;
  var { env } = await getTransformers();
  if (process.env.SNIP_ADDON_MODELS_PATH) {
    env.cacheDir = process.env.SNIP_ADDON_MODELS_PATH;
    console.log('[Embeddings Worker] Model cache: ' + env.cacheDir);
  } else if (process.env.SNIP_MODELS_PATH) {
    env.cacheDir = process.env.SNIP_MODELS_PATH;
    console.log('[Embeddings Worker] Model cache: ' + env.cacheDir);
  }
  if (process.env.SNIP_PACKAGED === '1') {
    env.allowRemoteModels = false;
  }
}

async function getPipeline() {
  if (pipeline) return pipeline;
  await configureEnv();
  var transformers = await getTransformers();
  console.log('[Embeddings Worker] Loading MiniLM model...');
  pipeline = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true
  });
  console.log('[Embeddings Worker] Model loaded');
  return pipeline;
}

async function embedText(text) {
  var pipe = await getPipeline();
  var output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

process.on('message', async function (msg) {
  if (msg.type === 'embed') {
    try {
      var embedding = await embedText(msg.text);
      process.send({ id: msg.id, type: 'result', data: embedding });
    } catch (err) {
      console.error('[Embeddings Worker] Error:', err.message);
      process.send({ id: msg.id, type: 'error', error: err.message });
    }
  }
});

// Signal ready
process.send({ type: 'ready' });
