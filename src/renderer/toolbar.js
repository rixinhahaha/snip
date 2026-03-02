/* exported Toolbar */

const Toolbar = (() => {
  const TOOLS = { SELECT: 'select', RECT: 'rect', TEXT: 'text', ARROW: 'arrow', TAG: 'tag', BLUR_BRUSH: 'blur-brush', SEGMENT: 'segment' };

  let activeTool = TOOLS.SELECT;
  let activeColor = '#ff3b30';
  let activeStrokeWidth = 4;
  let activeFont = 'Plus Jakarta Sans';
  let activeFontSize = 16;
  let activeBrushSize = 20;
  let rectMode = 'outline';
  let activeTagColor = '#64748B';
  let activeOutlineWidth = 8;
  let toolChangeCallback = null;

  function initToolbar(callbacks) {
    toolChangeCallback = callbacks.onToolChange;

    document.getElementById('tool-select').addEventListener('click', () => setTool(TOOLS.SELECT));
    document.getElementById('tool-rect').addEventListener('click', () => setTool(TOOLS.RECT));
    document.getElementById('tool-text').addEventListener('click', () => setTool(TOOLS.TEXT));
    document.getElementById('tool-arrow').addEventListener('click', () => setTool(TOOLS.ARROW));
    document.getElementById('tool-tag').addEventListener('click', () => setTool(TOOLS.TAG));
    document.getElementById('tool-blur-brush').addEventListener('click', () => setTool(TOOLS.BLUR_BRUSH));
    var segmentBtn = document.getElementById('tool-segment');
    if (segmentBtn) segmentBtn.addEventListener('click', () => setTool(TOOLS.SEGMENT));

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

    document.getElementById('outline-width').addEventListener('change', (e) => {
      activeOutlineWidth = parseInt(e.target.value);
      if (callbacks.onOutlineWidthChange) callbacks.onOutlineWidthChange(activeOutlineWidth);
    });

    document.querySelectorAll('.tag-color-swatch').forEach((swatch) => {
      swatch.addEventListener('click', () => {
        activeTagColor = swatch.dataset.color;
        document.querySelectorAll('.tag-color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        if (callbacks.onTagColorChange) callbacks.onTagColorChange(activeTagColor);
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const canvas = callbacks.getCanvas && callbacks.getCanvas();
      if (canvas) {
        const active = canvas.getActiveObject();
        if (active && active.type === 'textbox' && active.isEditing) return;
      }
      switch (e.key.toLowerCase()) {
        case 'v': setTool(TOOLS.SELECT); break;
        case 'r': setTool(TOOLS.RECT); break;
        case 't': setTool(TOOLS.TEXT); break;
        case 'a': setTool(TOOLS.ARROW); break;
        case 'g': setTool(TOOLS.TAG); break;
        case 'b': setTool(TOOLS.BLUR_BRUSH); break;
        case 's': if (!e.metaKey && !e.ctrlKey) setTool(TOOLS.SEGMENT); break;
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
    if (tool === TOOLS.SEGMENT && segBtn && segBtn.classList.contains('hidden')) return;

    activeTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    var toolBtn = document.getElementById('tool-' + tool);
    if (toolBtn) toolBtn.classList.add('active');

    // Show/hide contextual controls
    var isTag = (tool === TOOLS.TAG);
    var showStroke = (tool === TOOLS.RECT || tool === TOOLS.ARROW);
    document.getElementById('stroke-group').classList.toggle('hidden', !showStroke);
    document.getElementById('rect-mode-group').classList.toggle('hidden', tool !== TOOLS.RECT);
    document.getElementById('font-group').classList.toggle('hidden', tool !== TOOLS.TEXT && !isTag);
    document.getElementById('tag-color-group').classList.toggle('hidden', !isTag);
    document.getElementById('brush-group').classList.toggle('hidden', tool !== TOOLS.BLUR_BRUSH);
    document.getElementById('outline-width-group').classList.add('hidden');
    document.getElementById('color-picker').classList.toggle('hidden', isTag);

    if (toolChangeCallback) toolChangeCallback(tool);
  }

  /**
   * Show the segment tool button (called after device compatibility check)
   */
  function enableSegmentTool() {
    var btn = document.getElementById('tool-segment');
    if (btn) btn.classList.remove('hidden');
  }

  return {
    TOOLS,
    initToolbar,
    setTool,
    enableSegmentTool,
    getActiveTool: () => activeTool,
    getActiveColor: () => activeColor,
    getActiveStrokeWidth: () => activeStrokeWidth,
    getActiveFont: () => activeFont,
    getActiveFontSize: () => activeFontSize,
    getActiveBrushSize: () => activeBrushSize,
    getActiveTagColor: () => activeTagColor,
    setActiveTagColor: (color) => {
      activeTagColor = color;
      document.querySelectorAll('.tag-color-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color === color);
      });
    },
    getRectMode: () => rectMode,
    getActiveOutlineWidth: () => activeOutlineWidth,
    setActiveOutlineWidth: (w) => {
      activeOutlineWidth = w;
      var sel = document.getElementById('outline-width');
      if (sel) sel.value = String(w);
    }
  };
})();
