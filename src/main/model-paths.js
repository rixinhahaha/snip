/**
 * Resolve the Transformers.js model cache directory.
 *
 * - Production (packaged): process.resourcesPath/models/ (read-only, bundled)
 * - Development: <project>/vendor/models/ (populated by scripts/download-models.js)
 * - Fallback: default HuggingFace cache (~/.cache/huggingface/)
 *
 * Also configures env.allowRemoteModels: disabled in production (fully offline),
 * enabled in dev as a fallback if vendor/models/ is empty.
 */
const path = require('path');
const fs = require('fs');

/**
 * Get the path to bundled/cached Transformers.js models.
 * Returns { cacheDir, allowRemote }
 */
function getModelConfig() {
  var isPackaged = false;
  try {
    isPackaged = require('electron').app.isPackaged;
  } catch (_) {
    // Not in Electron (e.g., running in child process) — check env
    isPackaged = process.env.SNIP_PACKAGED === '1';
  }

  if (isPackaged) {
    // Packaged app: models are in Resources/models/ (read-only)
    var resourcesPath = process.env.SNIP_RESOURCES_PATH || process.resourcesPath;
    return {
      cacheDir: path.join(resourcesPath, 'models'),
      allowRemote: false
    };
  }

  // Development: use vendor/models/ if it exists and has content
  var vendorModels = path.join(__dirname, '..', '..', '..', 'vendor', 'models');
  if (fs.existsSync(vendorModels)) {
    var entries = [];
    try { entries = fs.readdirSync(vendorModels); } catch (_) {}
    if (entries.length > 0) {
      return {
        cacheDir: vendorModels,
        allowRemote: true  // allow downloading new/updated models in dev
      };
    }
  }

  // Fallback: default HuggingFace cache (will download on first use)
  return {
    cacheDir: null,
    allowRemote: true
  };
}

/**
 * Apply model config to Transformers.js env object.
 * Call this before loading any models.
 *
 * @param {object} env - The env object from @huggingface/transformers
 */
function configureTransformersEnv(env) {
  var config = getModelConfig();
  if (config.cacheDir) {
    env.cacheDir = config.cacheDir;
    console.log('[Models] Cache dir: ' + config.cacheDir);
  }
  env.allowRemoteModels = config.allowRemote;
  if (!config.allowRemote) {
    console.log('[Models] Remote downloads disabled (bundled models only)');
  }
}

module.exports = { getModelConfig, configureTransformersEnv };
