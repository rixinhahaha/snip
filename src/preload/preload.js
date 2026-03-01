const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snip', {
  // Screenshot overlay
  onScreenshotCaptured: (callback) => {
    ipcRenderer.on('screenshot-captured', (event, data) => callback(data));
  },
  copyToClipboard: (dataURL) => ipcRenderer.invoke('copy-to-clipboard', dataURL),
  saveScreenshot: (dataURL, timestamp) => ipcRenderer.invoke('save-screenshot', { dataURL, timestamp }),
  closeOverlay: () => ipcRenderer.send('close-overlay'),
  getSystemFonts: () => ipcRenderer.invoke('get-system-fonts'),

  // Editor window
  openEditor: (data) => ipcRenderer.invoke('open-editor', data),
  getEditorImage: () => ipcRenderer.invoke('get-editor-image'),
  closeEditor: () => ipcRenderer.send('close-editor'),

  // Settings: Ollama
  getOllamaConfig: () => ipcRenderer.invoke('get-ollama-config'),
  setOllamaConfig: (config) => ipcRenderer.invoke('set-ollama-config', config),
  getOllamaStatus: () => ipcRenderer.invoke('get-ollama-status'),
  getOllamaPullProgress: () => ipcRenderer.invoke('get-ollama-pull-progress'),
  onOllamaPullProgress: (callback) => {
    var handler = (event, progress) => callback(progress);
    ipcRenderer.on('ollama-pull-progress', handler);
    return () => ipcRenderer.removeListener('ollama-pull-progress', handler);
  },
  getCategories: () => ipcRenderer.invoke('get-categories'),
  addCategory: (category) => ipcRenderer.invoke('add-category', category),
  removeCategory: (category) => ipcRenderer.invoke('remove-category', category),
  getTagsWithDescriptions: () => ipcRenderer.invoke('get-tags-with-descriptions'),
  setTagDescription: (tag, description) => ipcRenderer.invoke('set-tag-description', { tag, description }),
  addCategoryWithDescription: (name, description) => ipcRenderer.invoke('add-category-with-description', { name, description }),

  // Search
  getScreenshotIndex: () => ipcRenderer.invoke('get-screenshot-index'),
  getThumbnail: (filepath) => ipcRenderer.invoke('get-thumbnail', filepath),
  revealInFinder: (filepath) => ipcRenderer.invoke('reveal-in-finder', filepath),
  searchScreenshots: (query) => ipcRenderer.invoke('search-screenshots', query),

  // Home
  getScreenshotsDir: () => ipcRenderer.invoke('get-screenshots-dir'),
  listFolder: (subdir) => ipcRenderer.invoke('list-folder', subdir),
  openScreenshotsFolder: () => ipcRenderer.invoke('open-screenshots-folder'),
  deleteScreenshot: (filepath) => ipcRenderer.invoke('delete-screenshot', filepath),
  deleteFolder: (folderPath) => ipcRenderer.invoke('delete-folder', folderPath),

  // Navigation
  onNavigateToSearch: (callback) => {
    ipcRenderer.on('navigate-to-search', () => callback());
  },

  // Segmentation (SAM)
  segmentAtPoint: ({ points, cssWidth, cssHeight }) =>
    ipcRenderer.invoke('segment-at-point', { points, cssWidth, cssHeight }),
  checkSegmentSupport: () => ipcRenderer.invoke('check-segment-support'),

  // External URL
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),

  // Settings: Animation (fal.ai)
  getAnimationConfig: () => ipcRenderer.invoke('get-animation-config'),
  setAnimationConfig: (config) => ipcRenderer.invoke('set-animation-config', config),

  // Animation (fal.ai)
  checkAnimateSupport: () => ipcRenderer.invoke('check-animate-support'),
  listAnimationPresets: () => ipcRenderer.invoke('list-animation-presets'),
  generateAnimationPresets: (cutoutBase64) =>
    ipcRenderer.invoke('generate-animation-presets', { cutoutBase64 }),
  animateCutout: ({ cutoutDataURL, presetName, options }) =>
    ipcRenderer.invoke('animate-cutout', { cutoutDataURL, presetName, options }),
  onAnimateProgress: (callback) => {
    const handler = (event, progress) => callback(progress);
    ipcRenderer.on('animate-progress', handler);
    return () => ipcRenderer.removeListener('animate-progress', handler);
  },
  saveAnimation: ({ buffer, format, timestamp }) =>
    ipcRenderer.invoke('save-animation', { buffer, format, timestamp }),

  // Editor resize
  resizeEditor: (minWidth) => ipcRenderer.invoke('resize-editor', { minWidth }),

  // Theme
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme-changed', (event, theme) => callback(theme));
  }
});
