/**
 * Platform abstraction layer.
 *
 * Loads the correct platform module based on process.platform.
 * This is the ONLY place in the codebase that checks process.platform.
 * All other code imports from this module and calls platform functions.
 */

var modules = {
  darwin: './darwin',
  linux: './linux',
  win32: './win32'
};

module.exports = require(modules[process.platform] || modules.linux);
