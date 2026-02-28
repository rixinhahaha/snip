const path = require('path');
const fs = require('fs');

const DEFAULT_CATEGORIES = ['code', 'chat', 'web', 'design', 'documents', 'terminal', 'other'];

const DEFAULT_TAG_DESCRIPTIONS = {
  code: 'Snips of code editors, IDEs, terminal output, programming-related content, and developer tools',
  chat: 'Snips of chat applications, messaging apps, conversation interfaces, and social media DMs',
  web: 'Snips of websites, web pages, browser content, and online articles',
  design: 'Snips of design tools, UI mockups, wireframes, graphics editors, and visual assets',
  documents: 'Snips of documents, spreadsheets, PDFs, presentations, and text editors',
  terminal: 'Snips of terminal windows, command-line interfaces, shell output, and system logs',
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

function saveConfig() {
  const dir = path.dirname(getConfigPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(configData, null, 2));
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

function getScreenshotsDir() {
  if (screenshotsDirOverride) return screenshotsDirOverride;
  const { app } = require('electron');
  return path.join(app.getPath('documents'), 'snip', 'screenshots');
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
  const defaults = (cfg.categories && cfg.categories.defaults) || DEFAULT_CATEGORIES;
  const custom = (cfg.categories && cfg.categories.custom) || [];
  return [...defaults, ...custom];
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
  return loadConfig().theme || 'dark';
}

function setTheme(theme) {
  loadConfig().theme = theme;
  saveConfig();
}

module.exports = {
  initStore,
  setExternalPaths,
  getScreenshotsDir,
  getOllamaModel,
  setOllamaModel,
  getOllamaUrl,
  setOllamaUrl,
  getAllCategories,
  addCustomCategory,
  removeCustomCategory,
  getTagDescription,
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
};
