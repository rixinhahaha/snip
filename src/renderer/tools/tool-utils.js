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

  /**
   * Measure the width of text without wrapping.
   * Returns the width of the widest line (splitting on newlines).
   * Caches the measurement canvas for performance.
   */
  var _measureCtx = null;
  function measureTextWidth(text, fontSize, fontFamily) {
    if (!_measureCtx) {
      _measureCtx = document.createElement('canvas').getContext('2d');
    }
    _measureCtx.font = fontSize + 'px ' + fontFamily;
    var lines = text.split('\n');
    var maxW = 0;
    for (var i = 0; i < lines.length; i++) {
      var w = _measureCtx.measureText(lines[i]).width;
      if (w > maxW) maxW = w;
    }
    return maxW;
  }

  /**
   * Recolor a mask image to a flat highlight color, cropped to its bounding box.
   * Uses full-opacity color via source-in; caller sets Fabric opacity for translucency.
   * @param {string} maskDataURL
   * @param {string} hexColor - e.g. '#8B5CF6'
   * @param {function} callback - receives { dataURL, x, y, w, h } cropped to mask bounds
   */
  function recolorMaskToHighlight(maskDataURL, hexColor, callback) {
    var img = new Image();
    img.onload = function() {
      // Find bounding box of non-transparent pixels
      var fullC = document.createElement('canvas');
      fullC.width = img.width;
      fullC.height = img.height;
      var fullCtx = fullC.getContext('2d');
      fullCtx.drawImage(img, 0, 0);
      var data = fullCtx.getImageData(0, 0, fullC.width, fullC.height).data;

      var minX = fullC.width, minY = fullC.height, maxX = 0, maxY = 0;
      for (var py = 0; py < fullC.height; py++) {
        for (var px = 0; px < fullC.width; px++) {
          if (data[(py * fullC.width + px) * 4 + 3] > 10) {
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
      }

      if (maxX < minX) {
        // No visible pixels — return empty
        callback({ dataURL: '', x: 0, y: 0, w: 0, h: 0 });
        return;
      }

      var bw = maxX - minX + 1;
      var bh = maxY - minY + 1;

      // Crop to bounding box and recolor with full-opacity hex
      var c = document.createElement('canvas');
      c.width = bw;
      c.height = bh;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, minX, minY, bw, bh, 0, 0, bw, bh);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = hexColor;
      ctx.fillRect(0, 0, bw, bh);

      callback({ dataURL: c.toDataURL('image/png'), x: minX, y: minY, w: bw, h: bh });
    };
    img.src = maskDataURL;
  }

  /**
   * Extract the contour of a mask as a colored outline ring, cropped to bounding box.
   * Subtracts an eroded version from the original to get edge pixels.
   * @param {string} maskDataURL
   * @param {string} hexColor - e.g. '#8B5CF6'
   * @param {number} lineWidth - border thickness in px (default 3)
   * @param {function} callback - receives { dataURL, x, y, w, h } cropped to mask bounds
   */
  function maskToOutline(maskDataURL, hexColor, lineWidth, callback) {
    lineWidth = lineWidth || 3;
    var img = new Image();
    img.onload = function() {
      var w = img.width, h = img.height;

      // Canvas 1: original mask
      var c1 = document.createElement('canvas');
      c1.width = w; c1.height = h;
      var ctx1 = c1.getContext('2d');
      ctx1.drawImage(img, 0, 0);

      // Canvas 2: eroded mask (shrunk by lineWidth)
      var c2 = document.createElement('canvas');
      c2.width = w; c2.height = h;
      var ctx2 = c2.getContext('2d');
      ctx2.drawImage(img, lineWidth, lineWidth, w - lineWidth * 2, h - lineWidth * 2);

      // Subtract eroded from original to get border ring
      ctx1.globalCompositeOperation = 'destination-out';
      ctx1.drawImage(c2, 0, 0);

      // Recolor border to desired color
      ctx1.globalCompositeOperation = 'source-in';
      ctx1.fillStyle = hexColor;
      ctx1.fillRect(0, 0, w, h);

      // Find bounding box of the outline pixels and crop
      var data = ctx1.getImageData(0, 0, w, h).data;
      var minX = w, minY = h, maxX = 0, maxY = 0;
      for (var py = 0; py < h; py++) {
        for (var px = 0; px < w; px++) {
          if (data[(py * w + px) * 4 + 3] > 10) {
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
      }

      if (maxX < minX) {
        callback({ dataURL: '', x: 0, y: 0, w: 0, h: 0 });
        return;
      }

      var bw = maxX - minX + 1;
      var bh = maxY - minY + 1;

      // Crop to bounding box
      var cropC = document.createElement('canvas');
      cropC.width = bw;
      cropC.height = bh;
      var cropCtx = cropC.getContext('2d');
      cropCtx.drawImage(c1, minX, minY, bw, bh, 0, 0, bw, bh);

      callback({ dataURL: cropC.toDataURL('image/png'), x: minX, y: minY, w: bw, h: bh });
    };
    img.src = maskDataURL;
  }

  return {
    clampedScenePoint, createMosaicImage, showToast, hideToast,
    getAccentColor, hexToRgba, measureTextWidth,
    recolorMaskToHighlight, maskToOutline
  };
})();
