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

  // ── Shared segment tag constants ──

  /** Fixed outline width (px) for the highlight overlay border ring. */
  var SEGMENT_OUTLINE_WIDTH = 10;

  /** Opacity used for the segment highlight overlay on canvas. */
  var SEGMENT_OVERLAY_OPACITY = 0.35;

  /**
   * Find the bounding box of non-transparent pixels on a canvas context.
   * @returns {{ minX, minY, w, h }} or null if no visible pixels.
   */
  function _findMaskBounds(ctx, w, h) {
    var data = ctx.getImageData(0, 0, w, h).data;
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
    if (maxX < minX) return null;
    return { minX: minX, minY: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /**
   * Crop a canvas to a bounding box and return a data URL.
   */
  function _cropCanvas(srcCanvas, bounds) {
    var c = document.createElement('canvas');
    c.width = bounds.w;
    c.height = bounds.h;
    c.getContext('2d').drawImage(srcCanvas, bounds.minX, bounds.minY, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
    return c.toDataURL('image/png');
  }

  /**
   * Recolor a mask to a highlight fill with an outline ring on top, cropped to bounding box.
   * Produces a translucent fill + dilation-based outline ring on a single canvas so that
   * both highlight and outline thickness are always visible and adjustable.
   * @param {string} maskDataURL
   * @param {string} hexColor - e.g. '#8B5CF6'
   * @param {number} outlineWidth - border thickness in px (default 16)
   * @param {function} callback - receives { dataURL, x, y, w, h } cropped to combined bounds
   */
  function recolorMaskWithOutline(maskDataURL, hexColor, outlineWidth, callback) {
    outlineWidth = outlineWidth || 16;
    var img = new Image();
    img.onload = function() {
      var w = img.width, h = img.height;

      // Final compositing canvas
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');

      // Step 1: Draw highlight fill (mask recolored to hexColor)
      ctx.drawImage(img, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = hexColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';

      // Step 2: Create outline ring via dilation on a separate canvas
      var oc = document.createElement('canvas');
      oc.width = w; oc.height = h;
      var octx = oc.getContext('2d');

      var steps = 24;
      for (var i = 0; i < steps; i++) {
        var angle = (2 * Math.PI * i) / steps;
        var dx = Math.cos(angle) * outlineWidth;
        var dy = Math.sin(angle) * outlineWidth;
        octx.drawImage(img, dx, dy);
      }
      octx.globalCompositeOperation = 'destination-out';
      octx.drawImage(img, 0, 0);
      octx.globalCompositeOperation = 'source-in';
      octx.fillStyle = hexColor;
      octx.fillRect(0, 0, w, h);

      // Step 3: Composite outline on top of highlight
      ctx.drawImage(oc, 0, 0);

      // Find bounding box and crop
      var bounds = _findMaskBounds(ctx, w, h);
      if (!bounds) {
        callback({ dataURL: '', x: 0, y: 0, w: 0, h: 0 });
        return;
      }

      callback({ dataURL: _cropCanvas(c, bounds), x: bounds.minX, y: bounds.minY, w: bounds.w, h: bounds.h });
    };
    img.src = maskDataURL;
  }

  // ── Tag linkage helpers ──

  var _tagIdCounter = 0;

  /** Generate a unique ID for linking tag parts (tip, line, label group). */
  function nextTagId() {
    return 'snip-tag-' + (++_tagIdCounter);
  }

  /**
   * Compute the point on the edge of a bounding rect closest to a tip point.
   * Used to connect the leader line from the tip to the nearest edge of the label group.
   * @param {number} tipX
   * @param {number} tipY
   * @param {{left:number, top:number, width:number, height:number}} bounds
   * @returns {{x:number, y:number}}
   */
  function lineEndpointForTag(tipX, tipY, bounds) {
    var cx = bounds.left + bounds.width / 2;
    var cy = bounds.top + bounds.height / 2;
    var dx = tipX - cx;
    var dy = tipY - cy;
    if (dx === 0 && dy === 0) {
      return { x: bounds.left, y: cy };
    }
    var halfW = bounds.width / 2;
    var halfH = bounds.height / 2;
    var tX = halfW > 0 ? halfW / Math.abs(dx) : 9999;
    var tY = halfH > 0 ? halfH / Math.abs(dy) : 9999;
    var t = Math.min(tX, tY);
    return {
      x: cx + dx * t,
      y: cy + dy * t
    };
  }

  return {
    SEGMENT_OUTLINE_WIDTH, SEGMENT_OVERLAY_OPACITY,
    clampedScenePoint, createMosaicImage, showToast, hideToast,
    getAccentColor, hexToRgba, measureTextWidth,
    recolorMaskWithOutline,
    nextTagId, lineEndpointForTag
  };
})();
