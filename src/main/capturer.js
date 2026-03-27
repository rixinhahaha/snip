const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const path = require('path');
const platform = require('./platform');

// Stored NativeImage and its data URL from the last capture
let storedNativeImage = null;
let storedDataURL = null;

/**
 * Capture screen image via desktopCapturer. Stores the NativeImage; the data URL
 * is converted eagerly so the overlay can display a frozen frame of the screen.
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
    throw err;
  }

  if (sources.length === 0) {
    console.error('[Snip] No screen sources found.');
    throw new Error('No screen sources available — permission likely not granted');
  }

  // Match source to the cursor's display; fall back to first source
  const targetId = String(cursorDisplay.id);
  const matchedSource = sources.find(function (s) { return s.display_id === targetId; }) || sources[0];
  storedNativeImage = matchedSource.thumbnail;

  // Guard against blank thumbnails (macOS 15+ returns these without permission).
  // Use cheap checks instead of toPNG() which encodes the entire image (~300ms).
  function rejectBlankCapture(logMsg) {
    console.error(logMsg);
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
  const windowList = platform.getWindowList(cursorDisplay);

  // 2. Parallel: capture screen image + prepare overlay window
  const [, overlayWindow] = await Promise.all([
    captureScreenImage(cursorDisplay),
    createOverlayFn()
  ]);

  // 3. Move window to whichever Space/desktop is active (macOS Spaces, no-op elsewhere)
  platform.setMoveToActiveSpace(overlayWindow);

  // 4. Convert screenshot to data URL now so the overlay can display a frozen frame
  storedDataURL = storedNativeImage.toDataURL();

  // 5. Show overlay and send screenshot data
  // Explicitly activate so the overlay can receive keyboard events.
  // On macOS packaged builds, LSUIElement:true makes this a background agent —
  // app.focus() is needed to bring it forward. Skip in macOS dev mode where
  // app.dock.hide() already handles it and app.focus() causes Space switching.
  // On Linux, always call app.focus() — the WM won't raise a background window otherwise.
  if (app.isPackaged || platform.shouldStealFocusOnCapture()) {
    app.focus({ steal: true });
  }

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.show();
  overlayWindow.focus();
  // If the user switches away (Cmd+Tab, click another app), cancel the capture.
  // The stale screenshot would be confusing; they can re-trigger the shortcut.
  // On Linux, the overlay may not have focus yet when shown — defer the blur
  // listener so the WM has time to process the focus request.
  var attachBlurCancel = function () {
    overlayWindow.on('blur', function () {
      if (!overlayWindow.isDestroyed()) overlayWindow.destroy();
    });
  };
  var blurDelay = platform.getBlurCancelDelay ? platform.getBlurCancelDelay() : 0;
  if (blurDelay > 0) {
    setTimeout(attachBlurCancel, blurDelay);
  } else {
    attachBlurCancel();
  }
  // Force position to cover full screen including menu bar
  // (macOS may push the window below menu bar on show)
  const bounds = cursorDisplay.bounds;
  overlayWindow.setBounds({ x: bounds.x, y: bounds.y, width, height });
  const actualBounds = overlayWindow.getBounds();
  overlayWindow.webContents.send('screenshot-captured', {
    dataURL: storedDataURL,
    displaySize: { width, height },
    displayOrigin: { x: bounds.x, y: bounds.y },
    overlayOrigin: { x: actualBounds.x, y: actualBounds.y },
    windowList, mode
  });
}

/**
 * Return the captured screenshot as a data URL (already converted at capture time).
 */
function getCapturedImage() {
  if (!storedDataURL) return null;
  return storedDataURL;
}

module.exports = { captureScreen, getCapturedImage };
