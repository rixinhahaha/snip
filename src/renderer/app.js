/* global SelectionTool */

(function() {
  'use strict';

  let capturedDataURL = null;
  let displayOrigin = { x: 0, y: 0 };
  let selectionInstance = null;
  let captureMode = 'capture';

  let windowList = [];

  window.snip.onScreenshotCaptured(async (data) => {
    capturedDataURL = data.dataURL;
    displayOrigin = data.displayOrigin || { x: 0, y: 0 };
    windowList = data.windowList || [];
    captureMode = data.mode || 'capture';
    const width = window.innerWidth;
    const height = window.innerHeight;

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

  function cropRegion(fullImg, region) {
    if (!region) return capturedDataURL;

    const imgW = fullImg.naturalWidth;
    const imgH = fullImg.naturalHeight;
    const scaleX = imgW / window.screen.width;
    const scaleY = imgH / window.screen.height;

    // Account for overlay window's offset within its display (menu bar / notch on macOS)
    const winOffsetX = (window.screenX || 0) - displayOrigin.x;
    const winOffsetY = (window.screenY || 0) - displayOrigin.y;

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
    window.snip.closeOverlay();
  }

  function cropAndCopyToClipboard(region) {
    const fullImg = new Image();
    fullImg.onload = () => {
      window.snip.copyToClipboard(cropRegion(fullImg, region));
      finishAndClose();
    };
    fullImg.src = capturedDataURL;
  }

  function cropAndOpenEditor(region) {
    const fullImg = new Image();
    fullImg.onload = () => {
      const croppedDataURL = cropRegion(fullImg, region);
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
    fullImg.src = capturedDataURL;
  }
})();
