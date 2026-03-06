/* global EditorCanvasManager, Toolbar, RectangleTool, TextTool, ArrowTool, TagTool, BlurBrushTool, SegmentTool, AnimateTool, TranscribeTool, ToolUtils */

(function() {
  'use strict';

  let canvas = null;
  let tools = {};
  let currentToolHandler = null;
  const TOOLS = Toolbar.TOOLS;

  // Apply theme
  (async function() {
    var theme = await window.snip.getTheme();
    document.documentElement.dataset.theme = theme;
  })();
  window.snip.onThemeChanged(function(theme) {
    document.documentElement.dataset.theme = theme;
  });

  let _editorReady = false; // DOM + tools initialized
  let _editorInitialized = false; // image data loaded

  // Initialize editor with image data (called from push or pull path)
  async function initEditorWithData(imageData) {
    if (_editorInitialized) return; // prevent double init
    _editorInitialized = true;

    const { croppedDataURL, cssWidth, cssHeight } = imageData;

    // Use actual image dimensions so canvas matches the image exactly
    // (window may be larger due to min-size constraints, toolbar, and padding)
    var canvasW = cssWidth;
    var canvasH = cssHeight;

    // Initialize Fabric canvas to fill the image area
    canvas = EditorCanvasManager.initCanvas(canvasW, canvasH);

    // Set background image on <img> element
    EditorCanvasManager.setBackgroundImage(croppedDataURL, canvasW, canvasH);

    // Scale image area to fit viewport if image is larger than available space
    scaleImageToFit(canvasW, canvasH);

    // Setup annotation tools (only once)
    if (!_editorReady) {
      // Load fonts
      const fonts = await window.snip.getSystemFonts();
      var fontSelect = document.getElementById('font-select');
      fontSelect.innerHTML = '';
      fonts.forEach(function(font) {
        var opt = document.createElement('option');
        opt.value = font;
        opt.textContent = font;
        opt.style.fontFamily = font;
        if (font === 'Plus Jakarta Sans') opt.selected = true;
        fontSelect.appendChild(opt);
      });

      setupTools();
      await checkSegmentSupport();
      _editorReady = true;
    }

    // Setup upscale button
    setupUpscale(canvasW, canvasH);

    // Setup canvas zoom (pinch, scroll, keyboard)
    setupZoom();

    // Ensure window is wide enough for full toolbar
    await ensureToolbarFits();
  }

  // Listen for pushed image data (pre-warmed window path — fast)
  window.snip.onEditorImageData(function(imageData) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => initEditorWithData(imageData));
    } else {
      initEditorWithData(imageData);
    }
  });

  // Fallback: pull image data on DOMContentLoaded (fresh window path)
  document.addEventListener('DOMContentLoaded', async () => {
    if (_editorInitialized) return;
    const imageData = await window.snip.getEditorImage();
    if (!imageData) return;
    initEditorWithData(imageData);
  });

  async function checkSegmentSupport() {
    try {
      if (window.snip.checkSegmentSupport) {
        var result = await window.snip.checkSegmentSupport();
        if (result && result.supported) {
          Toolbar.enableSegmentTool();
        }
      }
    } catch (err) {
      console.warn('[Snip] Failed to check segment support:', err.message);
    }
  }

  let upscaleCleanup = null;
  var _preUpscaleState = null; // saved state for undo

  function undoUpscale() {
    if (!_preUpscaleState) return false;
    var state = _preUpscaleState;
    _preUpscaleState = null;

    console.log('[Upscale] Undoing: restoring %dx%d (annotations: %s)',
      state.cssW, state.cssH, state.canvasJSON ? 'yes' : 'no');

    // Restore background
    EditorCanvasManager.setBackgroundImage(state.bgDataURL, state.cssW, state.cssH);

    // Resize canvas
    if (canvas) {
      canvas.setDimensions({ width: state.cssW, height: state.cssH });
      canvas.setZoom(1);
    }

    // Restore image area
    var imageArea = document.getElementById('image-area');
    imageArea.style.width = state.cssW + 'px';
    imageArea.style.height = state.cssH + 'px';

    // Restore annotations
    EditorCanvasManager.clearAnnotations();
    if (state.canvasJSON) {
      canvas.loadFromJSON(state.canvasJSON).then(function() {
        canvas.renderAll();
      });
    }

    // Re-fit (this updates _zoomState.imgW/imgH so re-upscale size check works)
    scaleImageToFit(state.cssW, state.cssH);

    // Re-enable upscale button
    var upscaleBtn = document.getElementById('btn-upscale');
    if (upscaleBtn) {
      upscaleBtn.classList.remove('disabled');
      upscaleBtn.setAttribute('data-tooltip', 'Upscale (U)');
    }

    console.log('[Upscale] Undo complete, zoom state imgW/H: %d x %d',
      _zoomState.imgW, _zoomState.imgH);
    window.snip.showNotification('Upscale undone');
    return true;
  }

  function setupUpscale(canvasW, canvasH) {
    var upscaleBtn = document.getElementById('btn-upscale');
    var progressEl = document.getElementById('upscale-progress');
    var progressText = document.getElementById('upscale-progress-text');
    var progressFill = document.getElementById('upscale-progress-fill');

    if (!upscaleBtn) return;

    // Click directly triggers 2x upscale
    upscaleBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (upscaleBtn.classList.contains('disabled')) return;
      performUpscale();
    });

    // Listen for progress events
    if (window.snip.onUpscaleProgress) {
      upscaleCleanup = window.snip.onUpscaleProgress(function(progress) {
        var pct = Math.round(progress.percent || 0);
        if (progress.stage === 'loading') {
          progressText.textContent = 'Loading model... ' + pct + '%';
          progressFill.classList.remove('inferencing');
          progressFill.style.width = pct + '%';
        } else if (progress.stage === 'inferencing') {
          progressText.textContent = 'Upscaling (2x)... ' + pct + '%';
          // Smooth fill: slowly crawl toward 75% over ~60s
          progressFill.classList.add('inferencing');
          progressFill.style.width = '75%';
        } else if (progress.stage === 'encoding') {
          progressText.textContent = 'Encoding result... ' + pct + '%';
          progressFill.classList.remove('inferencing');
          progressFill.style.width = pct + '%';
        } else if (progress.stage === 'done') {
          progressText.textContent = 'Done! 100%';
          progressFill.classList.remove('inferencing');
          progressFill.style.width = '100%';
        }
      });
    }

    function showUpscaleError(currentDims, targetDims) {
      var dialog = document.getElementById('upscale-error');
      document.getElementById('upscale-error-current').textContent = currentDims;
      document.getElementById('upscale-error-target').textContent = targetDims;
      dialog.classList.remove('hidden');

      var dismissBtn = document.getElementById('upscale-error-dismiss');
      function onDismiss() {
        dialog.classList.add('hidden');
        dismissBtn.removeEventListener('click', onDismiss);
      }
      dismissBtn.addEventListener('click', onDismiss);
    }

    function showUpscaleConfirm() {
      return new Promise(function(resolve) {
        var dialog = document.getElementById('upscale-confirm');
        var okBtn = document.getElementById('upscale-confirm-ok');
        var cancelBtn = document.getElementById('upscale-confirm-cancel');
        dialog.classList.remove('hidden');

        function cleanup(result) {
          dialog.classList.add('hidden');
          okBtn.removeEventListener('click', onOk);
          cancelBtn.removeEventListener('click', onCancel);
          resolve(result);
        }
        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
      });
    }

    async function performUpscale() {
      // Use current image dimensions from zoom state (stays in sync after undo)
      var currentW = _zoomState.imgW;
      var currentH = _zoomState.imgH;
      var dpr = window.devicePixelRatio || 1;
      var physW = Math.round(currentW * dpr);
      var physH = Math.round(currentH * dpr);
      var outW = physW * 2;
      var outH = physH * 2;

      // Cap output at the user's screen resolution
      var maxW = window.screen.width * dpr;
      var maxH = window.screen.height * dpr;

      console.log('[Upscale] Current CSS dims:', currentW, 'x', currentH,
        '| Physical:', physW, 'x', physH,
        '| Target 2x:', outW, 'x', outH,
        '| Screen limit:', maxW, 'x', maxH);

      if (outW > maxW || outH > maxH) {
        console.log('[Upscale] Blocked: %dx%d exceeds screen %dx%d', outW, outH, maxW, maxH);
        showUpscaleError(physW + '×' + physH, outW + '×' + outH);
        return;
      }

      // Warn if there are annotations — upscale only affects the background image
      var hasAnnotations = canvas && canvas.getObjects().length > 0;
      if (hasAnnotations) {
        console.log('[Upscale] Annotations present (%d objects), showing confirmation', canvas.getObjects().length);
        var confirmed = await showUpscaleConfirm();
        if (!confirmed) {
          console.log('[Upscale] User cancelled');
          return;
        }
      }

      // Save pre-upscale state for undo
      _preUpscaleState = {
        bgDataURL: EditorCanvasManager.getBackgroundDataURL(),
        cssW: currentW,
        cssH: currentH,
        canvasJSON: hasAnnotations && canvas ? canvas.toJSON() : null
      };
      console.log('[Upscale] Saved pre-upscale state (%dx%d, annotations: %s)',
        currentW, currentH, hasAnnotations ? 'yes' : 'no');

      // Show progress overlay
      progressFill.classList.remove('inferencing');
      progressFill.style.width = '0%';
      progressText.textContent = 'Loading model...';
      progressEl.classList.remove('hidden');

      try {
        // Upscale the background image only (not annotations)
        var dataURL = EditorCanvasManager.getBackgroundDataURL();
        console.log('[Upscale] Sending background image to worker (dataURL length: %d)', dataURL.length);

        var result = await window.snip.upscaleImage({ imageBase64: dataURL });

        progressEl.classList.add('hidden');

        console.log('[Upscale] Result received: %dx%d (dataURL length: %d)',
          result.width, result.height, result.dataURL.length);

        // Apply result directly
        var newCssW = result.width / dpr;
        var newCssH = result.height / dpr;

        EditorCanvasManager.clearAnnotations();
        EditorCanvasManager.setBackgroundImage(result.dataURL, newCssW, newCssH);

        if (canvas) {
          canvas.setDimensions({ width: newCssW, height: newCssH });
          canvas.setZoom(1);
        }

        var imageArea = document.getElementById('image-area');
        imageArea.style.width = newCssW + 'px';
        imageArea.style.height = newCssH + 'px';

        canvasW = newCssW;
        canvasH = newCssH;
        scaleImageToFit(newCssW, newCssH);

        upscaleBtn.classList.add('disabled');
        upscaleBtn.setAttribute('data-tooltip', 'Already upscaled');

        console.log('[Upscale] Applied: %dx%d CSS, fitted to viewport', newCssW, newCssH);
        window.snip.showNotification('Upscaled to ' + result.width + 'x' + result.height);
      } catch (err) {
        console.error('[Upscale] Failed:', err);
        progressEl.classList.add('hidden');

        _preUpscaleState = null;
        window.snip.showNotification('Upscale failed: ' + err.message);
      }
    }
  }

  // --- Zoom state ---
  var _zoomState = {
    baseScale: 1,    // initial fit-to-viewport scale
    viewZoom: 1,     // user-controlled zoom multiplier (1 = fit, >1 = zoomed in)
    imgW: 0,
    imgH: 0,
    panX: 0,
    panY: 0,
    isPanning: false,
    lastPanX: 0,
    lastPanY: 0
  };

  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 8;

  function scaleImageToFit(imgW, imgH) {
    var container = document.getElementById('editor-container');
    var availW = container.clientWidth - 48;
    var availH = container.clientHeight - 48;

    var fitScale = Math.min(1, Math.min(availW / imgW, availH / imgH));

    _zoomState.baseScale = fitScale;
    _zoomState.viewZoom = 1;
    _zoomState.imgW = imgW;
    _zoomState.imgH = imgH;
    _zoomState.panX = 0;
    _zoomState.panY = 0;

    applyZoom();
  }

  function applyZoom() {
    var imageArea = document.getElementById('image-area');
    var bgImg = document.getElementById('background-image');
    var effectiveScale = _zoomState.baseScale * _zoomState.viewZoom;

    var scaledW = Math.round(_zoomState.imgW * effectiveScale);
    var scaledH = Math.round(_zoomState.imgH * effectiveScale);

    imageArea.style.width = scaledW + 'px';
    imageArea.style.height = scaledH + 'px';
    bgImg.style.width = scaledW + 'px';
    bgImg.style.height = scaledH + 'px';

    // Apply pan offset via transform
    imageArea.style.transform = 'translate(' + _zoomState.panX + 'px, ' + _zoomState.panY + 'px)';

    // Fabric zoom keeps pointer mapping correct
    if (canvas) {
      canvas.setDimensions({ width: scaledW, height: scaledH });
      canvas.setZoom(effectiveScale);
    }

    updateZoomIndicator();
    updateDimsLabel();
  }

  function updateDimsLabel() {
    var el = document.getElementById('image-dims');
    if (!el) return;
    var dpr = window.devicePixelRatio || 1;
    var physW = Math.round(_zoomState.imgW * dpr);
    var physH = Math.round(_zoomState.imgH * dpr);
    el.textContent = physW + ' × ' + physH;
  }

  function updateZoomIndicator() {
    var el = document.getElementById('zoom-indicator');
    if (!el) return;
    var pct = Math.round(_zoomState.viewZoom * _zoomState.baseScale * 100);
    el.textContent = pct + '%';
    // Show indicator when not at default fit
    if (Math.abs(_zoomState.viewZoom - 1) < 0.01 && _zoomState.panX === 0 && _zoomState.panY === 0) {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  }

  function setupCanvasGuide() {
    var btn = document.getElementById('canvas-help-btn');
    var backdrop = document.getElementById('canvas-guide-backdrop');
    var dismiss = document.getElementById('canvas-guide-dismiss');
    if (!btn || !backdrop) return;

    btn.addEventListener('click', function() {
      backdrop.classList.remove('hidden');
    });
    dismiss.addEventListener('click', function() {
      backdrop.classList.add('hidden');
    });
    backdrop.addEventListener('click', function(e) {
      if (e.target === backdrop) backdrop.classList.add('hidden');
    });
  }

  function setupZoom() {
    var container = document.getElementById('editor-container');

    // Canvas navigation guide
    setupCanvasGuide();

    // Wheel zoom (pinch-to-zoom on trackpad sends wheel events with ctrlKey)
    container.addEventListener('wheel', function(e) {
      // Pinch-to-zoom on trackpad: ctrlKey is set, deltaY is the zoom delta
      // Cmd+scroll: metaKey is set
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        var zoomFactor = e.ctrlKey ? 0.01 : 0.002; // trackpad pinch is more sensitive
        var delta = -e.deltaY * zoomFactor;
        var newZoom = _zoomState.viewZoom * (1 + delta);
        var effectiveZoom = _zoomState.baseScale * newZoom;

        if (effectiveZoom < MIN_ZOOM) newZoom = MIN_ZOOM / _zoomState.baseScale;
        if (effectiveZoom > MAX_ZOOM) newZoom = MAX_ZOOM / _zoomState.baseScale;

        // Zoom toward cursor position
        var rect = container.getBoundingClientRect();
        var cursorX = e.clientX - rect.left;
        var cursorY = e.clientY - rect.top - 48; // subtract toolbar height

        var containerCenterX = (rect.width) / 2;
        var containerCenterY = (rect.height - 48) / 2;

        // Point relative to image center (accounting for current pan)
        var imgCenterX = containerCenterX + _zoomState.panX;
        var imgCenterY = containerCenterY + _zoomState.panY;
        var relX = cursorX - imgCenterX;
        var relY = cursorY - imgCenterY;

        var scaleChange = newZoom / _zoomState.viewZoom;
        _zoomState.panX -= relX * (scaleChange - 1);
        _zoomState.panY -= relY * (scaleChange - 1);

        _zoomState.viewZoom = newZoom;
        applyZoom();
      } else {
        // Regular scroll → pan
        e.preventDefault();
        _zoomState.panX -= e.deltaX;
        _zoomState.panY -= e.deltaY;
        applyZoom();
      }
    }, { passive: false });

    // Middle-click drag to pan
    container.addEventListener('mousedown', function(e) {
      if (e.button === 1) { // middle mouse
        e.preventDefault();
        _zoomState.isPanning = true;
        _zoomState.lastPanX = e.clientX;
        _zoomState.lastPanY = e.clientY;
        container.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', function(e) {
      if (!_zoomState.isPanning) return;
      _zoomState.panX += e.clientX - _zoomState.lastPanX;
      _zoomState.panY += e.clientY - _zoomState.lastPanY;
      _zoomState.lastPanX = e.clientX;
      _zoomState.lastPanY = e.clientY;
      applyZoom();
    });

    // Space+drag to pan
    var spaceDown = false;
    document.addEventListener('keydown', function(e) {
      if (e.key === ' ' && !e.repeat && !e.target.closest('input, textarea, select')) {
        // Don't activate space-pan if a textbox is being edited on canvas
        if (canvas) {
          var active = canvas.getActiveObject();
          if (active && active.type === 'textbox' && active.isEditing) return;
        }
        spaceDown = true;
        container.style.cursor = 'grab';
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', function(e) {
      if (e.key === ' ' && !e.target.closest('input, textarea, select')) {
        spaceDown = false;
        if (!_zoomState.isPanning) container.style.cursor = '';
        // Prevent space keyup from clicking the focused toolbar button
        e.preventDefault();
      }
    });

    container.addEventListener('mousedown', function(e) {
      if (spaceDown && e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        _zoomState.isPanning = true;
        _zoomState.lastPanX = e.clientX;
        _zoomState.lastPanY = e.clientY;
        container.style.cursor = 'grabbing';
      }
    }, true);

    window.addEventListener('mouseup', function(e) {
      if (_zoomState.isPanning && (e.button === 0 || e.button === 1)) {
        _zoomState.isPanning = false;
        container.style.cursor = spaceDown ? 'grab' : '';
      }
    });

    // Keyboard shortcuts: Cmd+0 = reset zoom, Cmd+= zoom in, Cmd+- zoom out
    document.addEventListener('keydown', function(e) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '0') {
        e.preventDefault();
        _zoomState.viewZoom = 1;
        _zoomState.panX = 0;
        _zoomState.panY = 0;
        applyZoom();
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        var newZoom = _zoomState.viewZoom * 1.25;
        if (_zoomState.baseScale * newZoom <= MAX_ZOOM) {
          _zoomState.viewZoom = newZoom;
          applyZoom();
        }
      } else if (e.key === '-') {
        e.preventDefault();
        var newZoom = _zoomState.viewZoom / 1.25;
        if (_zoomState.baseScale * newZoom >= MIN_ZOOM) {
          _zoomState.viewZoom = newZoom;
          applyZoom();
        }
      }
    });
  }

  async function ensureToolbarFits() {
    var toolbar = document.getElementById('toolbar');
    toolbar.style.right = 'auto';
    toolbar.style.width = 'max-content';
    var neededWidth = toolbar.offsetWidth;
    toolbar.style.right = '';
    toolbar.style.width = '';
    if (neededWidth > document.documentElement.clientWidth) {
      await window.snip.resizeEditor(neededWidth);
    }
  }

  /**
   * Re-render the highlight overlay for a segment tag when color changes.
   * Uses recolorMaskWithOutline to produce a translucent fill + outline ring.
   */
  function _reprocessOverlay(tagId, maskURL, color) {
    if (!tagId || !maskURL) return;

    ToolUtils.recolorMaskWithOutline(maskURL, color, ToolUtils.SEGMENT_OUTLINE_WIDTH, function(result) {
      if (!result.dataURL) return;

      var overlayImg = new Image();
      overlayImg.onload = function() {
        var maskImg = new Image();
        maskImg.onload = function() {
          var recolorZoom = canvas.getZoom() || 1;
          var imgToCanvasX = (canvas.width / recolorZoom) / maskImg.width;
          var imgToCanvasY = (canvas.height / recolorZoom) / maskImg.height;

          var overlayLeft = result.x * imgToCanvasX;
          var overlayTop = result.y * imgToCanvasY;
          var overlayW = result.w * imgToCanvasX;
          var overlayH = result.h * imgToCanvasY;

          // Remove old overlay first
          canvas.getObjects().slice().forEach(function(obj) {
            if (obj._snipTagId === tagId && obj._snipTagRole === 'overlay') {
              canvas.remove(obj);
            }
          });

          var newOverlay = new fabric.FabricImage(overlayImg, {
            left: overlayLeft,
            top: overlayTop,
            originX: 'left',
            originY: 'top',
            scaleX: overlayW / overlayImg.width,
            scaleY: overlayH / overlayImg.height,
            selectable: false,
            evented: false,
            opacity: ToolUtils.SEGMENT_OVERLAY_OPACITY
          });
          newOverlay._snipTagId = tagId;
          newOverlay._snipTagRole = 'overlay';

          // Add new overlay and send to back of z-stack
          canvas.add(newOverlay);
          canvas.sendObjectToBack(newOverlay);
          canvas.renderAll();
        };
        maskImg.src = maskURL;
      };
      overlayImg.src = result.dataURL;
    });
  }

  function reprocessSegmentOverlay(labelGroup) {
    _reprocessOverlay(labelGroup._snipTagId, labelGroup._snipMaskURL, labelGroup._snipTagColor);
  }

  /**
   * Apply a color change to a tag's linked parts (bubble, textbox, tip, line, overlay).
   * Shared by both onTagColorChange and onSegmentColorChange callbacks.
   */
  function _applyTagColor(active, color) {
    if (!active) return;

    if (active._snipTagType) {
      // Label group is selected — update bubble + textbox sub-objects
      active.getObjects().forEach(function(obj) {
        if (obj.type === 'textbox') obj.set({ fill: '#FFFFFF', cursorColor: '#FFFFFF' });
        else if (obj.type === 'rect') obj.set({ stroke: color, fill: color });
      });
      active._snipTagColor = color;
      // Update linked parts (tip, line) on canvas
      if (active._snipTagId) {
        canvas.getObjects().forEach(function(obj) {
          if (obj._snipTagId === active._snipTagId && obj !== active) {
            if (obj._snipTagRole === 'tip') obj.set({ fill: color, stroke: color, borderColor: color });
            else if (obj._snipTagRole === 'line') obj.set({ stroke: color });
          }
        });
      }
      // Re-render highlight overlay for segment tags
      if (active._snipSegmentTag && active._snipMaskURL) {
        reprocessSegmentOverlay(active);
      }
      canvas.renderAll();
    } else if (active.type === 'textbox' && active._snipEditingTagId) {
      // Textbox being edited inside a tag
      var editTagId = active._snipEditingTagId;
      active._snipEditingTagColor = color;
      canvas.getObjects().forEach(function(obj) {
        if (obj._snipEditingTagId === editTagId && obj.type === 'rect') {
          obj.set({ stroke: color, fill: color });
        }
        if (obj._snipTagId === editTagId) {
          if (obj._snipTagRole === 'tip') obj.set({ fill: color, stroke: color, borderColor: color });
          else if (obj._snipTagRole === 'line') obj.set({ stroke: color });
        }
      });
      // Re-render overlay for segment tags during editing
      if (active._snipEditingSegmentTag && active._snipEditingMaskURL) {
        _reprocessOverlay(editTagId, active._snipEditingMaskURL, color);
      }
      canvas.renderAll();
    }
  }

  function setupTools() {
    tools[TOOLS.RECT] = RectangleTool.attach(canvas, Toolbar.getActiveColor, Toolbar.getActiveStrokeWidth, Toolbar.getRectMode);
    tools[TOOLS.TEXT] = TextTool.attach(canvas, Toolbar.getActiveColor, Toolbar.getActiveFont, Toolbar.getActiveFontSize);
    tools[TOOLS.ARROW] = ArrowTool.attach(canvas, Toolbar.getActiveColor, Toolbar.getActiveStrokeWidth);
    tools[TOOLS.TAG] = TagTool.attach(canvas, Toolbar.getActiveTagColor, Toolbar.getActiveFont, Toolbar.getActiveFontSize);
    tools[TOOLS.BLUR_BRUSH] = BlurBrushTool.attach(canvas, Toolbar.getActiveBrushSize);
    tools[TOOLS.SEGMENT] = SegmentTool.attach(canvas, {
      replaceBackground: EditorCanvasManager.replaceBackground,
      getBackground: EditorCanvasManager.getBackgroundDataURL,
      onCutoutAccepted: function(data) {
        AnimateTool.setCutoutData(data);
      },
      onComplete: function() {
        Toolbar.setTool(TOOLS.SELECT);
      },
      getTagColor: Toolbar.getActiveSegmentColor,
      getFont: Toolbar.getActiveFont,
      getFontSize: Toolbar.getActiveFontSize
    });

    // Initialize animate tool (2GIF)
    AnimateTool.init();

    // Initialize transcribe tool
    TranscribeTool.init();

    Toolbar.initToolbar({
      getCanvas: function() { return canvas; },
      onToolChange: function(tool) { switchTool(tool); ensureToolbarFits(); },
      onColorChange: function(color) {
        var active = canvas.getActiveObject();
        if (active) {
          if (active._snipTagType) return; // tags use their own color swatches
          if (active.type === 'textbox') active.set('fill', color);
          else active.set('stroke', color);
          canvas.renderAll();
        }
      },
      onTagColorChange: function(color) { _applyTagColor(canvas.getActiveObject(), color); },
      onSegmentColorChange: function(color) { _applyTagColor(canvas.getActiveObject(), color); },
      onStrokeWidthChange: function(width) {
        var active = canvas.getActiveObject();
        if (active && active.type !== 'textbox') {
          active.set('strokeWidth', width);
          canvas.renderAll();
        }
      },
      onFontChange: function(font) {
        var active = canvas.getActiveObject();
        if (active && active._snipTagType) {
          active.getObjects().forEach(function(obj) {
            if (obj.type === 'textbox') obj.set('fontFamily', font);
          });
          // Refresh group to resize bubble for new font
          TagTool.refreshTagGroup(canvas, active);
        } else if (active && active.type === 'textbox') {
          active.set('fontFamily', font);
          canvas.renderAll();
        }
      },
      onFontSizeChange: function(size) {
        var active = canvas.getActiveObject();
        if (active && active._snipTagType) {
          active.getObjects().forEach(function(obj) {
            if (obj.type === 'textbox') obj.set('fontSize', size);
          });
          // Refresh group to resize bubble for new font size
          TagTool.refreshTagGroup(canvas, active);
        } else if (active && active.type === 'textbox') {
          active.set('fontSize', size);
          canvas.renderAll();
        }
      },
      onRectModeChange: function(mode) {
        if (!canvas) return;
        var active = canvas.getActiveObject();
        if (!active) return;

        var x = active.left;
        var y = active.top;
        // Account for scaling (user may have resized the object)
        var w = active.getScaledWidth();
        var h = active.getScaledHeight();

        if (mode === 'blur') {
          // Convert any rect/image to blur mosaic
          canvas.remove(active);
          var blurDataURL = ToolUtils.createMosaicImage(canvas, x, y, w, h);
          if (blurDataURL) {
            var imgEl = new Image();
            imgEl.onload = function() {
              var img = new fabric.FabricImage(imgEl, {
                left: x, top: y,
                originX: 'left', originY: 'top',
                scaleX: w / imgEl.width,
                scaleY: h / imgEl.height,
                selectable: true, evented: true,
                _snipRectMode: 'blur'
              });
              canvas.add(img);
              canvas.setActiveObject(img);
              canvas.renderAll();
            };
            imgEl.src = blurDataURL;
          }
        } else if (mode === 'highlight') {
          // Convert to highlight rect
          canvas.remove(active);
          var hlRect = new fabric.Rect({
            left: x, top: y, width: w, height: h,
            originX: 'left', originY: 'top',
            fill: ToolUtils.hexToRgba(Toolbar.getActiveColor(), 0.3),
            stroke: '', strokeWidth: 0,
            selectable: true, evented: true,
            _snipRectMode: 'highlight'
          });
          canvas.add(hlRect);
          canvas.setActiveObject(hlRect);
          canvas.renderAll();
        } else {
          // Convert to outline rect
          canvas.remove(active);
          var olRect = new fabric.Rect({
            left: x, top: y, width: w, height: h,
            originX: 'left', originY: 'top',
            fill: 'transparent',
            stroke: Toolbar.getActiveColor(),
            strokeWidth: Toolbar.getActiveStrokeWidth(),
            strokeUniform: true,
            selectable: true, evented: true,
            _snipRectMode: 'outline'
          });
          canvas.add(olRect);
          canvas.setActiveObject(olRect);
          canvas.renderAll();
        }
      },
      onDone: function() { copyToClipboardAndClose(); },
      onSave: function() { saveScreenshot(); },
      onCancel: function() {
        EditorCanvasManager.clearAnnotations();
        window.snip.closeEditor();
      },
      onUndo: function() {
        // Undo annotations first, then segment, then upscale (only when canvas is empty)
        if (canvas && canvas.getObjects().length > 0) {
          EditorCanvasManager.removeLastObject();
          return;
        }
        if (tools[TOOLS.SEGMENT] && tools[TOOLS.SEGMENT].undoCutout && tools[TOOLS.SEGMENT].undoCutout()) {
          return;
        }
        if (undoUpscale()) return;
        EditorCanvasManager.removeLastObject();
      },
      onRedo: function() {
        EditorCanvasManager.redoLastObject();
      },
      onReset: function() {
        if (currentToolHandler) {
          currentToolHandler.deactivate();
          currentToolHandler = null;
        }

        // If upscaled, fully revert to pre-upscale state (same as undoUpscale but also clears annotations)
        if (_preUpscaleState) {
          // Revert upscale: use the same logic as undoUpscale()
          undoUpscale();
          // Also clear any remaining annotations
          EditorCanvasManager.clearAnnotations();
        } else {
          var origDims = EditorCanvasManager.resetToOriginal();
          scaleImageToFit(origDims.cssW, origDims.cssH);
        }

        Toolbar.setTool(TOOLS.SELECT);
      }
    });

    // Global double-click handler for editing tag text
    canvas.on('mouse:dblclick', function(opt) {
      var target = opt.target;
      if (!target || !target._snipTagType) return;
      TagTool.enterTagEditing(canvas, target);
    });

    // Show contextual toolbar controls when selecting objects in any mode
    function onSelectionChange() {
      var active = canvas.getActiveObject();
      var tagColorGroup = document.getElementById('tag-color-group');
      var segmentColorGroup = document.getElementById('segment-color-group');
      var colorPicker = document.getElementById('color-picker');
      var fontGroup = document.getElementById('font-group');

      if (active && active._snipTagType) {
        fontGroup.classList.remove('hidden');
        colorPicker.classList.add('hidden');

        // Segment tags use limited color palette; regular tags use full palette
        if (active._snipSegmentTag) {
          segmentColorGroup.classList.remove('hidden');
          tagColorGroup.classList.add('hidden');
          if (active._snipTagColor) {
            Toolbar.setActiveSegmentColor(active._snipTagColor);
          }
        } else {
          tagColorGroup.classList.remove('hidden');
          segmentColorGroup.classList.add('hidden');
          if (active._snipTagColor) {
            Toolbar.setActiveTagColor(active._snipTagColor);
          }
        }
        // Sync font from tag's textbox
        active.getObjects().forEach(function(obj) {
          if (obj.type === 'textbox') {
            Toolbar.setActiveFont(obj.fontFamily);
            Toolbar.setActiveFontSize(obj.fontSize);
          }
        });
        ensureToolbarFits();
      } else if (active && active.type === 'textbox' && active._snipEditingTagId) {
        // Textbox being edited as part of a tag
        fontGroup.classList.remove('hidden');
        colorPicker.classList.add('hidden');

        if (active._snipEditingSegmentTag) {
          segmentColorGroup.classList.remove('hidden');
          tagColorGroup.classList.add('hidden');
          if (active._snipEditingTagColor) {
            Toolbar.setActiveSegmentColor(active._snipEditingTagColor);
          }
        } else {
          tagColorGroup.classList.remove('hidden');
          segmentColorGroup.classList.add('hidden');
          if (active._snipEditingTagColor) {
            Toolbar.setActiveTagColor(active._snipEditingTagColor);
          }
        }
        Toolbar.setActiveFont(active.fontFamily);
        Toolbar.setActiveFontSize(active.fontSize);
        ensureToolbarFits();
      } else if (active && active.type === 'textbox') {
        // Standalone textbox selected: show font controls + color picker
        fontGroup.classList.remove('hidden');
        colorPicker.classList.remove('hidden');
        tagColorGroup.classList.add('hidden');
        segmentColorGroup.classList.add('hidden');
        // Sync font/size from the selected textbox
        Toolbar.setActiveFont(active.fontFamily);
        Toolbar.setActiveFontSize(active.fontSize);
        ensureToolbarFits();
      } else if (Toolbar.getActiveTool() !== TOOLS.TAG) {
        // Other object type: restore defaults
        tagColorGroup.classList.add('hidden');
        segmentColorGroup.classList.add('hidden');
        colorPicker.classList.remove('hidden');
        if (Toolbar.getActiveTool() !== TOOLS.TEXT) {
          fontGroup.classList.add('hidden');
        }
      }
    }
    canvas.on('selection:created', onSelectionChange);
    canvas.on('selection:updated', onSelectionChange);
    canvas.on('selection:cleared', function() {
      var tagColorGroup = document.getElementById('tag-color-group');
      var segmentColorGroup = document.getElementById('segment-color-group');
      var colorPicker = document.getElementById('color-picker');
      var fontGroup = document.getElementById('font-group');
      var tool = Toolbar.getActiveTool();
      if (tool !== TOOLS.TAG) {
        tagColorGroup.classList.add('hidden');
        colorPicker.classList.remove('hidden');
      }
      segmentColorGroup.classList.add('hidden');
      // Only show font group if TEXT or TAG tool is active
      if (tool !== TOOLS.TEXT && tool !== TOOLS.TAG) {
        fontGroup.classList.add('hidden');
      }
    });

    // Click-to-edit: clicking an already-selected textbox or tag enters editing
    var _clickEditState = { wasSelected: false, downX: 0, downY: 0 };

    canvas.on('mouse:down', function(opt) {
      _clickEditState.wasSelected = false;
      if (Toolbar.getActiveTool() !== TOOLS.SELECT) return;
      var target = opt.target;
      if (!target) return;
      var active = canvas.getActiveObject();
      if (target === active) {
        _clickEditState.wasSelected = true;
        _clickEditState.downX = opt.e.clientX;
        _clickEditState.downY = opt.e.clientY;
      }
    });

    canvas.on('mouse:up', function(opt) {
      if (!_clickEditState.wasSelected) return;
      _clickEditState.wasSelected = false;
      if (Toolbar.getActiveTool() !== TOOLS.SELECT) return;

      // Skip if it was a drag (mouse moved more than 5px)
      var dx = opt.e.clientX - _clickEditState.downX;
      var dy = opt.e.clientY - _clickEditState.downY;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return;

      var target = opt.target;
      if (!target) return;

      if (target.type === 'textbox' && !target.isEditing) {
        target.enterEditing();
        canvas.renderAll();
      } else if (target._snipTagType) {
        TagTool.enterTagEditing(canvas, target);
      }
    });

    // Update leader line when a tag label group or tip anchor is dragged
    canvas.on('object:moving', function(opt) {
      var target = opt.target;
      if (!target || !target._snipTagId) return;

      var tagId = target._snipTagId;
      var tipObj = null;
      var tagLine = null;
      var labelGroup = null;

      canvas.getObjects().forEach(function(obj) {
        if (obj._snipTagId === tagId && obj._snipTagRole === 'tip') tipObj = obj;
        if (obj._snipTagId === tagId && obj._snipTagRole === 'line') tagLine = obj;
        if (obj._snipTagId === tagId && obj._snipTagType) labelGroup = obj;
      });

      if (target._snipTagRole === 'tip') {
        // Tip anchor is being dragged — update line from tip to label group edge
        if (tagLine && labelGroup) {
          var groupBounds = labelGroup.getBoundingRect();
          var endpoint = ToolUtils.lineEndpointForTag(target.left, target.top, groupBounds);
          tagLine.set({ x1: target.left, y1: target.top, x2: endpoint.x, y2: endpoint.y });
          tagLine.setCoords();
          canvas.renderAll();
        }
      } else if (target._snipTagType) {
        // Label group is being dragged — update line from tip to new label position
        if (tipObj && tagLine) {
          var movingBounds = target.getBoundingRect();
          var endpoint = ToolUtils.lineEndpointForTag(tipObj.left, tipObj.top, movingBounds);
          tagLine.set({ x1: tipObj.left, y1: tipObj.top, x2: endpoint.x, y2: endpoint.y });
          tagLine.setCoords();
        }
      }
    });
  }

  function switchTool(tool) {
    if (currentToolHandler) {
      currentToolHandler.deactivate();
      currentToolHandler = null;
    }
    if (tool !== TOOLS.SELECT && tools[tool]) {
      currentToolHandler = tools[tool];
      currentToolHandler.activate();
    } else if (canvas) {
      canvas.selection = true;
      canvas.defaultCursor = 'default';
    }
  }

  async function copyToClipboardAndClose() {
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.renderAll();
    var dataURL = EditorCanvasManager.exportAsDataURL('png', 1.0);
    await window.snip.copyToClipboard(dataURL);
    EditorCanvasManager.clearAnnotations();
    window.snip.closeEditor();
    window.snip.showNotification('Copied to clipboard');
  }

  async function saveScreenshot() {
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.renderAll();

    var now = new Date();
    var timestamp = now.toISOString().replace(/T/, '_').replace(/:/g, '-').replace(/\..+/, '');

    var jpegDataURL = EditorCanvasManager.exportAsDataURL('jpeg', 0.92);
    await window.snip.saveScreenshot(jpegDataURL, timestamp);

    var pngDataURL = EditorCanvasManager.exportAsDataURL('png', 1.0);
    await window.snip.copyToClipboard(pngDataURL);

    EditorCanvasManager.clearAnnotations();
    window.snip.closeEditor();
    window.snip.showNotification('Saved & copied to clipboard');
  }

  document.addEventListener('keydown', async function(e) {
    if (canvas) {
      var active = canvas.getActiveObject();
      if (active && active.type === 'textbox' && active.isEditing) {
        if (e.key === 'Escape') {
          active.exitEditing();
          canvas.discardActiveObject();
          canvas.renderAll();
          e.preventDefault();
        }
        return;
      }
    }

    // Transcript panel shortcuts
    if (typeof TranscribeTool !== 'undefined' && TranscribeTool.isActive()) {
      if (e.key === 'Escape') {
        e.preventDefault();
        TranscribeTool.dismiss();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        TranscribeTool.copyText();
        TranscribeTool.dismiss();
      }
      return;
    }

    // Don't close the editor while animation panels are open
    if (typeof AnimateTool !== 'undefined' && AnimateTool.isActive()) {
      if (e.key === 'Escape') {
        e.preventDefault();
        AnimateTool.dismiss();
      } else {
        AnimateTool.handleKeydown(e);
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      var currentTool = Toolbar.getActiveTool();
      if (currentTool === TOOLS.RECT || currentTool === TOOLS.ARROW || currentTool === TOOLS.BLUR_BRUSH) {
        // Finish drawing session: switch to select mode
        Toolbar.setTool(TOOLS.SELECT);
      } else {
        await copyToClipboardAndClose();
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      await copyToClipboardAndClose();
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      await saveScreenshot();
    }

    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') {
      e.preventDefault();
      EditorCanvasManager.redoLastObject();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      if (canvas && canvas.getObjects().length > 0) {
        EditorCanvasManager.removeLastObject();
        return;
      }
      if (tools[TOOLS.SEGMENT] && tools[TOOLS.SEGMENT].undoCutout && tools[TOOLS.SEGMENT].undoCutout()) {
        return;
      }
      if (undoUpscale()) return;
      EditorCanvasManager.removeLastObject();
    }

    if (e.key === 'Delete' || (e.key === 'Backspace' && !e.target.closest('input, textarea, select'))) {
      if (canvas) {
        var activeObj = canvas.getActiveObject();
        if (activeObj && !(activeObj.type === 'textbox' && activeObj.isEditing)) {
          // Remove linked tag parts (tip, line, overlay) alongside the label group
          if (activeObj._snipTagId) {
            canvas.getObjects().slice().forEach(function(obj) {
              if (obj._snipTagId === activeObj._snipTagId) {
                canvas.remove(obj);
              }
            });
          } else {
            canvas.remove(activeObj);
          }
          canvas.renderAll();
        }
      }
    }
  });

  // Capture-phase: Enter finishes textbox editing and returns to cursor mode, Shift+Enter inserts newline
  document.addEventListener('keydown', function(e) {
    if (!canvas) return;
    var active = canvas.getActiveObject();
    if (!active || active.type !== 'textbox' || !active.isEditing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      active.exitEditing();
      canvas.renderAll();
      // Switch to cursor (select) mode after confirming text
      Toolbar.setTool(TOOLS.SELECT);
    }
    // Shift+Enter falls through to Fabric.js default (inserts newline)
  }, true);
})();
