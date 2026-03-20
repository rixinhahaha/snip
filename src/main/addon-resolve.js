/**
 * Resolve and load @huggingface/transformers from the addon runtime.
 *
 * Two problems in packaged Electron apps:
 * 1. ESM import() does not respect NODE_PATH
 * 2. require.resolve + import(fileURL) wraps CJS exports under .default
 *
 * Solution: use module.createRequire() anchored at the addon runtime dir.
 * This loads the CJS entry directly with correct exports shape.
 */
var path = require('path');

async function importTransformers() {
  // In packaged app, NODE_PATH points to addon runtime's node_modules.
  // Use createRequire anchored there to load via CJS resolution.
  if (process.env.NODE_PATH) {
    var searchPaths = process.env.NODE_PATH.split(path.delimiter);
    try {
      var createRequire = require('module').createRequire;
      var addonRequire = createRequire(path.join(searchPaths[0], '_'));
      return addonRequire('@huggingface/transformers');
    } catch (_) {
      // Fall through to standard import
    }
  }

  // Standard ESM import — works in dev where it's in project node_modules
  return await import('@huggingface/transformers');
}

module.exports = { importTransformers };
