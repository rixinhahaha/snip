/**
 * Resolve and import @huggingface/transformers from the addon runtime.
 *
 * ESM import() does not respect NODE_PATH in packaged Electron apps.
 * This helper uses require.resolve() with explicit paths to find the
 * module in the addon runtime's node_modules, then imports via file URL.
 */
var path = require('path');
var { pathToFileURL } = require('url');

/**
 * Import @huggingface/transformers, resolving from NODE_PATH if set.
 * Falls back to standard resolution (works in dev where it's in project node_modules).
 */
async function importTransformers() {
  // In packaged app, NODE_PATH points to addon runtime's node_modules.
  // require.resolve() with explicit paths finds the package, then import() loads it via file URL.
  if (process.env.NODE_PATH) {
    var searchPaths = process.env.NODE_PATH.split(path.delimiter);
    try {
      var resolved = require.resolve('@huggingface/transformers', { paths: searchPaths });
      return await import(pathToFileURL(resolved).href);
    } catch (_) {
      // Fall through to standard resolution
    }
  }

  // Standard resolution — works in dev where it's in project node_modules
  return await import('@huggingface/transformers');
}

module.exports = { importTransformers };
