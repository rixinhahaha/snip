const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snip', {
  // Screenshot overlay
  onScreenshotCaptured: (callback) => {
    ipcRenderer.on('screenshot-captured', (event, data) => callback(data));
  },
  getCaptureImage: () => ipcRenderer.invoke('get-capture-image'),
  copyToClipboard: (dataURL) => ipcRenderer.invoke('copy-to-clipboard', dataURL),
  showNotification: (body) => ipcRenderer.send('show-notification', body),
  saveScreenshot: (dataURL, timestamp) => ipcRenderer.invoke('save-screenshot', { dataURL, timestamp }),
  closeOverlay: () => ipcRenderer.send('close-overlay'),
  getSystemFonts: () => ipcRenderer.invoke('get-system-fonts'),

  // Editor window
  openEditor: (data) => ipcRenderer.invoke('open-editor', data),
  getEditorImage: () => ipcRenderer.invoke('get-editor-image'),
  onEditorImageData: (callback) => {
    ipcRenderer.on('editor-image-data', (event, data) => callback(data));
  },
  closeEditor: () => ipcRenderer.send('close-editor'),
  sendEditorResult: (dataURL) => ipcRenderer.send('editor-result', dataURL),

  // Generic extension IPC bridge (new extensions use these instead of adding named methods)
  // Only channels prefixed with 'ext:' are allowed to prevent access to internal IPC channels
  invokeExtension: (channel, ...args) => {
    if (typeof channel !== 'string' || !channel.startsWith('ext:')) {
      return Promise.reject(new Error('Extension channels must use ext: prefix'));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  onExtensionEvent: (channel, callback) => {
    if (typeof channel !== 'string' || !channel.startsWith('ext:')) return;
    var handler = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // Screen recording permission
  getScreenPermission: () => ipcRenderer.invoke('get-screen-permission'),
  requestScreenPermission: () => ipcRenderer.invoke('request-screen-permission'),
  restartApp: () => ipcRenderer.invoke('restart-app'),

  // AI preference
  getAiEnabled: () => ipcRenderer.invoke('get-ai-enabled'),
  setAiEnabled: (enabled) => ipcRenderer.invoke('set-ai-enabled', enabled),

  // Settings: Ollama
  getOllamaConfig: () => ipcRenderer.invoke('get-ollama-config'),
  setOllamaConfig: (config) => ipcRenderer.invoke('set-ollama-config', config),
  getOllamaStatus: () => ipcRenderer.invoke('get-ollama-status'),
  getOllamaPullProgress: () => ipcRenderer.invoke('get-ollama-pull-progress'),
  installOllama: () => ipcRenderer.invoke('install-ollama'),
  pullOllamaModel: () => ipcRenderer.invoke('pull-ollama-model'),
  checkOllamaModel: () => ipcRenderer.invoke('check-ollama-model'),
  onOllamaPullProgress: (callback) => {
    var handler = (event, progress) => callback(progress);
    ipcRenderer.on('ollama-pull-progress', handler);
    return () => ipcRenderer.removeListener('ollama-pull-progress', handler);
  },
  onOllamaInstallProgress: (callback) => {
    var handler = (event, progress) => callback(progress);
    ipcRenderer.on('ollama-install-progress', handler);
    return () => ipcRenderer.removeListener('ollama-install-progress', handler);
  },
  onOllamaStatusChanged: (callback) => {
    var handler = (event, status) => callback(status);
    ipcRenderer.on('ollama-status-changed', handler);
    return () => ipcRenderer.removeListener('ollama-status-changed', handler);
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
  refreshIndex: () => ipcRenderer.invoke('refresh-index'),
  getScreenshotsDir: () => ipcRenderer.invoke('get-screenshots-dir'),
  listFolder: (subdir) => ipcRenderer.invoke('list-folder', subdir),
  openScreenshotsFolder: () => ipcRenderer.invoke('open-screenshots-folder'),
  deleteScreenshot: (filepath) => ipcRenderer.invoke('delete-screenshot', filepath),
  deleteFolder: (folderPath) => ipcRenderer.invoke('delete-folder', folderPath),

  // Navigation
  onNavigateToSearch: (callback) => {
    ipcRenderer.on('navigate-to-search', () => callback());
  },

  // Upscaling
  upscaleImage: ({ imageBase64 }) =>
    ipcRenderer.invoke('upscale-image', { imageBase64 }),
  onUpscaleProgress: (callback) => {
    var handler = (event, progress) => callback(progress);
    ipcRenderer.on('upscale-progress', handler);
    return () => ipcRenderer.removeListener('upscale-progress', handler);
  },

  // Segmentation (SAM)
  transcribeScreenshot: () => ipcRenderer.invoke('transcribe-screenshot'),
  segmentAtPoint: ({ points, cssWidth, cssHeight }) =>
    ipcRenderer.invoke('segment-at-point', { points, cssWidth, cssHeight }),
  checkSegmentSupport: () => ipcRenderer.invoke('check-segment-support'),

  // Setup overlay
  closeSetupOverlay: () => ipcRenderer.invoke('close-setup-overlay'),
  openSetupOverlay: () => ipcRenderer.invoke('open-setup-overlay'),
  onShowSetupOverlay: (callback) => {
    ipcRenderer.on('show-setup-overlay', () => callback());
  },

  // External URL
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),

  // Settings: Animation (fal.ai)
  getAnimationConfig: () => ipcRenderer.invoke('get-animation-config'),
  setAnimationConfig: (config) => ipcRenderer.invoke('set-animation-config', config),

  // Settings: User Extensions
  getUserExtensions: () => ipcRenderer.invoke('get-user-extensions'),
  removeUserExtension: (name) => ipcRenderer.invoke('remove-user-extension', name),
  installExtensionFromFolder: () => ipcRenderer.invoke('install-extension-from-folder'),

  // Settings: MCP Server
  getMcpConfig: () => ipcRenderer.invoke('get-mcp-config'),
  setMcpConfig: (config) => ipcRenderer.invoke('set-mcp-config', config),
  getMcpClientConfig: () => ipcRenderer.invoke('get-mcp-client-config'),
  onMcpConfigChanged: (callback) => {
    ipcRenderer.on('mcp-config-changed', (event, config) => callback(config));
  },

  // Animation (fal.ai)
  checkAnimateSupport: () => ipcRenderer.invoke('check-animate-support'),
  listAnimationPresets: () => ipcRenderer.invoke('list-animation-presets'),
  generateAnimationPresets: (cutoutBase64) =>
    ipcRenderer.invoke('generate-animation-presets', { cutoutBase64 }),
  animateCutout: ({ cutoutDataURL, presetName, options }) =>
    ipcRenderer.invoke('animate-cutout', { cutoutDataURL, presetName, options }),
  onAnimateProgress: (callback) => {
    var handler = (event, progress) => callback(progress);
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
  },
  onTagsChanged: (callback) => {
    ipcRenderer.on('tags-changed', () => callback());
  },

  // Shortcuts
  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  getDefaultShortcuts: () => ipcRenderer.invoke('get-default-shortcuts'),
  setShortcut: (action, accelerator) => ipcRenderer.invoke('set-shortcut', { action, accelerator }),
  resetShortcuts: () => ipcRenderer.invoke('reset-shortcuts'),
  onShortcutsChanged: (callback) => {
    var handler = (event, shortcuts) => callback(shortcuts);
    ipcRenderer.on('shortcuts-changed', handler);
    return () => ipcRenderer.removeListener('shortcuts-changed', handler);
  }
});
