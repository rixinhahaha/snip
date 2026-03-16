const { app, BrowserWindow, desktopCapturer, screen, dialog, shell } = require('electron');
const path = require('path');

// Load native addon for macOS Space behavior.
// In the packaged app the addon lives in Resources/native/ (via extraResources).
// In dev mode it lives at the project root build/Release/.
let windowUtils = null;
try {
  const packedPath = path.join(process.resourcesPath, 'native', 'window_utils.node');
  const devPath = path.join(__dirname, '..', '..', 'build', 'Release', 'window_utils.node');
  windowUtils = require(app.isPackaged ? packedPath : devPath);
} catch (e) {
  console.warn('[Snip] Native window_utils addon not found — overlay may appear on wrong Space.', e.message);
}

// Stored NativeImage from the last capture — converted to dataURL on demand (deferred)
let storedNativeImage = null;

/**
 * Show a dialog directing the user to grant Screen Recording permission.
 */
function showPermissionDialog(detail) {
  var parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find(function (w) { return !w.isDestroyed(); }) || null;
  var showFn = parent ? dialog.showMessageBox.bind(dialog, parent) : dialog.showMessageBox.bind(dialog);
  showFn({
    type: 'warning',
    title: 'Screen Recording Permission Required',
    message: 'Snip needs Screen Recording permission to capture snips.',
    detail: detail || 'Open System Settings > Privacy & Security > Screen Recording, then enable Snip.',
    buttons: ['Open System Settings', 'Cancel'],
    defaultId: 0
  }).then(function (result) {
    if (result.response === 0) {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
  });
}

/**
 * Get the window list for the given display (sync, must run before overlay appears).
 */
function getWindowList(cursorDisplay) {
  let windowList = [];
  if (windowUtils && windowUtils.getWindowList) {
    try {
      const { width, height } = cursorDisplay.size;
      const bounds = cursorDisplay.bounds;
      windowList = windowUtils.getWindowList(bounds.x, bounds.y, width, height);
      // Convert macOS global coords to display-relative coords
      windowList = windowList.map(function (w) {
        return {
          x: w.x - bounds.x,
          y: w.y - bounds.y,
          width: w.width,
          height: w.height,
          owner: w.owner,
          name: w.name,
          pid: w.pid
        };
      });
    } catch (e) {
      console.warn('[Snip] Failed to get window list:', e.message);
    }
  }
  return windowList;
}

/**
 * Capture screen image via desktopCapturer. Stores the NativeImage for deferred
 * serialization — toDataURL() is only called when the renderer requests it at crop time.
 */
async function captureScreenImage(cursorDisplay) {
  const { width, height } = cursorDisplay.size;
  const scaleFactor = cursorDisplay.scaleFactor;

  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: width * scaleFactor,
        height: height * scaleFactor
      }
    });
  } catch (err) {
    console.error('[Snip] Screen capture failed:', err.message);
    showPermissionDialog('Screen capture failed. Grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording, then restart Snip.');
    throw err;
  }

  if (sources.length === 0) {
    console.error('[Snip] No screen sources found.');
    showPermissionDialog('No screen sources found. Grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording, then restart Snip.');
    throw new Error('No screen sources available');
  }

  // Match source to the cursor's display; fall back to first source
  const targetId = String(cursorDisplay.id);
  const matchedSource = sources.find(function (s) { return s.display_id === targetId; }) || sources[0];
  storedNativeImage = matchedSource.thumbnail;

  // Guard against blank thumbnails (macOS 15+ returns these without permission).
  // Use cheap checks instead of toPNG() which encodes the entire image (~300ms).
  function rejectBlankCapture(logMsg) {
    console.error(logMsg);
    showPermissionDialog('Snip captured a blank screen. Grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording, then restart Snip.');
    storedNativeImage = null;
    throw new Error('Screen capture returned blank — permission likely not granted');
  }

  if (storedNativeImage.isEmpty()) {
    rejectBlankCapture('[Snip] Screen capture returned an empty image — permission likely not granted.');
  }
  var imgSize = storedNativeImage.getSize();
  if (imgSize.width < 10 || imgSize.height < 10) {
    rejectBlankCapture('[Snip] Screen capture returned a tiny image (' + imgSize.width + 'x' + imgSize.height + ') — permission likely not granted.');
  }
  // Spot-check: crop a 10x10 region from the center and check alpha bytes.
  // macOS returns all-zero BGRA data (alpha=0) without permission, while a
  // legitimate black screen has alpha=255. Checking alpha avoids false positives.
  var cx = Math.floor(imgSize.width / 2);
  var cy = Math.floor(imgSize.height / 2);
  var sample = storedNativeImage.crop({ x: cx - 5, y: cy - 5, width: 10, height: 10 });
  var sampleBitmap = sample.toBitmap();
  var allTransparent = true;
  for (var i = 3; i < sampleBitmap.length; i += 4) {
    if (sampleBitmap[i] !== 0) { allTransparent = false; break; }
  }
  if (allTransparent) {
    rejectBlankCapture('[Snip] Screen capture returned an all-transparent image — permission likely not granted.');
  }
}

async function captureScreen(createOverlayFn, getOverlayFn, opts) {
  var mode = (opts && opts.mode) || 'capture';
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width, height } = cursorDisplay.size;

  // 1. Get window list BEFORE overlay appears (sync, so overlay isn't in the list)
  const windowList = getWindowList(cursorDisplay);

  // 2. Parallel: capture screen image + prepare overlay window
  const [, overlayWindow] = await Promise.all([
    captureScreenImage(cursorDisplay),
    createOverlayFn()
  ]);

  // 3. Set native macOS behavior: move window to whichever Space is active
  if (windowUtils) {
    try {
      const handle = overlayWindow.getNativeWindowHandle();
      windowUtils.setMoveToActiveSpace(handle);
    } catch (e) {
      console.warn('[Snip] Failed to set MoveToActiveSpace:', e.message);
    }
  }

  // 4. Show overlay and send metadata (image data is deferred until crop time)
  // In the packaged app LSUIElement:true makes this a background agent —
  // explicitly activate so the overlay can receive keyboard events.
  // Skip in dev mode: app.dock.hide() already handles it and
  // app.focus() would cause unwanted Space switching.
  if (app.isPackaged) {
    app.focus({ steal: true });
  }

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.show();
  overlayWindow.focus();
  // If the user switches away (Cmd+Tab, click another app), cancel the capture.
  // The stale screenshot would be confusing; they can re-trigger the shortcut.
  overlayWindow.on('blur', () => {
    if (!overlayWindow.isDestroyed()) overlayWindow.destroy();
  });
  // Force position to cover full screen including menu bar
  // (macOS may push the window below menu bar on show)
  const bounds = cursorDisplay.bounds;
  overlayWindow.setBounds({ x: bounds.x, y: bounds.y, width, height });
  const actualBounds = overlayWindow.getBounds();
  overlayWindow.webContents.send('screenshot-captured', {
    displayOrigin: { x: bounds.x, y: bounds.y },
    overlayOrigin: { x: actualBounds.x, y: actualBounds.y },
    windowList, mode
  });
}

/**
 * Return the captured screenshot as a data URL. Called on demand by the renderer
 * at crop time, deferring the expensive toDataURL() off the critical show path.
 */
function getCapturedImage() {
  if (!storedNativeImage) return null;
  return storedNativeImage.toDataURL();
}

module.exports = { captureScreen, getCapturedImage };
