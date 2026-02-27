/* exported ToolUtils */

const ToolUtils = (() => {
  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  /**
   * Get the scene-coordinate pointer position, clamped within canvas bounds.
   * All tools should use this for consistent coordinate handling.
   */
  function clampedScenePoint(canvas, e) {
    const pt = canvas.getScenePoint(e);
    return {
      x: clamp(pt.x, 0, canvas.width),
      y: clamp(pt.y, 0, canvas.height)
    };
  }

  /**
   * Create a mosaic/pixelated image of a region from the background image.
   * Shared by rectangle blur mode and blur brush tool.
   * @param {fabric.Canvas} canvas - must have canvas._bgOriginalImg set
   * @param {number} x - left position in CSS coords
   * @param {number} y - top position in CSS coords
   * @param {number} w - width in CSS coords
   * @param {number} h - height in CSS coords
   * @param {number} [pixelSize=10] - mosaic block size
   * @returns {string|null} data URL of the pixelated region, or null if no bg image
   */
  function createMosaicImage(canvas, x, y, w, h, pixelSize) {
    var origImg = canvas._bgOriginalImg;
    if (!origImg) return null;

    pixelSize = pixelSize || 10;

    var scaleX = origImg.naturalWidth / canvas.width;
    var scaleY = origImg.naturalHeight / canvas.height;

    var srcX = x * scaleX;
    var srcY = y * scaleY;
    var srcW = w * scaleX;
    var srcH = h * scaleY;

    var smallW = Math.max(1, Math.ceil(w / pixelSize));
    var smallH = Math.max(1, Math.ceil(h / pixelSize));

    var smallCanvas = document.createElement('canvas');
    smallCanvas.width = smallW;
    smallCanvas.height = smallH;
    var smallCtx = smallCanvas.getContext('2d');
    smallCtx.drawImage(origImg, srcX, srcY, srcW, srcH, 0, 0, smallW, smallH);

    var outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    var outCtx = outCanvas.getContext('2d');
    outCtx.imageSmoothingEnabled = false;
    outCtx.drawImage(smallCanvas, 0, 0, w, h);

    return outCanvas.toDataURL('image/png');
  }

  // ── Toast notification helpers ──

  let toastTimer = null;

  /**
   * Show a toast notification in the editor.
   * @param {string} message - Text to display
   * @param {'processing'|'success'|'error'} type - Toast style
   * @param {number} [duration=0] - Auto-dismiss after ms (0 = stays until replaced)
   */
  function showToast(message, type, duration) {
    var toast = document.getElementById('toast');
    var icon = document.getElementById('toast-icon');
    var msg = document.getElementById('toast-message');
    if (!toast) return;

    // Clear any pending auto-dismiss
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }

    // Set icon based on type
    if (type === 'processing') {
      icon.textContent = '\u25E6'; // spinning ring character
    } else if (type === 'success') {
      icon.textContent = '\u2714'; // checkmark
    } else if (type === 'error') {
      icon.textContent = '\u2718'; // cross
    } else {
      icon.textContent = '';
    }

    msg.textContent = message;

    // Remove old type classes, add new one
    toast.classList.remove('toast-processing', 'toast-success', 'toast-error', 'hidden');
    toast.classList.add('toast-' + type);

    // Auto-dismiss
    if (duration && duration > 0) {
      toastTimer = setTimeout(function() {
        hideToast();
      }, duration);
    }
  }

  function hideToast() {
    var toast = document.getElementById('toast');
    if (toast) toast.classList.add('hidden');
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  /** Read the current theme's --accent color from CSS. */
  function getAccentColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  }

  /** Convert hex color to rgba string. */
  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  return { clampedScenePoint, createMosaicImage, showToast, hideToast, getAccentColor, hexToRgba };
})();
