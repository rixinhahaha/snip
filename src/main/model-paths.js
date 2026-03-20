/**
 * Resolve the Transformers.js model cache directory.
 *
 * - Production (packaged): ~/Library/Application Support/snip/addons/models/ (downloaded on demand)
 * - Development: <project>/vendor/models/ (populated by scripts/download-models.js)
 * - Fallback: default HuggingFace cache (~/.cache/huggingface/)
 *
 * Models are no longer bundled in the app binary. They are downloaded
 * on demand via the add-on manager and stored in the user data directory.
 */
const path = require('path');
const fs = require('fs');

/**
 * Get the path to cached Transformers.js models.
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

  // Check for addon models path (set by addon-manager when forking workers)
  if (process.env.SNIP_ADDON_MODELS_PATH) {
    return {
      cacheDir: process.env.SNIP_ADDON_MODELS_PATH,
      allowRemote: false
    };
  }

  // Check for legacy SNIP_MODELS_PATH (backwards compat for running workers)
  if (process.env.SNIP_MODELS_PATH) {
    return {
      cacheDir: process.env.SNIP_MODELS_PATH,
      allowRemote: process.env.SNIP_PACKAGED !== '1'
    };
  }

  if (isPackaged) {
    // Packaged app: models are in addons directory (downloaded on demand)
    try {
      var userData = require('electron').app.getPath('userData');
      var addonModels = path.join(userData, 'addons', 'models');
      if (fs.existsSync(addonModels)) {
        return {
          cacheDir: addonModels,
          allowRemote: false
        };
      }
    } catch (_) {}

    // Fallback: check old bundled location (pre-migration)
    var resourcesPath = process.env.SNIP_RESOURCES_PATH || process.resourcesPath;
    if (resourcesPath) {
      var bundledModels = path.join(resourcesPath, 'models');
      if (fs.existsSync(bundledModels)) {
        return {
          cacheDir: bundledModels,
          allowRemote: false
        };
      }
    }

    return { cacheDir: null, allowRemote: false };
  }

  // Development: use vendor/models/ if it exists and has content
  var vendorModels = path.join(__dirname, '..', '..', 'vendor', 'models');
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

module.exports = { getModelConfig };
