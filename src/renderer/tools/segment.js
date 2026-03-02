/* global fabric, ToolUtils */
/* exported SegmentTool */

const SegmentTool = (() => {
  // Tag constants (match TagTool values)
  var TAG_TIP_RADIUS = 4;
  var TAG_BUBBLE_RX = 6;
  var TAG_BUBBLE_PADDING = 8;
  var TAG_BUBBLE_MIN_WIDTH = 100;
  var TAG_LINE_WIDTH = 2;

  function attach(canvas, callbacks) {
    var replaceBackground = callbacks.replaceBackground;
    var getBackground = callbacks.getBackground;
    var onCutoutAccepted = callbacks.onCutoutAccepted || null;
    var onComplete = callbacks.onComplete || null;
    var getTagColor = callbacks.getTagColor || function() { return '#64748B'; };
    var getFont = callbacks.getFont || function() { return 'Plus Jakarta Sans'; };
    var getFontSize = callbacks.getFontSize || function() { return 16; };
    var getOutlineWidth = callbacks.getOutlineWidth || function() { return 8; };

    let maskOverlay = null;
    let pendingCutoutURL = null;
    let pendingMaskURL = null;
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
        } else if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          e.stopPropagation();
          var mode = e.shiftKey ? 'outline' : 'highlight';
          tagSegment(mode);
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
      pendingMaskURL = null;
      ToolUtils.showToast('Cutout applied', 'success', 2000);

      // Switch to select mode
      if (onComplete) onComplete();
    }

    function rejectCutout() {
      hideActionBar();
      removeMaskOverlay();
      removePointMarkers();
      accumulatedPoints = [];
      pendingCutoutURL = null;
      pendingMaskURL = null;
      canvas.renderAll();
    }

    /**
     * Tag the segmented area with a colored overlay/outline and a label bubble.
     * @param {'highlight'|'outline'} mode
     */
    function tagSegment(mode) {
      if (!pendingMaskURL) return;
      hideActionBar();

      var tagColor = getTagColor();
      var font = getFont();
      var fontSize = getFontSize();
      var outlineWidth = getOutlineWidth();
      var savedMaskURL = pendingMaskURL; // capture before async clears it

      // Both utilities now return { dataURL, x, y, w, h } cropped to bounding box
      var processFn = mode === 'outline'
        ? function(cb) { ToolUtils.maskToOutline(savedMaskURL, tagColor, outlineWidth, cb); }
        : function(cb) { ToolUtils.recolorMaskToHighlight(savedMaskURL, tagColor, cb); };

      processFn(function(result) {
        if (!result.dataURL) {
          ToolUtils.showToast('No mask area found', 'error', 3000);
          return;
        }

        var overlayImg = new Image();
        overlayImg.onload = function() {
          // Remove the preview mask overlay
          removeMaskOverlay();
          removePointMarkers();

          // Scale mask pixel coords to canvas coords
          // pendingMaskURL image dimensions may differ from canvas dimensions
          var maskImg = new Image();
          maskImg.onload = function() {
            var imgToCanvasX = canvas.width / maskImg.width;
            var imgToCanvasY = canvas.height / maskImg.height;

            // Cropped overlay positioned at its bounding box location in canvas coords
            var overlayLeft = result.x * imgToCanvasX;
            var overlayTop = result.y * imgToCanvasY;
            var overlayW = result.w * imgToCanvasX;
            var overlayH = result.h * imgToCanvasY;

            var highlightOpacity = mode === 'outline' ? 1.0 : 0.55;
            var fabricOverlay = new fabric.FabricImage(overlayImg, {
              left: overlayLeft,
              top: overlayTop,
              originX: 'left',
              originY: 'top',
              scaleX: overlayW / overlayImg.width,
              scaleY: overlayH / overlayImg.height,
              selectable: false,
              evented: false,
              opacity: highlightOpacity
            });

            // Tag placement: center-top of the overlay area
            var centerX = overlayLeft + overlayW / 2;
            var tagTipY = overlayTop;

            // Position tag bubble above the mask center-top
            var bubbleX = centerX;
            var bubbleY = Math.max(30, tagTipY - 40);
            var bubbleHeight = fontSize + TAG_BUBBLE_PADDING * 2;

            // Create tag parts (matching TagTool pattern)
            var tip = new fabric.Circle({
              left: centerX,
              top: tagTipY,
              radius: TAG_TIP_RADIUS,
              fill: tagColor,
              stroke: tagColor,
              strokeWidth: 1,
              originX: 'center',
              originY: 'center',
              selectable: false,
              evented: false
            });

            var line = new fabric.Line([centerX, tagTipY, bubbleX, bubbleY], {
              stroke: tagColor,
              strokeWidth: TAG_LINE_WIDTH,
              selectable: false,
              evented: false
            });

            var bubble = new fabric.Rect({
              left: bubbleX,
              top: bubbleY - bubbleHeight / 2,
              width: TAG_BUBBLE_MIN_WIDTH,
              height: bubbleHeight,
              rx: TAG_BUBBLE_RX,
              ry: TAG_BUBBLE_RX,
              fill: tagColor,
              stroke: tagColor,
              strokeWidth: 1,
              originX: 'left',
              originY: 'top',
              selectable: false,
              evented: false
            });

            var textbox = new fabric.Textbox('Label', {
              left: bubbleX + TAG_BUBBLE_PADDING,
              top: bubbleY - fontSize / 2,
              width: TAG_BUBBLE_MIN_WIDTH - TAG_BUBBLE_PADDING * 2,
              fontSize: fontSize,
              fontFamily: font,
              fill: '#FFFFFF',
              editable: true,
              cursorColor: '#FFFFFF',
              padding: 2,
              originX: 'left',
              originY: 'top',
              selectable: false,
              evented: false
            });

            // Add all parts to canvas for initial editing
            var allItems = [fabricOverlay, tip, line, bubble, textbox];
            for (var i = 0; i < allItems.length; i++) {
              canvas.add(allItems[i]);
            }

            // Live-resize bubble as user types
            var onChanged = function() {
              var minTextWidth = TAG_BUBBLE_MIN_WIDTH - TAG_BUBBLE_PADDING * 2;
              var measured = ToolUtils.measureTextWidth(textbox.text, textbox.fontSize, textbox.fontFamily);
              var newTextWidth = Math.max(minTextWidth, measured + 4);
              if (Math.abs(newTextWidth - textbox.width) > 2) {
                textbox.set('width', newTextWidth);
              }
              var bw = Math.max(TAG_BUBBLE_MIN_WIDTH, textbox.width + TAG_BUBBLE_PADDING * 2);
              var bh = textbox.height + TAG_BUBBLE_PADDING * 2;
              bubble.set({
                width: bw,
                height: bh,
                left: textbox.left - TAG_BUBBLE_PADDING,
                top: textbox.top - TAG_BUBBLE_PADDING
              });
              line.set({
                x2: bubble.left,
                y2: bubble.top + bubble.height / 2
              });
              canvas.renderAll();
            };
            textbox.on('changed', onChanged);

            // Enter editing
            textbox.set({ selectable: true, evented: true, editable: true });
            canvas.setActiveObject(textbox);
            textbox.enterEditing();
            textbox.selectAll();
            canvas.renderAll();

            // On editing exit, create linked objects
            var onExitEditing = function() {
              textbox.off('editing:exited', onExitEditing);
              textbox.off('changed', onChanged);

              // Final auto-size
              onChanged();

              // Remove all from canvas
              for (var j = 0; j < allItems.length; j++) {
                canvas.remove(allItems[j]);
              }

              // Generate unique tag ID for linkage
              var tagId = ToolUtils.nextTagId();

              // Create label group (bubble + textbox only) — movable
              var labelGroup = new fabric.Group([bubble, textbox], {
                selectable: true,
                evented: true,
                subTargetCheck: true,
                lockRotation: true,
                hasControls: false
              });
              labelGroup._snipTagType = true;
              labelGroup._snipSegmentTag = true;
              labelGroup._snipTagColor = tagColor;
              labelGroup._snipTagId = tagId;
              labelGroup._snipMaskURL = savedMaskURL;
              labelGroup._snipTagMode = mode;
              labelGroup._snipOutlineWidth = outlineWidth;

              // Mark linked parts
              fabricOverlay._snipTagId = tagId;
              fabricOverlay._snipTagRole = 'overlay';
              tip._snipTagId = tagId;
              tip._snipTagRole = 'tip';
              line._snipTagId = tagId;
              line._snipTagRole = 'line';

              // Add in z-order: overlay (bottom), tip, line, label group (top)
              canvas.add(fabricOverlay);
              canvas.add(tip);
              canvas.add(line);
              canvas.add(labelGroup);

              // Update line endpoint to connect to label group edge
              var bounds = labelGroup.getBoundingRect();
              var endpoint = ToolUtils.lineEndpointForTag(tip.left, tip.top, bounds);
              line.set({ x2: endpoint.x, y2: endpoint.y });
              line.setCoords();

              canvas.setActiveObject(labelGroup);
              canvas.renderAll();

              ToolUtils.showToast('Segment tagged', 'success', 2000);

              // Switch to select mode
              if (onComplete) onComplete();
            };

            textbox.on('editing:exited', onExitEditing);

            // Clear segment state
            accumulatedPoints = [];
            pendingCutoutURL = null;
            pendingMaskURL = null;
          };
          maskImg.src = savedMaskURL;
        };
        overlayImg.src = result.dataURL;
      });
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
        pendingMaskURL = result.maskDataURL;

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

    // Wire up accept/reject/tag button clicks
    var acceptBtn = document.getElementById('segment-accept');
    var rejectBtn = document.getElementById('segment-reject');
    var tagBtn = document.getElementById('segment-tag');
    if (acceptBtn) acceptBtn.addEventListener('click', acceptCutout);
    if (rejectBtn) rejectBtn.addEventListener('click', rejectCutout);
    if (tagBtn) tagBtn.addEventListener('click', function() { tagSegment('highlight'); });

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
        pendingMaskURL = null;
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
