/* exported SelectionTool */

const SelectionTool = (() => {
  function getAccent() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8B5CF6';
  }

  // States: 'idle' | 'drawing'
  function attach(canvasEl, fullWidth, fullHeight, onComplete, onCancel, windowList) {
    const overlay = document.getElementById('selection-overlay');
    const ctx = overlay.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Set canvas to physical resolution, CSS to logical for crisp rendering
    overlay.width = fullWidth * dpr;
    overlay.height = fullHeight * dpr;
    overlay.style.width = fullWidth + 'px';
    overlay.style.height = fullHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var windows = windowList || [];

    var state = 'idle';
    // Drawing state
    var drawStartX = 0, drawStartY = 0;
    var drawCurrentX = 0, drawCurrentY = 0;
    // Selection rect (finalized)
    var selX = 0, selY = 0, selW = 0, selH = 0;
    // Window snap state
    var hoveredWindow = null;
    var pendingClick = false;
    var pendingClickX = 0, pendingClickY = 0;
    var DRAG_THRESHOLD = 5 * dpr;

    function findWindowAt(mx, my) {
      // Windows are sorted front-to-back (topmost first)
      for (var i = 0; i < windows.length; i++) {
        var w = windows[i];
        if (mx >= w.x && mx <= w.x + w.width && my >= w.y && my <= w.y + w.height) {
          return w;
        }
      }
      return null;
    }

    function draw() {
      ctx.clearRect(0, 0, fullWidth, fullHeight);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(0, 0, fullWidth, fullHeight);

      var x, y, w, h;

      if (state === 'drawing') {
        x = Math.min(drawStartX, drawCurrentX);
        y = Math.min(drawStartY, drawCurrentY);
        w = Math.abs(drawCurrentX - drawStartX);
        h = Math.abs(drawCurrentY - drawStartY);
      } else if (state === 'idle' && hoveredWindow) {
        // Highlight the window under cursor
        x = hoveredWindow.x; y = hoveredWindow.y;
        w = hoveredWindow.width; h = hoveredWindow.height;
      } else {
        return; // idle, no window — just dim
      }

      if (w < 1 || h < 1) return;

      // Clamp to overlay bounds for drawing
      var drawX = Math.max(0, x);
      var drawY = Math.max(0, y);
      var drawW = Math.min(w, fullWidth - drawX);
      var drawH = Math.min(h, fullHeight - drawY);

      // Cut out the selected region
      ctx.clearRect(drawX, drawY, drawW, drawH);

      // Draw selection border
      var accent = getAccent();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      if (state === 'drawing') {
        ctx.setLineDash([6, 3]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.strokeRect(drawX, drawY, drawW, drawH);
      ctx.setLineDash([]);

      // Window hover: add subtle accent fill
      if (state === 'idle' && hoveredWindow) {
        // Parse accent hex to rgba for reliable opacity
        var a = accent.trim();
        var r = parseInt(a.slice(1, 3), 16) || 139;
        var g = parseInt(a.slice(3, 5), 16) || 92;
        var b = parseInt(a.slice(5, 7), 16) || 246;
        ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.1)';
        ctx.fillRect(drawX, drawY, drawW, drawH);
      }

      // Label: window name on hover, dimensions otherwise
      var label;
      if (state === 'idle' && hoveredWindow) {
        label = hoveredWindow.owner || '';
        if (hoveredWindow.name) label += (label ? ' — ' : '') + hoveredWindow.name;
        if (!label) label = Math.round(w) + ' \u00d7 ' + Math.round(h);
      } else {
        label = Math.round(w) + ' \u00d7 ' + Math.round(h);
      }
      if (w > 30 && h > 20) {
        ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
        var textW = ctx.measureText(label).width;
        var labelX = drawX;
        var labelY = drawY - 8;
        if (labelY - 16 < 0) labelY = drawY + 20;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(labelX, labelY - 16, textW + 12, 22);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText(label, labelX + 6, labelY - 1);
      }
    }

    function onMouseDown(e) {
      var mx = e.clientX, my = e.clientY;

      // If there's a hovered window, start pending click detection
      if (state === 'idle' && hoveredWindow) {
        pendingClick = true;
        pendingClickX = mx;
        pendingClickY = my;
      }
      // Start new drawing
      state = 'drawing';
      drawStartX = mx;
      drawStartY = my;
      drawCurrentX = mx;
      drawCurrentY = my;
      overlay.style.cursor = 'crosshair';
      draw();
    }

    function onMouseMove(e) {
      var mx = e.clientX, my = e.clientY;

      if (state === 'drawing') {
        // If pending click and moved past threshold, cancel window snap
        if (pendingClick) {
          var dx = mx - pendingClickX;
          var dy = my - pendingClickY;
          if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
            pendingClick = false;
            hoveredWindow = null;
          }
        }
        drawCurrentX = mx;
        drawCurrentY = my;
        draw();
      } else if (state === 'idle' && windows.length > 0) {
        // Highlight window under cursor
        var win = findWindowAt(mx, my);
        if (win !== hoveredWindow) {
          hoveredWindow = win;
          draw();
        }
      }
    }

    function onMouseUp(e) {
      var mx = e.clientX, my = e.clientY;

      if (state !== 'drawing') return;

      // Check for window snap click (small drag = click on window)
      if (pendingClick && hoveredWindow) {
        var dx = mx - pendingClickX;
        var dy = my - pendingClickY;
        if (Math.sqrt(dx * dx + dy * dy) <= DRAG_THRESHOLD) {
          // Snap to window bounds
          selX = Math.max(0, hoveredWindow.x);
          selY = Math.max(0, hoveredWindow.y);
          selW = Math.min(hoveredWindow.width, fullWidth - selX);
          selH = Math.min(hoveredWindow.height, fullHeight - selY);
          pendingClick = false;
          hoveredWindow = null;
          removeListeners();
          onComplete({ x: selX, y: selY, width: selW, height: selH });
          return;
        }
      }
      pendingClick = false;

      var x = Math.min(drawStartX, drawCurrentX);
      var y = Math.min(drawStartY, drawCurrentY);
      var w = Math.abs(drawCurrentX - drawStartX);
      var h = Math.abs(drawCurrentY - drawStartY);

      if (w > 10 && h > 10) {
        // Valid selection — complete immediately
        selX = x; selY = y; selW = w; selH = h;
        hoveredWindow = null;
        removeListeners();
        onComplete({ x: selX, y: selY, width: selW, height: selH });
        return;
      } else {
        // Too small, reset to idle
        state = 'idle';
        overlay.style.cursor = 'crosshair';
      }
      draw();
    }

    function onKeyDown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        // No selection — full screen capture
        cleanup();
        onComplete(null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
        onCancel();
      }
    }

    function removeListeners() {
      overlay.removeEventListener('mousedown', onMouseDown);
      overlay.removeEventListener('mousemove', onMouseMove);
      overlay.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
    }

    function activate() {
      state = 'idle';
      overlay.classList.remove('hidden');
      overlay.style.cursor = 'crosshair';
      draw();
      overlay.addEventListener('mousedown', onMouseDown);
      overlay.addEventListener('mousemove', onMouseMove);
      overlay.addEventListener('mouseup', onMouseUp);
      document.addEventListener('keydown', onKeyDown);
    }

    function cleanup() {
      removeListeners();
      overlay.classList.add('hidden');
      overlay.style.cursor = 'crosshair';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    }

    return { activate, cleanup };
  }

  return { attach };
})();
