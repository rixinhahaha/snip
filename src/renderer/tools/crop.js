/* global fabric, ToolUtils */
/* exported CropTool */

const CropTool = (() => {
  function parseRatio(str) {
    if (!str || str === 'free') return null;
    var parts = str.split(':');
    return { w: parseInt(parts[0], 10), h: parseInt(parts[1], 10) };
  }

  function attach(canvas, callbacks) {
    var state = 'idle'; // 'idle' | 'drawing' | 'adjusting'
    var cropRect = null;
    var startX = 0, startY = 0;
    var keyHandler = null;
    var preCropState = null;

    // Aspect ratio state
    var activeRatio = null;
    var activeRatioName = null;

    var actionsEl = document.getElementById('crop-actions');
    var applyBtn = document.getElementById('crop-apply');
    var cancelBtn = document.getElementById('crop-cancel');
    var ratioBar = document.getElementById('crop-ratio-bar');
    var ratioButtons = ratioBar ? ratioBar.querySelectorAll('.crop-ratio-btn') : [];

    var dimOverlay = null;

    function getAccent() {
      return ToolUtils.getAccentColor();
    }

    function getCssDims() {
      return callbacks.getCssDimensions();
    }

    // --- Ratio ---

    function onRatioClick(e) {
      e.stopPropagation();
      e.preventDefault();
      var btn = e.currentTarget;
      var ratioStr = btn.getAttribute('data-ratio');
      activeRatio = parseRatio(ratioStr);
      activeRatioName = ratioStr === 'free' ? null : ratioStr;
      for (var i = 0; i < ratioButtons.length; i++) {
        ratioButtons[i].classList.remove('active');
      }
      btn.classList.add('active');

      if (state === 'adjusting' && cropRect && activeRatio) {
        reconstrainCropRect();
      }
    }

    function reconstrainCropRect() {
      if (!cropRect || !activeRatio) return;
      var dims = getCssDims();
      var w = cropRect.width * (cropRect.scaleX || 1);
      var h = cropRect.height * (cropRect.scaleY || 1);

      var ratioW, ratioH;
      if (w >= h) {
        ratioW = activeRatio.w;
        ratioH = activeRatio.h;
      } else {
        ratioW = activeRatio.h;
        ratioH = activeRatio.w;
      }

      var newW, newH;
      var hFromW = w * ratioH / ratioW;
      if (hFromW <= h) {
        newW = w;
        newH = hFromW;
      } else {
        newH = h;
        newW = h * ratioW / ratioH;
      }

      if (cropRect.left + newW > dims.w) newW = dims.w - cropRect.left;
      if (cropRect.top + newH > dims.h) newH = dims.h - cropRect.top;

      cropRect.set({ width: newW, height: newH, scaleX: 1, scaleY: 1 });
      cropRect.setCoords();
      updateDimOverlay();
      canvas.renderAll();
    }

    function constrainToRatio(sX, sY, curX, curY) {
      if (!activeRatio) return { x: curX, y: curY };

      var dx = curX - sX;
      var dy = curY - sY;
      var absDx = Math.abs(dx);
      var absDy = Math.abs(dy);

      var ratioW, ratioH;
      if (absDx >= absDy) {
        ratioW = activeRatio.w;
        ratioH = activeRatio.h;
      } else {
        ratioW = activeRatio.h;
        ratioH = activeRatio.w;
      }

      var hFromW = absDx * ratioH / ratioW;
      var wFromH = absDy * ratioW / ratioH;

      var finalW, finalH;
      if (hFromW <= absDy) {
        finalW = absDx;
        finalH = hFromW;
      } else {
        finalW = wFromH;
        finalH = absDy;
      }

      return {
        x: sX + finalW * (dx >= 0 ? 1 : -1),
        y: sY + finalH * (dy >= 0 ? 1 : -1)
      };
    }

    // --- Dim overlay ---

    function createDimOverlay() {
      removeDimOverlay();
      dimOverlay = document.createElement('div');
      dimOverlay.id = 'crop-dim-overlay';
      dimOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);pointer-events:none;z-index:1;';
      var imageArea = document.getElementById('image-area');
      if (imageArea) imageArea.appendChild(dimOverlay);
      updateDimOverlay();
    }

    function updateDimOverlay() {
      if (!dimOverlay || !cropRect) return;
      var dims = getCssDims();

      var cl = cropRect.left;
      var ct = cropRect.top;
      var cw = cropRect.width * (cropRect.scaleX || 1);
      var ch = cropRect.height * (cropRect.scaleY || 1);

      var lp = (cl / dims.w * 100);
      var tp = (ct / dims.h * 100);
      var rp = ((cl + cw) / dims.w * 100);
      var bp = ((ct + ch) / dims.h * 100);

      dimOverlay.style.clipPath =
        'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ' +
        lp + '% ' + tp + '%, ' +
        lp + '% ' + bp + '%, ' +
        rp + '% ' + bp + '%, ' +
        rp + '% ' + tp + '%, ' +
        lp + '% ' + tp + '%)';
    }

    function removeDimOverlay() {
      if (dimOverlay && dimOverlay.parentNode) {
        dimOverlay.parentNode.removeChild(dimOverlay);
      }
      dimOverlay = null;
    }

    // --- Actions ---

    function showActions() {
      if (actionsEl) actionsEl.classList.remove('hidden');
    }

    function hideActions() {
      if (actionsEl) actionsEl.classList.add('hidden');
    }

    // --- Key handler (capture phase, blocks global Enter/Esc) ---

    function attachKeyHandler() {
      if (keyHandler) return;
      keyHandler = function(e) {
        // Only intercept when we have a crop rect to apply or cancel
        if (state !== 'adjusting') return;
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          applyCrop();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelCrop();
        }
      };
      document.addEventListener('keydown', keyHandler, true);
    }

    function detachKeyHandler() {
      if (keyHandler) {
        document.removeEventListener('keydown', keyHandler, true);
        keyHandler = null;
      }
    }

    // --- Crop logic ---

    function applyCrop() {
      if (!cropRect) return;

      var dims = getCssDims();

      // Save pre-crop state — filter out crop overlay objects from JSON
      var cropOverlayObjs = canvas.getObjects().filter(function(o) { return o._snipCropOverlay; });
      cropOverlayObjs.forEach(function(o) { canvas.remove(o); });
      var cleanJSON = canvas.toJSON();
      cropOverlayObjs.forEach(function(o) { canvas.add(o); });

      preCropState = {
        bgDataURL: callbacks.getBackground(),
        cssW: dims.w,
        cssH: dims.h,
        canvasJSON: cleanJSON
      };

      var cropX = Math.max(0, Math.round(cropRect.left));
      var cropY = Math.max(0, Math.round(cropRect.top));
      var cropW = Math.min(Math.round(cropRect.width * (cropRect.scaleX || 1)), dims.w - cropX);
      var cropH = Math.min(Math.round(cropRect.height * (cropRect.scaleY || 1)), dims.h - cropY);

      if (cropW < 1 || cropH < 1) {
        cancelCrop();
        return;
      }

      var bgImg = canvas._bgOriginalImg;
      if (!bgImg) {
        cancelCrop();
        return;
      }

      var scaleX = bgImg.naturalWidth / dims.w;
      var scaleY = bgImg.naturalHeight / dims.h;

      var physX = Math.round(cropX * scaleX);
      var physY = Math.round(cropY * scaleY);
      var physW = Math.round(cropW * scaleX);
      var physH = Math.round(cropH * scaleY);

      var offscreen = document.createElement('canvas');
      offscreen.width = physW;
      offscreen.height = physH;
      var ctx = offscreen.getContext('2d');
      ctx.drawImage(bgImg, physX, physY, physW, physH, 0, 0, physW, physH);
      var croppedDataURL = offscreen.toDataURL('image/png');

      removeCropUI();

      var objects = canvas.getObjects().slice();
      objects.forEach(function(obj) {
        if (obj._snipCropOverlay) return;
        var objLeft = obj.left;
        var objTop = obj.top;
        var objW = obj.width * (obj.scaleX || 1);
        var objH = obj.height * (obj.scaleY || 1);

        if (objLeft >= cropX + cropW || objLeft + objW <= cropX ||
            objTop >= cropY + cropH || objTop + objH <= cropY) {
          canvas.remove(obj);
        } else {
          obj.set({ left: obj.left - cropX, top: obj.top - cropY });
          obj.setCoords();
        }
      });

      callbacks.replaceBackgroundWithResize(croppedDataURL, cropW, cropH);
      canvas.setDimensions({ width: cropW, height: cropH });
      callbacks.scaleImageToFit(cropW, cropH);
      canvas.renderAll();

      state = 'idle';
      callbacks.onComplete();
    }

    function cancelCrop() {
      removeCropUI();
      state = 'idle';
      canvas.selection = true;
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = 'move';
      canvas.renderAll();
    }

    function removeCropUI() {
      if (cropRect) {
        canvas.remove(cropRect);
        cropRect = null;
      }
      removeDimOverlay();
      hideActions();
      detachKeyHandler();
      canvas.off('object:moving', onCropMoving);
      canvas.off('object:scaling', onCropScaling);
    }

    // --- Constrain crop rect ---

    function onCropMoving(opt) {
      if (opt.target !== cropRect) return;
      var dims = getCssDims();
      var obj = opt.target;
      var w = obj.width * (obj.scaleX || 1);
      var h = obj.height * (obj.scaleY || 1);

      if (obj.left < 0) obj.set('left', 0);
      if (obj.top < 0) obj.set('top', 0);
      if (obj.left + w > dims.w) obj.set('left', dims.w - w);
      if (obj.top + h > dims.h) obj.set('top', dims.h - h);

      updateDimOverlay();
    }

    function onCropScaling(opt) {
      if (opt.target !== cropRect) return;
      var dims = getCssDims();
      var obj = opt.target;

      var l = obj.left;
      var t = obj.top;
      var r = l + obj.width * (obj.scaleX || 1);
      var b = t + obj.height * (obj.scaleY || 1);

      if (l < 0 || t < 0 || r > dims.w || b > dims.h) {
        obj.set({
          left: Math.max(0, l),
          top: Math.max(0, t),
          scaleX: (Math.min(dims.w, r) - Math.max(0, l)) / obj.width,
          scaleY: (Math.min(dims.h, b) - Math.max(0, t)) / obj.height
        });
      }

      if (activeRatio) {
        var curW = obj.width * (obj.scaleX || 1);
        var curH = obj.height * (obj.scaleY || 1);
        var ratioW, ratioH;
        if (curW >= curH) {
          ratioW = activeRatio.w;
          ratioH = activeRatio.h;
        } else {
          ratioW = activeRatio.h;
          ratioH = activeRatio.w;
        }
        var newH2 = curW * ratioH / ratioW;
        obj.set({ width: curW, height: newH2, scaleX: 1, scaleY: 1 });
      }

      updateDimOverlay();
    }

    // --- Mouse handlers ---

    function onMouseDown(opt) {
      if (state === 'adjusting') return;
      if (opt.target && !opt.target._snipCropOverlay) return;

      var pointer = ToolUtils.clampedScenePoint(canvas, opt.e);
      state = 'drawing';
      startX = pointer.x;
      startY = pointer.y;

      var accent = getAccent();
      cropRect = new fabric.Rect({
        left: startX,
        top: startY,
        width: 0,
        height: 0,
        fill: 'transparent',
        stroke: accent,
        strokeWidth: 2,
        strokeDashArray: [6, 3],
        strokeUniform: true,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
        excludeFromExport: true,
        _snipCropOverlay: true
      });
      canvas.add(cropRect);
    }

    function onMouseMove(opt) {
      if (state !== 'drawing' || !cropRect) return;
      var pointer = ToolUtils.clampedScenePoint(canvas, opt.e);

      var curX = pointer.x;
      var curY = pointer.y;

      if (activeRatio) {
        var constrained = constrainToRatio(startX, startY, curX, curY);
        curX = constrained.x;
        curY = constrained.y;
      }

      var left = Math.min(startX, curX);
      var top = Math.min(startY, curY);
      var width = Math.abs(curX - startX);
      var height = Math.abs(curY - startY);

      cropRect.set({ left: left, top: top, width: width, height: height });
      cropRect.setCoords();
      canvas.renderAll();
    }

    function onMouseUp() {
      if (state !== 'drawing' || !cropRect) return;

      if (cropRect.width < 10 || cropRect.height < 10) {
        canvas.remove(cropRect);
        cropRect = null;
        state = 'idle';
        canvas.renderAll();
        return;
      }

      state = 'adjusting';

      cropRect.set({
        selectable: true,
        evented: true,
        hasControls: true,
        hasBorders: true,
        lockRotation: true,
        cornerColor: 'white',
        cornerStrokeColor: getAccent(),
        cornerSize: 10,
        cornerStyle: 'circle',
        transparentCorners: false,
        borderColor: getAccent()
      });
      cropRect.setCoords();
      canvas.setActiveObject(cropRect);

      createDimOverlay();

      canvas.on('object:moving', onCropMoving);
      canvas.on('object:scaling', onCropScaling);

      // Show apply/cancel now that there's a crop to apply
      showActions();
      attachKeyHandler();

      canvas.renderAll();
    }

    function onApplyClick() { applyCrop(); }
    function onCancelClick() { cancelCrop(); }

    return {
      activate: function() {
        state = 'idle';
        canvas.selection = false;
        canvas.defaultCursor = 'crosshair';
        canvas.hoverCursor = 'crosshair';
        canvas.discardActiveObject();

        // Force crosshair on the upper-canvas element
        var upperCanvas = canvas.upperCanvasEl || canvas.wrapperEl;
        if (upperCanvas) upperCanvas.style.cursor = 'crosshair';

        canvas.renderAll();

        canvas.on('mouse:down', onMouseDown);
        canvas.on('mouse:move', onMouseMove);
        canvas.on('mouse:up', onMouseUp);

        if (applyBtn) applyBtn.addEventListener('click', onApplyClick);
        if (cancelBtn) cancelBtn.addEventListener('click', onCancelClick);
        for (var i = 0; i < ratioButtons.length; i++) {
          ratioButtons[i].addEventListener('click', onRatioClick);
        }

        // Show the action bar immediately so user can pick ratio before drawing
        showActions();
      },

      deactivate: function() {
        removeCropUI();

        canvas.off('mouse:down', onMouseDown);
        canvas.off('mouse:move', onMouseMove);
        canvas.off('mouse:up', onMouseUp);

        if (applyBtn) applyBtn.removeEventListener('click', onApplyClick);
        if (cancelBtn) cancelBtn.removeEventListener('click', onCancelClick);
        for (var i = 0; i < ratioButtons.length; i++) {
          ratioButtons[i].removeEventListener('click', onRatioClick);
        }

        activeRatio = null;
        activeRatioName = null;
        for (var j = 0; j < ratioButtons.length; j++) {
          ratioButtons[j].classList.remove('active');
        }
        if (ratioButtons.length) ratioButtons[0].classList.add('active');

        state = 'idle';
        canvas.selection = true;
        canvas.defaultCursor = 'default';
        canvas.hoverCursor = 'move';
        canvas.renderAll();
      },

      undoCrop: function() {
        if (!preCropState) return false;
        var s = preCropState;
        preCropState = null;

        // Restore background and dimensions
        callbacks.replaceBackgroundWithResize(s.bgDataURL, s.cssW, s.cssH);
        canvas.setDimensions({ width: s.cssW, height: s.cssH });

        // Clear current annotations and restore saved ones
        canvas.getObjects().slice().forEach(function(obj) { canvas.remove(obj); });

        var afterRestore = function() {
          callbacks.scaleImageToFit(s.cssW, s.cssH);
          canvas.renderAll();
        };

        if (s.canvasJSON) {
          canvas.loadFromJSON(s.canvasJSON).then(afterRestore);
        } else {
          afterRestore();
        }

        return true;
      }
    };
  }

  return { attach };
})();
