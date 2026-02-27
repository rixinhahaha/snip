/* global SelectionTool */

(function() {
  'use strict';

  let capturedDataURL = null;
  let selectionInstance = null;

  window.snip.onScreenshotCaptured(async (data) => {
    capturedDataURL = data.dataURL;
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
        cropAndOpenEditor(region);
      },
      function onCancel() {
        document.getElementById('selection-hint').classList.add('hidden');
        if (selectionInstance) { selectionInstance.cleanup(); selectionInstance = null; }
        window.snip.closeOverlay();
      }
    );
    selectionInstance.activate();
  }

  function cropAndOpenEditor(region) {
    const fullImg = new Image();
    fullImg.onload = () => {
      let croppedDataURL;
      let cssWidth, cssHeight;

      if (region) {
        cssWidth = region.width;
        cssHeight = region.height;

        // Use actual image dimensions for coordinate mapping instead of dpr.
        // The screenshot covers the full physical display, but the overlay window
        // may be offset from the screen origin (e.g., macOS menu bar pushes it down).
        const imgW = fullImg.naturalWidth;
        const imgH = fullImg.naturalHeight;
        const scaleX = imgW / window.screen.width;
        const scaleY = imgH / window.screen.height;

        // Account for overlay window's screen offset (menu bar / notch on macOS)
        const winOffsetX = window.screenX || 0;
        const winOffsetY = window.screenY || 0;

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
        croppedDataURL = cropCanvas.toDataURL('image/png');
      } else {
        // Full screen capture
        cssWidth = window.innerWidth;
        cssHeight = window.innerHeight;
        croppedDataURL = capturedDataURL;
      }

      const dpr = window.devicePixelRatio || 1;
      window.snip.openEditor({
        croppedDataURL: croppedDataURL,
        cssWidth: cssWidth,
        cssHeight: cssHeight,
        scaleFactor: dpr
      });

      // Cleanup overlay
      if (selectionInstance) { selectionInstance.cleanup(); selectionInstance = null; }
      window.snip.closeOverlay();
    };
    fullImg.src = capturedDataURL;
  }
})();
