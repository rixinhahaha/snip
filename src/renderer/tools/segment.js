/* global fabric, ToolUtils */
/* exported SegmentTool */

const SegmentTool = (() => {
  function attach(canvas, callbacks) {
    var replaceBackground = callbacks.replaceBackground;
    var getBackground = callbacks.getBackground;
    var onCutoutAccepted = callbacks.onCutoutAccepted || null;

    let maskOverlay = null;
    let pendingCutoutURL = null;
    let previousBackgroundURL = null;
    let isProcessing = false;
    let accumulatedPoints = [];
    let pointMarkers = [];
    let actionBarVisible = false;
    let keyHandler = null;

    function removeMaskOverlay() {
      if (maskOverlay && canvas) {
        canvas.remove(maskOverlay);
        maskOverlay = null;
      }
    }

    function removePointMarkers() {
      pointMarkers.forEach(function(marker) {
        canvas.remove(marker);
      });
      pointMarkers = [];
    }

    function addPointMarker(x, y) {
      var accent = ToolUtils.getAccentColor();
      var circle = new fabric.Circle({
        left: x,
        top: y,
        radius: 5,
        fill: ToolUtils.hexToRgba(accent, 0.9),
        stroke: 'white',
        strokeWidth: 2,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false
      });
      canvas.add(circle);
      pointMarkers.push(circle);
      canvas.renderAll();
    }

    function showActionBar() {
      var bar = document.getElementById('segment-actions');
      if (bar) bar.classList.remove('hidden');
      actionBarVisible = true;
      attachKeyHandler();
    }

    function hideActionBar() {
      var bar = document.getElementById('segment-actions');
      if (bar) bar.classList.add('hidden');
      actionBarVisible = false;
      detachKeyHandler();
    }

    function attachKeyHandler() {
      if (keyHandler) return;
      keyHandler = function(e) {
        if (!actionBarVisible) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          acceptCutout();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          rejectCutout();
        }
      };
      // Use capture phase so it fires before editor-app's keydown handler
      document.addEventListener('keydown', keyHandler, true);
    }

    function detachKeyHandler() {
      if (keyHandler) {
        document.removeEventListener('keydown', keyHandler, true);
        keyHandler = null;
      }
    }

    function acceptCutout() {
      if (!pendingCutoutURL) return;
      hideActionBar();
      previousBackgroundURL = getBackground();
      replaceBackground(pendingCutoutURL);
      removeMaskOverlay();
      removePointMarkers();
      accumulatedPoints = [];

      // Notify animate module with cutout data before clearing
      if (onCutoutAccepted) {
        onCutoutAccepted({
          cutoutDataURL: pendingCutoutURL,
          width: canvas.width,
          height: canvas.height
        });
      }

      pendingCutoutURL = null;
      ToolUtils.showToast('Cutout applied', 'success', 2000);
    }

    function rejectCutout() {
      hideActionBar();
      removeMaskOverlay();
      removePointMarkers();
      accumulatedPoints = [];
      pendingCutoutURL = null;
      canvas.renderAll();
    }

    function showTutorialIfFirstTime() {
      var storageKey = 'snip-segment-tutorial-dismissed';
      if (localStorage.getItem(storageKey)) return;

      var backdrop = document.getElementById('segment-tutorial-backdrop');
      var dismissBtn = document.getElementById('segment-tutorial-dismiss');
      if (!backdrop || !dismissBtn) return;

      backdrop.classList.remove('hidden');

      function dismiss() {
        backdrop.classList.add('hidden');
        localStorage.setItem(storageKey, '1');
        dismissBtn.removeEventListener('click', dismiss);
      }

      dismissBtn.addEventListener('click', dismiss);
    }

    async function onMouseDown(opt) {
      if (isProcessing) return;
      if (opt.target && opt.target === maskOverlay) return;

      var pointer = ToolUtils.clampedScenePoint(canvas, opt.e);
      var isShiftClick = opt.e.shiftKey && accumulatedPoints.length > 0;

      if (!isShiftClick) {
        hideActionBar();
        removeMaskOverlay();
        removePointMarkers();
        accumulatedPoints = [];
        pendingCutoutURL = null;
      } else {
        // Shift+click: hide action bar, keep accumulated points, remove old mask
        hideActionBar();
        removeMaskOverlay();
      }

      accumulatedPoints.push({ x: pointer.x, y: pointer.y, label: 1 });
      addPointMarker(pointer.x, pointer.y);

      isProcessing = true;
      canvas.defaultCursor = 'wait';

      var pointCount = accumulatedPoints.length;
      var toastMsg = pointCount === 1
        ? 'Segmenting\u2026 (first run downloads model)'
        : 'Refining with ' + pointCount + ' points\u2026';
      ToolUtils.showToast(toastMsg, 'processing');

      try {
        var result = await window.snip.segmentAtPoint({
          points: accumulatedPoints.map(function(p) {
            return { x: p.x, y: p.y, label: p.label };
          }),
          cssWidth: canvas.width,
          cssHeight: canvas.height
        });

        if (!result || !result.maskDataURL) {
          console.warn('[Segment] No mask returned');
          ToolUtils.showToast('Segmentation returned no mask', 'error', 3000);
          return;
        }

        pendingCutoutURL = result.cutoutDataURL;

        var imgEl = new Image();

        imgEl.onload = function() {
          try {
            maskOverlay = new fabric.FabricImage(imgEl, {
              left: 0,
              top: 0,
              originX: 'left',
              originY: 'top',
              scaleX: canvas.width / imgEl.width,
              scaleY: canvas.height / imgEl.height,
              selectable: false,
              evented: false,
              opacity: 1
            });

            canvas.add(maskOverlay);
            removePointMarkers();
            canvas.renderAll();

            ToolUtils.hideToast();
            showActionBar();
          } catch (fabricErr) {
            console.error('[Segment] Failed to create fabric image:', fabricErr);
            ToolUtils.showToast('Failed to display mask: ' + fabricErr.message, 'error', 4000);
          }
        };

        imgEl.onerror = function() {
          ToolUtils.showToast('Failed to load mask image', 'error', 4000);
        };

        imgEl.src = result.maskDataURL;

      } catch (err) {
        console.error('[Segment] Error:', err.message || err);
        ToolUtils.showToast('Segmentation failed: ' + (err.message || 'Unknown error'), 'error', 4000);
      } finally {
        isProcessing = false;
        canvas.defaultCursor = 'crosshair';
      }
    }

    // Wire up accept/reject button clicks
    var acceptBtn = document.getElementById('segment-accept');
    var rejectBtn = document.getElementById('segment-reject');
    if (acceptBtn) acceptBtn.addEventListener('click', acceptCutout);
    if (rejectBtn) rejectBtn.addEventListener('click', rejectCutout);

    return {
      activate() {
        canvas.on('mouse:down', onMouseDown);
        canvas.selection = false;
        canvas.defaultCursor = 'crosshair';
        canvas.discardActiveObject();
        canvas.renderAll();
        showTutorialIfFirstTime();
      },
      deactivate() {
        canvas.off('mouse:down', onMouseDown);
        hideActionBar();
        removeMaskOverlay();
        removePointMarkers();
        accumulatedPoints = [];
        pendingCutoutURL = null;
        ToolUtils.hideToast();
        canvas.selection = true;
        canvas.defaultCursor = 'default';
        canvas.renderAll();
      },
      undoCutout() {
        if (previousBackgroundURL) {
          replaceBackground(previousBackgroundURL);
          previousBackgroundURL = null;
          return true;
        }
        return false;
      }
    };
  }

  return { attach };
})();
