const { app, desktopCapturer, screen, dialog, shell } = require('electron');
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

/**
 * Show a dialog directing the user to grant Screen Recording permission.
 */
function showPermissionDialog(detail) {
  dialog.showMessageBox({
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

async function captureScreen(createOverlayFn, getOverlayFn) {
  // 1. Capture screenshot FIRST (before overlay appears)
  // Use whichever display the cursor is currently on
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
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
  const dataURL = matchedSource.thumbnail.toDataURL();

  // Guard against blank thumbnails (macOS 15+ returns these without permission)
  if (!dataURL || dataURL.length < 100) {
    console.error('[Snip] Screen capture returned a blank image — permission likely not granted.');
    showPermissionDialog('Snip captured a blank screen. Grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording, then restart Snip.');
    throw new Error('Screen capture returned blank — permission likely not granted');
  }

  // 2. Create fresh overlay on the current Space
  const overlayWindow = createOverlayFn();

  // 3. Set native macOS behavior: move window to whichever Space is active
  if (windowUtils) {
    try {
      const handle = overlayWindow.getNativeWindowHandle();
      windowUtils.setMoveToActiveSpace(handle);
    } catch (e) {
      console.warn('[Snip] Failed to set MoveToActiveSpace:', e.message);
    }
  }

  // 4. Wait for HTML to finish loading, then show and send screenshot data
  overlayWindow.webContents.once('did-finish-load', () => {
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
    // Force position to cover full screen including menu bar
    // (macOS may push the window below menu bar on show)
    const bounds = cursorDisplay.bounds;
    overlayWindow.setBounds({ x: bounds.x, y: bounds.y, width, height });
    overlayWindow.webContents.send('screenshot-captured', { dataURL, displayOrigin: { x: bounds.x, y: bounds.y } });
  });
}

module.exports = { captureScreen };
