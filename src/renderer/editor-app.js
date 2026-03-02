/* global EditorCanvasManager, Toolbar, RectangleTool, TextTool, ArrowTool, TagTool, BlurBrushTool, SegmentTool, AnimateTool, ToolUtils */

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

  document.addEventListener('DOMContentLoaded', async () => {
    const imageData = await window.snip.getEditorImage();
    if (!imageData) {
      console.error('[Snip] No image data received');
      return;
    }

    const { croppedDataURL, cssWidth, cssHeight } = imageData;

    // Use actual image dimensions so canvas matches the image exactly
    // (window may be larger due to min-size constraints, toolbar, and padding)
    var canvasW = cssWidth;
    var canvasH = cssHeight;

    // Initialize Fabric canvas to fill the image area
    canvas = EditorCanvasManager.initCanvas(canvasW, canvasH);

    // Set background image on <img> element
    EditorCanvasManager.setBackgroundImage(croppedDataURL, canvasW, canvasH);

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

    // Setup annotation tools
    setupTools();

    // Check SAM support and show segment tool if compatible
    await checkSegmentSupport();

    // Ensure window is wide enough for full toolbar
    await ensureToolbarFits();
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
      getTagColor: Toolbar.getActiveTagColor,
      getFont: Toolbar.getActiveFont,
      getFontSize: Toolbar.getActiveFontSize
    });

    // Initialize animate tool (2GIF)
    AnimateTool.init();

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
      onTagColorChange: function(color) {
        var active = canvas.getActiveObject();
        if (active && active._snipTagType) {
          active.getObjects().forEach(function(obj) {
            if (obj.type === 'textbox') obj.set({ fill: '#FFFFFF', cursorColor: '#FFFFFF' });
            else if (obj.type === 'circle') obj.set({ fill: color, stroke: color });
            else if (obj.type === 'line') obj.set({ stroke: color });
            else if (obj.type === 'rect') obj.set({ stroke: color, fill: color });
          });
          active._snipTagColor = color;
          canvas.renderAll();
        }
      },
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
          canvas.renderAll();
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
          canvas.renderAll();
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
        // Try segment undo first, fall back to removing last object
        if (tools[TOOLS.SEGMENT] && tools[TOOLS.SEGMENT].undoCutout && tools[TOOLS.SEGMENT].undoCutout()) {
          return;
        }
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
        EditorCanvasManager.resetToOriginal();
        Toolbar.setTool(TOOLS.SELECT);
      }
    });

    // Global double-click handler for editing tag text
    canvas.on('mouse:dblclick', function(opt) {
      var target = opt.target;
      if (!target || !target._snipTagType) return;
      TagTool.enterTagEditing(canvas, target);
    });

    // Show tag color swatches when a tag group is selected (even in select mode)
    function onSelectionChange() {
      var active = canvas.getActiveObject();
      var tagColorGroup = document.getElementById('tag-color-group');
      var colorPicker = document.getElementById('color-picker');
      if (active && active._snipTagType) {
        tagColorGroup.classList.remove('hidden');
        colorPicker.classList.add('hidden');
        if (active._snipTagColor) {
          Toolbar.setActiveTagColor(active._snipTagColor);
        }
      } else if (Toolbar.getActiveTool() !== TOOLS.TAG) {
        tagColorGroup.classList.add('hidden');
        colorPicker.classList.remove('hidden');
      }
    }
    canvas.on('selection:created', onSelectionChange);
    canvas.on('selection:updated', onSelectionChange);
    canvas.on('selection:cleared', function() {
      var tagColorGroup = document.getElementById('tag-color-group');
      var colorPicker = document.getElementById('color-picker');
      if (Toolbar.getActiveTool() !== TOOLS.TAG) {
        tagColorGroup.classList.add('hidden');
        colorPicker.classList.remove('hidden');
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

    if (e.key === 'Escape' || e.key === 'Enter') {
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
      if (tools[TOOLS.SEGMENT] && tools[TOOLS.SEGMENT].undoCutout && tools[TOOLS.SEGMENT].undoCutout()) {
        return;
      }
      EditorCanvasManager.removeLastObject();
    }

    if (e.key === 'Delete' || (e.key === 'Backspace' && !e.target.closest('input, textarea, select'))) {
      if (canvas) {
        var activeObj = canvas.getActiveObject();
        if (activeObj && !(activeObj.type === 'textbox' && activeObj.isEditing)) {
          canvas.remove(activeObj);
          canvas.renderAll();
        }
      }
    }
  });
})();
