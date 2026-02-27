const { desktopCapturer, screen } = require('electron');
const path = require('path');

// Load native addon for macOS Space behavior
let windowUtils = null;
try {
  windowUtils = require(path.join(__dirname, '..', '..', 'build', 'Release', 'window_utils.node'));
} catch (e) {
  console.warn('[Snip] Native window_utils addon not found — overlay may appear on wrong Space.', e.message);
}

async function captureScreen(createOverlayFn, getOverlayFn) {
  // 1. Capture screenshot FIRST (before overlay appears)
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  const scaleFactor = primaryDisplay.scaleFactor;

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
    console.error('[Snip] Grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording.');
    throw err;
  }

  if (sources.length === 0) {
    console.error('[Snip] No screen sources found. Check Screen Recording permission.');
    throw new Error('No screen sources available');
  }

  const primarySource = sources[0];
  const dataURL = primarySource.thumbnail.toDataURL();

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
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.show();
    overlayWindow.focus();
    // Force position to cover full screen including menu bar
    // (macOS may push the window below menu bar on show)
    overlayWindow.setBounds({ x: 0, y: 0, width, height });
    overlayWindow.webContents.send('screenshot-captured', { dataURL });
  });
}

module.exports = { captureScreen };
