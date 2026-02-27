const { ipcMain, clipboard, nativeImage, app, Notification, shell, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  getScreenshotsDir, getApiKey, setApiKey,
  getAllCategories, addCustomCategory, removeCustomCategory,
  getAllTagsWithDescriptions, setTagDescription, addCustomCategoryWithDescription,
  readIndex, removeFromIndex, removeFromIndexByDir, rebuildIndex,
  getTheme, setTheme
} = require('./store');
const { resetClient } = require('./organizer/agent');
const { queueNewFile, updateWorkerApiKey } = require('./organizer/watcher');

let pendingEditorData = null;
let editorWindowRef = null;

function registerIpcHandlers(getOverlayWindow, createEditorWindowFn) {
  // Copy annotated image to clipboard
  ipcMain.handle('copy-to-clipboard', async (event, dataURL) => {
    const image = nativeImage.createFromDataURL(dataURL);
    clipboard.writeImage(image);
    return true;
  });

  // Save screenshot to disk
  ipcMain.handle('save-screenshot', async (event, { dataURL, timestamp }) => {
    const screenshotsDir = getScreenshotsDir();
    fs.mkdirSync(screenshotsDir, { recursive: true });

    const filename = `${timestamp}.jpg`;
    const filepath = path.join(screenshotsDir, filename);

    const base64Data = dataURL.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filepath, buffer);
    console.log('[Snip] Saved snip: %s (%s KB)', filename, (buffer.length / 1024).toFixed(1));

    // Mark for agent processing before watcher picks it up
    queueNewFile(filepath);

    return filepath;
  });

  // Close/destroy the overlay (will be recreated fresh next capture)
  ipcMain.on('close-overlay', () => {
    const overlayWindow = getOverlayWindow();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy();
    }
  });

  // Open editor window with cropped image
  ipcMain.handle('open-editor', async (event, data) => {
    pendingEditorData = data;
    const win = createEditorWindowFn(data.cssWidth, data.cssHeight);
    editorWindowRef = win;

    // Clear references when editor closes to free memory (base64 image data)
    win.on('closed', () => {
      pendingEditorData = null;
      editorWindowRef = null;
    });

    return true;
  });

  // Editor requests image data on load
  ipcMain.handle('get-editor-image', async () => {
    return pendingEditorData;
  });

  // Close editor window
  ipcMain.on('close-editor', () => {
    if (editorWindowRef && !editorWindowRef.isDestroyed()) {
      editorWindowRef.close();
    }
  });

  // Get system fonts
  ipcMain.handle('get-system-fonts', async () => {
    return [
      'SF Pro', 'Helvetica Neue', 'Arial', 'Menlo', 'Monaco',
      'Courier New', 'Georgia', 'Times New Roman', 'Verdana',
      'Comic Sans MS', 'Impact', 'Futura', 'Avenir'
    ];
  });

  // Settings: API key
  ipcMain.handle('get-api-key', async () => {
    return getApiKey() || '';
  });

  ipcMain.handle('set-api-key', async (event, key) => {
    setApiKey(key);
    resetClient(); // Ensure cached Anthropic client picks up the new key
    updateWorkerApiKey(key); // Forward decrypted key to worker thread
    return true;
  });

  // Settings: Categories
  ipcMain.handle('get-categories', async () => {
    return getAllCategories();
  });

  ipcMain.handle('add-category', async (event, category) => {
    return addCustomCategory(category);
  });

  ipcMain.handle('remove-category', async (event, category) => {
    return removeCustomCategory(category);
  });

  // Settings: Tags with descriptions
  ipcMain.handle('get-tags-with-descriptions', async () => {
    return getAllTagsWithDescriptions();
  });

  ipcMain.handle('set-tag-description', async (event, { tag, description }) => {
    setTagDescription(tag, description);
    return getAllTagsWithDescriptions();
  });

  ipcMain.handle('add-category-with-description', async (event, { name, description }) => {
    return addCustomCategoryWithDescription(name, description);
  });

  // Search: get index
  ipcMain.handle('get-screenshot-index', async () => {
    return readIndex();
  });

  // Search: get thumbnail
  ipcMain.handle('get-thumbnail', async (event, filepath) => {
    try {
      const image = nativeImage.createFromPath(filepath);
      const resized = image.resize({ width: 200 });
      return resized.toDataURL();
    } catch (err) {
      console.warn('[Snip] Thumbnail failed:', filepath, err.message);
      return null;
    }
  });

  // Reveal in Finder
  ipcMain.handle('reveal-in-finder', async (event, filepath) => {
    shell.showItemInFolder(filepath);
    return true;
  });

  // Search: embed query
  ipcMain.handle('search-screenshots', async (event, query) => {
    const { searchScreenshots } = require('./organizer/embeddings');
    return searchScreenshots(query);
  });

  // Home: get screenshots directory path
  ipcMain.handle('get-screenshots-dir', async () => {
    return getScreenshotsDir();
  });

  // Home: list folder contents
  ipcMain.handle('list-folder', async (event, subdir) => {
    const baseDir = getScreenshotsDir();
    const targetDir = subdir ? path.join(baseDir, subdir) : baseDir;

    // Prevent path traversal
    const resolved = path.resolve(targetDir);
    if (!resolved.startsWith(path.resolve(baseDir))) {
      return [];
    }

    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      return entries.map(entry => {
        const fullPath = path.join(resolved, entry.name);
        let stat;
        try { stat = fs.statSync(fullPath); } catch { stat = null; }
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          fullPath: fullPath,
          size: stat ? stat.size : 0,
          mtime: stat ? stat.mtimeMs : 0
        };
      });
    } catch (err) {
      console.warn('[Snip] List folder failed:', resolved, err.message);
      return [];
    }
  });

  // Home: open screenshots folder in Finder
  ipcMain.handle('open-screenshots-folder', async () => {
    shell.openPath(getScreenshotsDir());
    return true;
  });

  // Delete a screenshot (move to Trash) and remove from index
  ipcMain.handle('delete-screenshot', async (event, filepath) => {
    const baseDir = path.resolve(getScreenshotsDir());
    const resolved = path.resolve(filepath);
    if (!resolved.startsWith(baseDir)) {
      return { success: false, error: 'Path outside screenshots directory' };
    }
    try {
      console.log('[Snip] Deleting file:', resolved);
      await shell.trashItem(resolved);
      const before = readIndex().length;
      removeFromIndex(resolved);
      const after = readIndex().length;
      console.log('[Snip] Index updated: removed %d entry (%d → %d)', before - after, before, after);
      return { success: true };
    } catch (err) {
      console.error('[Snip] Delete failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Delete a folder (move to Trash) and remove all its entries from index
  ipcMain.handle('delete-folder', async (event, folderPath) => {
    const baseDir = path.resolve(getScreenshotsDir());
    const resolved = path.resolve(folderPath);
    // Don't allow deleting the root screenshots directory
    if (!resolved.startsWith(baseDir) || resolved === baseDir) {
      return { success: false, error: 'Cannot delete this directory' };
    }
    try {
      console.log('[Snip] Deleting folder:', resolved);
      await shell.trashItem(resolved);
      const before = readIndex().length;
      removeFromIndexByDir(resolved);
      const after = readIndex().length;
      console.log('[Snip] Index updated: removed %d entries (%d → %d)', before - after, before, after);
      return { success: true };
    } catch (err) {
      console.error('[Snip] Delete folder failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Segmentation: check device support
  ipcMain.handle('check-segment-support', async () => {
    const { checkSupport } = require('./organizer/segmentation');
    return checkSupport();
  });

  // Segmentation: generate mask at click point
  ipcMain.handle('segment-at-point', async (event, { points, cssWidth, cssHeight }) => {
    const { generateMask } = require('./organizer/segmentation');

    if (!pendingEditorData || !pendingEditorData.croppedDataURL) {
      throw new Error('No editor image available for segmentation');
    }

    const image = nativeImage.createFromDataURL(pendingEditorData.croppedDataURL);
    let size = image.getSize();

    // Resize to max 1024px on longest side (saves memory, SAM resizes internally anyway)
    const MAX_DIM = 1024;
    let resized = image;
    if (size.width > MAX_DIM || size.height > MAX_DIM) {
      const scale = MAX_DIM / Math.max(size.width, size.height);
      resized = image.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale)
      });
      size = resized.getSize();
    }

    // Convert BGRA bitmap to RGBA
    const bitmap = resized.toBitmap();
    const rgba = new Uint8Array(bitmap.length);
    for (let i = 0; i < bitmap.length; i += 4) {
      rgba[i] = bitmap[i + 2];
      rgba[i + 1] = bitmap[i + 1];
      rgba[i + 2] = bitmap[i];
      rgba[i + 3] = bitmap[i + 3];
    }

    return generateMask(rgba, size.width, size.height, points, cssWidth, cssHeight);
  });

  // Theme
  ipcMain.handle('get-theme', async () => {
    return getTheme();
  });

  ipcMain.handle('set-theme', async (event, theme) => {
    setTheme(theme);
    // Broadcast to all windows
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('theme-changed', theme);
      }
    }
    return true;
  });

  // Resize editor window to fit toolbar
  ipcMain.handle('resize-editor', async (event, { minWidth }) => {
    try {
      if (!editorWindowRef || editorWindowRef.isDestroyed()) return;
      const [currentW, currentH] = editorWindowRef.getContentSize();
      if (currentW < minWidth) {
        editorWindowRef.setContentSize(minWidth, currentH);
        editorWindowRef.center();
      }
    } catch (e) {
      console.warn('[Snip] resize-editor failed:', e.message);
    }
  });
}

module.exports = { registerIpcHandlers };
