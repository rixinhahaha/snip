const path = require('path');

const PRELOAD_PATH = path.join(__dirname, '..', 'preload', 'preload.js');

const BASE_WEB_PREFERENCES = {
  preload: PRELOAD_PATH,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false
};

module.exports = { BASE_WEB_PREFERENCES };
