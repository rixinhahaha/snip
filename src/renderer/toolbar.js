/* exported Toolbar */

const Toolbar = (() => {
  // TOOLS is built dynamically from extensions, but starts with a default for backwards compat
  let TOOLS = { SELECT: 'select', RECT: 'rect', TEXT: 'text', ARROW: 'arrow', TAG: 'tag', BLUR_BRUSH: 'blur-brush', SEGMENT: 'segment' };

  let activeTool = 'select';
  let activeColor = '#ff3b30';
  let activeStrokeWidth = 4;
  let activeFont = 'Plus Jakarta Sans';
  let activeFontSize = 16;
  let activeBrushSize = 20;
  let rectMode = 'outline';
  let activeTagColor = '#64748B';
  let activeSegmentColor = '#EF4444';
  let toolChangeCallback = null;

  function initToolbar(callbacks) {
    toolChangeCallback = callbacks.onToolChange;

    // Build TOOLS enum from extensions if available
    if (typeof ExtensionLoader !== 'undefined' && ExtensionLoader.getExtensions().length > 0) {
      TOOLS = ExtensionLoader.buildToolsEnum();
      // Ensure SELECT always exists
      if (!TOOLS.SELECT) TOOLS.SELECT = 'select';
    }

    // Wire up tool buttons dynamically from DOM
    document.querySelectorAll('#toolbar-tools .tool-btn').forEach(function (btn) {
      var toolId = btn.id.replace(/^tool-/, '');
      // Only wire canvas-tool and ai-tool buttons (not action-tool buttons like btn-upscale)
      if (btn.id.startsWith('tool-')) {
        btn.addEventListener('click', function () { setTool(toolId); });
      }
    });

    // Wire action buttons (btn-upscale etc.) — these just click, no tool mode switch
    // They're handled by editor-app.js directly

    document.getElementById('color-picker').addEventListener('input', (e) => {
      activeColor = e.target.value;
      if (callbacks.onColorChange) callbacks.onColorChange(activeColor);
    });

    document.getElementById('stroke-width').addEventListener('change', (e) => {
      activeStrokeWidth = parseInt(e.target.value);
      if (callbacks.onStrokeWidthChange) callbacks.onStrokeWidthChange(activeStrokeWidth);
    });

    document.getElementById('font-select').addEventListener('change', (e) => {
      activeFont = e.target.value;
      if (callbacks.onFontChange) callbacks.onFontChange(activeFont);
    });

    document.getElementById('font-size').addEventListener('change', (e) => {
      activeFontSize = parseInt(e.target.value);
      if (callbacks.onFontSizeChange) callbacks.onFontSizeChange(activeFontSize);
    });

    document.getElementById('rect-mode').addEventListener('change', (e) => {
      rectMode = e.target.value;
      if (callbacks.onRectModeChange) callbacks.onRectModeChange(rectMode);
    });

    document.getElementById('brush-size').addEventListener('change', (e) => {
      activeBrushSize = parseInt(e.target.value);
    });

    document.querySelectorAll('#tag-color-group .tag-color-swatch').forEach((swatch) => {
      swatch.addEventListener('click', () => {
        activeTagColor = swatch.dataset.color;
        document.querySelectorAll('#tag-color-group .tag-color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        if (callbacks.onTagColorChange) callbacks.onTagColorChange(activeTagColor);
      });
    });

    document.querySelectorAll('.segment-color-swatch').forEach((swatch) => {
      swatch.addEventListener('click', () => {
        activeSegmentColor = swatch.dataset.color;
        document.querySelectorAll('.segment-color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        if (callbacks.onSegmentColorChange) callbacks.onSegmentColorChange(activeSegmentColor);
      });
    });

    // Build shortcut maps from extensions
    var toolShortcutMap = (typeof ExtensionLoader !== 'undefined')
      ? ExtensionLoader.buildShortcutMap()
      : { 'v': 'select', 'r': 'rect', 't': 'text', 'a': 'arrow', 'g': 'tag', 'b': 'blur-brush', 's': 'segment' };

    var actionShortcutMap = (typeof ExtensionLoader !== 'undefined')
      ? ExtensionLoader.buildActionShortcutMap()
      : { 'u': 'btn-upscale', 'w': 'tool-transcribe' };

    // Maps for custom shortcut config updates
    var shortcutToToolAction = {
      'tool-select': 'select', 'tool-rectangle': 'rect', 'tool-text': 'text',
      'tool-arrow': 'arrow', 'tool-tag': 'tag', 'tool-blur': 'blur-brush',
      'tool-segment': 'segment'
    };

    var shortcutToActionBtn = {
      'tool-upscale': 'btn-upscale',
      'tool-transcribe': 'tool-transcribe'
    };

    function updateToolShortcuts(shortcuts) {
      toolShortcutMap = {};
      for (var action in shortcutToToolAction) {
        if (shortcuts[action]) {
          toolShortcutMap[shortcuts[action].toLowerCase()] = shortcutToToolAction[action];
        }
      }
      actionShortcutMap = {};
      for (var action in shortcutToActionBtn) {
        if (shortcuts[action]) {
          actionShortcutMap[shortcuts[action].toLowerCase()] = shortcutToActionBtn[action];
        }
      }
    }

    // Load custom shortcuts from config
    if (window.snip && window.snip.getShortcuts) {
      window.snip.getShortcuts().then(function(shortcuts) {
        updateToolShortcuts(shortcuts);
      });
      if (window.snip.onShortcutsChanged) {
        window.snip.onShortcutsChanged(function(shortcuts) {
          updateToolShortcuts(shortcuts);
        });
      }
    }

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const canvas = callbacks.getCanvas && callbacks.getCanvas();
      if (canvas) {
        const active = canvas.getActiveObject();
        if (active && active.type === 'textbox' && active.isEditing) return;
      }
      // Don't handle tool shortcuts when modifiers are pressed (except Shift)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var key = e.key.toLowerCase();
      var tool = toolShortcutMap[key];
      if (tool) { setTool(tool); return; }
      var actionBtnId = actionShortcutMap[key];
      if (actionBtnId) {
        var btn = document.getElementById(actionBtnId);
        if (btn) btn.click();
      }
    });

    document.getElementById('btn-done').addEventListener('click', () => callbacks.onDone());
    document.getElementById('btn-save').addEventListener('click', () => callbacks.onSave());
    document.getElementById('btn-cancel').addEventListener('click', () => callbacks.onCancel());
    document.getElementById('btn-undo').addEventListener('click', () => callbacks.onUndo());
    document.getElementById('btn-redo').addEventListener('click', () => { if (callbacks.onRedo) callbacks.onRedo(); });
    document.getElementById('btn-reset').addEventListener('click', () => { if (callbacks.onReset) callbacks.onReset(); });
  }

  function setTool(tool) {
    // Don't switch to segment if button is hidden (device not supported)
    var segBtn = document.getElementById('tool-segment');
    if (tool === 'segment' && segBtn && segBtn.classList.contains('hidden')) return;

    activeTool = tool;
    document.querySelectorAll('#toolbar-tools .tool-btn').forEach(btn => btn.classList.remove('active'));
    var toolBtn = document.getElementById('tool-' + tool);
    if (toolBtn) {
      toolBtn.classList.add('active');
    }

    // Show/hide contextual controls based on extension toolbar groups
    var allGroups = ['rect-mode-group', 'stroke-group', 'font-group', 'tag-color-group', 'brush-group', 'segment-color-group'];
    var activeGroups = (typeof ExtensionLoader !== 'undefined')
      ? ExtensionLoader.getToolbarGroups(tool)
      : [];

    // Fallback: if no extension data, use hardcoded mappings
    if (activeGroups.length === 0 && typeof ExtensionLoader === 'undefined') {
      var isTag = (tool === 'tag');
      var showStroke = (tool === 'rect' || tool === 'arrow');
      activeGroups = [];
      if (showStroke) activeGroups.push('stroke-group');
      if (tool === 'rect') activeGroups.push('rect-mode-group');
      if (tool === 'text' || isTag) activeGroups.push('font-group');
      if (isTag) activeGroups.push('tag-color-group');
      if (tool === 'blur-brush') activeGroups.push('brush-group');
    }

    allGroups.forEach(function (groupId) {
      var el = document.getElementById(groupId);
      if (el) el.classList.toggle('hidden', activeGroups.indexOf(groupId) === -1);
    });

    // Hide color picker when tag tool is active (tags use their own swatches)
    var colorPicker = document.getElementById('color-picker');
    if (colorPicker) colorPicker.classList.toggle('hidden', tool === 'tag');

    if (toolChangeCallback) toolChangeCallback(tool);
  }

  /**
   * Show the segment tool button (called after addon install check)
   */
  function enableSegmentTool() {
    var btn = document.getElementById('tool-segment');
    if (btn) btn.classList.remove('hidden');
  }

  /**
   * Show the upscale tool button (called after addon install check)
   */
  function enableUpscaleTool() {
    var btn = document.getElementById('btn-upscale');
    if (btn) btn.classList.remove('hidden');
  }

  return {
    TOOLS,
    initToolbar,
    setTool,
    enableSegmentTool,
    enableUpscaleTool,
    getActiveTool: () => activeTool,
    getActiveColor: () => activeColor,
    getActiveStrokeWidth: () => activeStrokeWidth,
    getActiveFont: () => activeFont,
    getActiveFontSize: () => activeFontSize,
    getActiveBrushSize: () => activeBrushSize,
    getActiveTagColor: () => activeTagColor,
    setActiveTagColor: (color) => {
      activeTagColor = color;
      document.querySelectorAll('#tag-color-group .tag-color-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color === color);
      });
    },
    getActiveSegmentColor: () => activeSegmentColor,
    setActiveSegmentColor: (color) => {
      activeSegmentColor = color;
      document.querySelectorAll('.segment-color-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color === color);
      });
    },
    setActiveFont: (font) => {
      activeFont = font;
      var sel = document.getElementById('font-select');
      if (sel) sel.value = font;
    },
    setActiveFontSize: (size) => {
      activeFontSize = size;
      var sel = document.getElementById('font-size');
      if (sel) sel.value = String(size);
    },
    getRectMode: () => rectMode
  };
})();
