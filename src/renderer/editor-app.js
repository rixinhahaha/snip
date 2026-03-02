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
          var imgToCanvasX = canvas.width / maskImg.width;
          var imgToCanvasY = canvas.height / maskImg.height;

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
      if (tools[TOOLS.SEGMENT] && tools[TOOLS.SEGMENT].undoCutout && tools[TOOLS.SEGMENT].undoCutout()) {
        return;
      }
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
