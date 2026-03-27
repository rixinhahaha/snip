/* global SelectionTool */

(function() {
  'use strict';

  let displayOrigin = { x: 0, y: 0 };
  let overlayOrigin = { x: 0, y: 0 };
  let selectionInstance = null;
  let captureMode = 'capture';

  let windowList = [];
  let cachedDataURL = null;

  window.snip.onScreenshotCaptured(async (data) => {
    cachedDataURL = data.dataURL;
    displayOrigin = data.displayOrigin || { x: 0, y: 0 };
    captureMode = data.mode || 'capture';
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Convert window list from display-relative to overlay-viewport-relative coords.
    // The offset is how far macOS shifted the overlay from the display origin
    // (e.g., pushed below menu bar). Main process sends both the requested
    // display origin and the actual overlay position after setBounds.
    overlayOrigin = data.overlayOrigin || displayOrigin;
    var winOffsetX = overlayOrigin.x - displayOrigin.x;
    var winOffsetY = overlayOrigin.y - displayOrigin.y;

    // Display the captured screenshot as a frozen background so hover states
    // on the underlying desktop are preserved visually during area selection.
    // The screenshot covers the full display, but the overlay window may be
    // offset (e.g. below menu bar), so shift the image to compensate.
    const bgImg = document.getElementById('frozen-screen');
    var displaySize = data.displaySize || { width: width, height: height };
    bgImg.style.width = displaySize.width + 'px';
    bgImg.style.height = displaySize.height + 'px';
    bgImg.style.top = (-winOffsetY) + 'px';
    bgImg.style.left = (-winOffsetX) + 'px';
    bgImg.src = cachedDataURL;
    bgImg.classList.remove('hidden');
    windowList = (data.windowList || []).map(function(w) {
      // Convert to overlay-viewport-relative coords, then clip to viewport bounds.
      // Windows partially off-screen (e.g. spanning two displays, or behind the menu bar)
      // are clipped so hover detection and snap use only the visible portion.
      const wx = w.x - winOffsetX;
      const wy = w.y - winOffsetY;
      const clipX = Math.max(0, wx);
      const clipY = Math.max(0, wy);
      const clipX2 = Math.min(width, wx + w.width);
      const clipY2 = Math.min(height, wy + w.height);
      return { x: clipX, y: clipY, width: clipX2 - clipX, height: clipY2 - clipY, owner: w.owner, name: w.name, pid: w.pid };
    }).filter(function(w) {
      // Drop windows with less than 50×50 visible area in the viewport
      return w.width > 50 && w.height > 50;
    });

    // Reset previous selection
    if (selectionInstance) {
      selectionInstance.cleanup();
      selectionInstance = null;
    }

    document.getElementById('selection-hint').classList.add('hidden');

    enterSelectionMode(width, height);
  });

  function enterSelectionMode(fullWidth, fullHeight) {
    document.getElementById('selection-hint').classList.remove('hidden');

    selectionInstance = SelectionTool.attach(
      null, fullWidth, fullHeight,
      function onComplete(region) {
        document.getElementById('selection-hint').classList.add('hidden');
        if (captureMode === 'quick-snip') {
          cropAndCopyToClipboard(region);
        } else {
          cropAndOpenEditor(region);
        }
      },
      function onCancel() {
        document.getElementById('selection-hint').classList.add('hidden');
        if (selectionInstance) { selectionInstance.cleanup(); selectionInstance = null; }
        window.snip.closeOverlay();
      },
      windowList
    );
    selectionInstance.activate();
  }

  function cropRegion(fullImg, region, fullDataURL) {
    if (!region) return fullDataURL;

    const imgW = fullImg.naturalWidth;
    const imgH = fullImg.naturalHeight;
    const scaleX = imgW / window.innerWidth;
    const scaleY = imgH / window.innerHeight;

    // Account for overlay window's offset within its display (menu bar / notch on macOS)
    const winOffsetX = overlayOrigin.x - displayOrigin.x;
    const winOffsetY = overlayOrigin.y - displayOrigin.y;

    const physX = Math.round((region.x + winOffsetX) * scaleX);
    const physY = Math.round((region.y + winOffsetY) * scaleY);
    const physW = Math.round(region.width * scaleX);
    const physH = Math.round(region.height * scaleY);

    // Clamp to image bounds
    const clampedX = Math.max(0, Math.min(physX, imgW - 1));
    const clampedY = Math.max(0, Math.min(physY, imgH - 1));
    const clampedW = Math.min(physW, imgW - clampedX);
    const clampedH = Math.min(physH, imgH - clampedY);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = clampedW;
    cropCanvas.height = clampedH;
    const ctx = cropCanvas.getContext('2d');
    ctx.drawImage(fullImg, clampedX, clampedY, clampedW, clampedH, 0, 0, clampedW, clampedH);
    return cropCanvas.toDataURL('image/png');
  }

  function finishAndClose() {
    if (selectionInstance) { selectionInstance.cleanup(); selectionInstance = null; }
    cachedDataURL = null;
    const bgImg = document.getElementById('frozen-screen');
    bgImg.classList.add('hidden');
    bgImg.src = '';
    window.snip.closeOverlay();
  }

  async function cropAndCopyToClipboard(region) {
    const dataURL = cachedDataURL || await window.snip.getCaptureImage();
    const fullImg = new Image();
    fullImg.onload = () => {
      window.snip.copyToClipboard(cropRegion(fullImg, region, dataURL));
      window.snip.showNotification('Copied to clipboard');
      finishAndClose();
    };
    fullImg.src = dataURL;
  }

  async function cropAndOpenEditor(region) {
    const dataURL = cachedDataURL || await window.snip.getCaptureImage();
    const fullImg = new Image();
    fullImg.onload = () => {
      const croppedDataURL = cropRegion(fullImg, region, dataURL);
      const cssWidth = region ? region.width : window.innerWidth;
      const cssHeight = region ? region.height : window.innerHeight;

      window.snip.openEditor({
        croppedDataURL: croppedDataURL,
        cssWidth: cssWidth,
        cssHeight: cssHeight,
        scaleFactor: window.devicePixelRatio || 1
      });
      finishAndClose();
    };
    fullImg.src = dataURL;
  }
})();
