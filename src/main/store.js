const path = require('path');
const fs = require('fs');

const DEFAULT_CATEGORIES = ['code', 'chat', 'web', 'design', 'documents', 'terminal', 'personal', 'fun', 'other'];

const DEFAULT_SHORTCUTS = {
  'capture': 'CommandOrControl+Shift+2',
  'search': 'CommandOrControl+Shift+S',
  'quick-snip': 'CommandOrControl+Shift+1',
  'tool-select': 'v',
  'tool-rectangle': 'r',
  'tool-text': 't',
  'tool-arrow': 'a',
  'tool-tag': 'g',
  'tool-blur': 'b',
  'tool-segment': 's',
  'tool-upscale': 'u',
  'tool-transcribe': 'w'
};

const DEFAULT_TAG_DESCRIPTIONS = {
  code: 'Snips of code editors, IDEs, terminal output, programming-related content, and developer tools',
  chat: 'Snips of chat applications, messaging apps, conversation interfaces, and social media DMs',
  web: 'Snips of websites, web pages, browser content, and online articles',
  design: 'Snips of design tools, UI mockups, wireframes, graphics editors, and visual assets',
  documents: 'Snips of documents, spreadsheets, PDFs, presentations, and text editors',
  terminal: 'Snips of terminal windows, command-line interfaces, shell output, and system logs',
  personal: 'Snips of personal content, photos, social media posts, and non-work related items',
  fun: 'Snips of memes, jokes, funny content, entertainment, games, and humor',
  other: 'Snips that do not fit into any other category'
};

let configData = null;
let configPath = null;
let screenshotsDirOverride = null;

/**
 * Allow external path injection for worker thread context
 * where electron.app is unavailable.
 */
function setExternalPaths(screenshotsDir, cfgPath) {
  screenshotsDirOverride = screenshotsDir;
  configPath = cfgPath;
}

function getConfigPath() {
  if (!configPath) {
    const { app } = require('electron');
    configPath = path.join(app.getPath('userData'), 'snip-config.json');
  }
  return configPath;
}

function loadConfig() {
  if (configData) return configData;
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    configData = JSON.parse(raw);
  } catch {
    configData = {
      categories: { defaults: DEFAULT_CATEGORIES, custom: [] }
    };
  }
  return configData;
}

var _saveTimer = null;

function saveConfig() {
  // Debounce: batch rapid config changes into a single write (500ms)
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(function () {
    _saveTimer = null;
    var dir = path.dirname(getConfigPath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getConfigPath(), JSON.stringify(configData, null, 2));
  }, 500);
}

// Flush pending config write immediately (for shutdown)
function flushConfig() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    var dir = path.dirname(getConfigPath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getConfigPath(), JSON.stringify(configData, null, 2));
  }
}

/**
 * Force-reload config from disk. Use when another thread (worker) has written
 * to the config file and the in-memory cache is stale.
 */
function reloadConfig() {
  configData = null;
  return loadConfig();
}

function initStore() {
  const cfg = loadConfig();
  // Ensure screenshots directory exists
  const screenshotsDir = getScreenshotsDir();
  fs.mkdirSync(screenshotsDir, { recursive: true });

  // Clean up legacy Anthropic API key fields from config
  if (cfg.anthropicApiKey || cfg.encryptedApiKey) {
    delete cfg.anthropicApiKey;
    delete cfg.encryptedApiKey;
    saveConfig();
    console.log('[Store] Removed legacy API key fields');
  }
}

function getDefaultScreenshotsDir() {
  const { app } = require('electron');
  return path.join(app.getPath('documents'), 'snip', 'screenshots');
}

function getScreenshotsDir() {
  if (screenshotsDirOverride) return screenshotsDirOverride;
  var cfg = loadConfig();
  if (cfg.screenshotsDir) return cfg.screenshotsDir;
  return getDefaultScreenshotsDir();
}

function setScreenshotsDir(dirPath) {
  var cfg = loadConfig();
  if (!dirPath || dirPath === getDefaultScreenshotsDir()) {
    delete cfg.screenshotsDir;
  } else {
    cfg.screenshotsDir = dirPath;
  }
  saveConfig();
}

function getOllamaModel() {
  return loadConfig().ollamaModel || 'minicpm-v';
}

function setOllamaModel(model) {
  loadConfig().ollamaModel = model;
  saveConfig();
}

function getOllamaUrl() {
  return loadConfig().ollamaUrl || 'http://127.0.0.1:11434';
}

function setOllamaUrl(url) {
  loadConfig().ollamaUrl = url;
  saveConfig();
}

function getAllCategories() {
  const cfg = loadConfig();
  const saved = (cfg.categories && cfg.categories.defaults) || [];
  // Merge saved defaults with current DEFAULT_CATEGORIES so newly added defaults always appear
  const merged = [...DEFAULT_CATEGORIES];
  for (const s of saved) {
    if (!merged.includes(s)) merged.push(s);
  }
  // Sync saved defaults if they're stale
  if (!cfg.categories) cfg.categories = { defaults: DEFAULT_CATEGORIES, custom: [] };
  if (cfg.categories.defaults.length !== merged.length || !DEFAULT_CATEGORIES.every(d => cfg.categories.defaults.includes(d))) {
    cfg.categories.defaults = merged;
    saveConfig();
  }
  const custom = (cfg.categories && cfg.categories.custom) || [];
  return [...merged, ...custom];
}

function addCustomCategory(category) {
  const cfg = loadConfig();
  if (!cfg.categories) cfg.categories = { defaults: DEFAULT_CATEGORIES, custom: [] };
  if (!cfg.categories.custom) cfg.categories.custom = [];
  const normalized = category.toLowerCase().trim();
  if (!cfg.categories.custom.includes(normalized) && !DEFAULT_CATEGORIES.includes(normalized)) {
    cfg.categories.custom.push(normalized);
    saveConfig();
  }
  return getAllCategories();
}

function removeCustomCategory(category) {
  const cfg = loadConfig();
  if (!cfg.categories || !cfg.categories.custom) return getAllCategories();
  cfg.categories.custom = cfg.categories.custom.filter(c => c !== category);
  // Also remove its description
  if (cfg.tagDescriptions && cfg.tagDescriptions[category]) {
    delete cfg.tagDescriptions[category];
  }
  saveConfig();
  return getAllCategories();
}

/**
 * Get the description for a tag/category.
 * Returns custom description if set, otherwise the default, or empty string.
 */
function getTagDescription(tag) {
  const cfg = loadConfig();
  if (cfg.tagDescriptions && cfg.tagDescriptions[tag]) {
    return cfg.tagDescriptions[tag];
  }
  return DEFAULT_TAG_DESCRIPTIONS[tag] || '';
}

/**
 * Get all tags with their descriptions as an array of { name, description } objects.
 */
function getAllTagsWithDescriptions() {
  const categories = getAllCategories();
  return categories.map(cat => ({
    name: cat,
    description: getTagDescription(cat),
    isDefault: DEFAULT_CATEGORIES.includes(cat)
  }));
}

/**
 * Set the description for a tag/category.
 */
function setTagDescription(tag, description) {
  const cfg = loadConfig();
  if (!cfg.tagDescriptions) cfg.tagDescriptions = {};
  cfg.tagDescriptions[tag] = description;
  saveConfig();
}

/**
 * Add a custom category with an optional description.
 */
function addCustomCategoryWithDescription(category, description) {
  const cfg = loadConfig();
  if (!cfg.categories) cfg.categories = { defaults: DEFAULT_CATEGORIES, custom: [] };
  if (!cfg.categories.custom) cfg.categories.custom = [];
  const normalized = category.toLowerCase().trim();
  if (!cfg.categories.custom.includes(normalized) && !DEFAULT_CATEGORIES.includes(normalized)) {
    cfg.categories.custom.push(normalized);
    if (description && description.trim()) {
      if (!cfg.tagDescriptions) cfg.tagDescriptions = {};
      cfg.tagDescriptions[normalized] = description.trim();
    }
    saveConfig();
  }
  return getAllTagsWithDescriptions();
}

// Screenshot index management
function getIndexPath() {
  return path.join(getScreenshotsDir(), '.index.json');
}

function readIndex() {
  try {
    const data = fs.readFileSync(getIndexPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeIndex(index) {
  fs.writeFileSync(getIndexPath(), JSON.stringify(index, null, 2));
}

// Upsert: update existing entry by path, or append if new
function addToIndex(entry) {
  const index = readIndex();
  const existingIdx = index.findIndex(e => e.path === entry.path);
  if (existingIdx >= 0) {
    index[existingIdx] = entry;
  } else {
    index.push(entry);
  }
  writeIndex(index);
  return index;
}

// Remove a single entry by filepath
function removeFromIndex(filepath) {
  const index = readIndex();
  const filtered = index.filter(e => e.path !== filepath);
  if (filtered.length !== index.length) {
    writeIndex(filtered);
  }
  return filtered;
}

// Remove all entries matching a directory prefix
function removeFromIndexByDir(dirPath) {
  const index = readIndex();
  const normalizedDir = dirPath.endsWith(path.sep) ? dirPath : dirPath + path.sep;
  const filtered = index.filter(e => !e.path.startsWith(normalizedDir));
  if (filtered.length !== index.length) {
    writeIndex(filtered);
  }
  return filtered;
}

// Rebuild: prune entries whose files no longer exist on disk
function rebuildIndex() {
  const index = readIndex();
  const cleaned = index.filter(entry => {
    if (!entry.path) return false;
    return fs.existsSync(entry.path);
  });
  if (cleaned.length !== index.length) {
    console.log(`[Index] Rebuilt: removed ${index.length - cleaned.length} stale entries`);
    writeIndex(cleaned);
  }
  return cleaned;
}

function getTheme() {
  var theme = loadConfig().theme || 'dark';
  if (theme === 'glass') {
    theme = 'dark';
    setTheme(theme);
  }
  return theme;
}

function setTheme(theme) {
  loadConfig().theme = theme;
  saveConfig();
}

function getAiEnabled() {
  var val = loadConfig().aiEnabled;
  return val === undefined ? undefined : !!val;
}

function setAiEnabled(enabled) {
  loadConfig().aiEnabled = !!enabled;
  saveConfig();
}

function getFalApiKey() {
  return loadConfig().falApiKey || '';
}

function setFalApiKey(key) {
  loadConfig().falApiKey = key;
  saveConfig();
}

function getShortcuts() {
  const cfg = loadConfig();
  const merged = Object.assign({}, DEFAULT_SHORTCUTS);
  if (cfg.shortcuts) {
    Object.assign(merged, cfg.shortcuts);
  }
  return merged;
}

function getDefaultShortcuts() {
  return Object.assign({}, DEFAULT_SHORTCUTS);
}

function setShortcut(action, accelerator) {
  const cfg = loadConfig();
  if (!cfg.shortcuts) cfg.shortcuts = {};
  cfg.shortcuts[action] = accelerator;
  saveConfig();
}

function resetShortcuts() {
  const cfg = loadConfig();
  delete cfg.shortcuts;
  saveConfig();
}

var MCP_CATEGORY_DEFAULTS = {
  library: true,
  upload: true,
  transcribe: true,
  organize: true
};

function getMcpConfig() {
  var cfg = loadConfig();
  var categories = Object.assign({}, MCP_CATEGORY_DEFAULTS, cfg.mcpCategories || {});
  return {
    enabled: !!cfg.mcpEnabled,
    categories: categories
  };
}

function setMcpConfig(update) {
  var cfg = loadConfig();
  if (update.enabled !== undefined) {
    cfg.mcpEnabled = !!update.enabled;
  }
  if (update.categories) {
    if (!cfg.mcpCategories) cfg.mcpCategories = {};
    for (var key in update.categories) {
      if (MCP_CATEGORY_DEFAULTS.hasOwnProperty(key)) {
        cfg.mcpCategories[key] = !!update.categories[key];
      }
    }
  }
  saveConfig();
}

function getShortcutsSkipped() {
  var cfg = loadConfig();
  return cfg.shortcutsSkipped === true;
}

function setShortcutsSkipped(skipped) {
  var cfg = loadConfig();
  cfg.shortcutsSkipped = !!skipped;
  saveConfig();
}

module.exports = {
  initStore,
  reloadConfig,
  setExternalPaths,
  getScreenshotsDir,
  getDefaultScreenshotsDir,
  setScreenshotsDir,
  getOllamaModel,
  setOllamaModel,
  getOllamaUrl,
  setOllamaUrl,
  getAllCategories,
  addCustomCategory,
  removeCustomCategory,
  getAllTagsWithDescriptions,
  setTagDescription,
  addCustomCategoryWithDescription,
  readIndex,
  writeIndex,
  addToIndex,
  removeFromIndex,
  removeFromIndexByDir,
  rebuildIndex,
  getTheme,
  setTheme,
  getAiEnabled,
  setAiEnabled,
  getFalApiKey,
  setFalApiKey,
  getShortcuts,
  getDefaultShortcuts,
  setShortcut,
  resetShortcuts,
  getMcpConfig,
  setMcpConfig,
  getShortcutsSkipped,
  setShortcutsSkipped,
  flushConfig,
};
