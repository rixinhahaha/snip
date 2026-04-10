/* exported SelectionTool */

const SelectionTool = (() => {
  function getAccent() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8B5CF6';
  }

  // Parse ratio string like "4:3" into { w: 4, h: 3 }, or null for "free"
  function parseRatio(str) {
    if (!str || str === 'free') return null;
    var parts = str.split(':');
    return { w: parseInt(parts[0], 10), h: parseInt(parts[1], 10) };
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
    var DRAG_THRESHOLD = 5; // CSS pixels (clientX/Y space)

    // Aspect ratio state
    var activeRatio = null; // null = free, or { w, h }
    var activeRatioName = null; // display string like "16:9"
    var ratioBar = document.getElementById('ratio-bar');
    var ratioButtons = ratioBar ? ratioBar.querySelectorAll('.ratio-btn') : [];
    var hint = document.getElementById('selection-hint');

    function onRatioClick(e) {
      e.stopPropagation();
      e.preventDefault();
      var btn = e.currentTarget;
      var ratioStr = btn.getAttribute('data-ratio');
      activeRatio = parseRatio(ratioStr);
      activeRatioName = ratioStr === 'free' ? null : ratioStr;
      // Toggle active class
      for (var i = 0; i < ratioButtons.length; i++) {
        ratioButtons[i].classList.remove('active');
      }
      btn.classList.add('active');
    }

    function findWindowAt(mx, my) {
      for (var i = 0; i < windows.length; i++) {
        var w = windows[i];
        if (mx >= w.x && mx < w.x + w.width && my >= w.y && my < w.y + w.height) {
          return w;
        }
      }
      return null;
    }

    function constrainToRatio(startX, startY, currentX, currentY) {
      if (!activeRatio) return { x: currentX, y: currentY };

      var dx = currentX - startX;
      var dy = currentY - startY;
      var absDx = Math.abs(dx);
      var absDy = Math.abs(dy);

      // Determine orientation from dominant drag direction
      var ratioW, ratioH;
      if (absDx >= absDy) {
        // Landscape: use ratio as-is
        ratioW = activeRatio.w;
        ratioH = activeRatio.h;
      } else {
        // Portrait: swap ratio
        ratioW = activeRatio.h;
        ratioH = activeRatio.w;
      }

      // Constrain: fit the rectangle inside the drag box
      // Try width-driven: given absDx, compute required height
      var hFromW = absDx * ratioH / ratioW;
      // Try height-driven: given absDy, compute required width
      var wFromH = absDy * ratioW / ratioH;

      var finalW, finalH;
      if (hFromW <= absDy) {
        // Width-driven fits inside drag box
        finalW = absDx;
        finalH = hFromW;
      } else {
        // Height-driven
        finalW = wFromH;
        finalH = absDy;
      }

      // Apply direction signs
      var signX = dx >= 0 ? 1 : -1;
      var signY = dy >= 0 ? 1 : -1;

      return {
        x: startX + finalW * signX,
        y: startY + finalH * signY
      };
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
        if (activeRatioName) {
          label += ' (' + activeRatioName + ')';
        }
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

      // Fade ratio bar while drawing
      if (ratioBar) ratioBar.classList.add('ratio-bar-faded');

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

        // Apply aspect ratio constraint
        if (activeRatio) {
          var constrained = constrainToRatio(drawStartX, drawStartY, mx, my);
          drawCurrentX = constrained.x;
          drawCurrentY = constrained.y;
        } else {
          drawCurrentX = mx;
          drawCurrentY = my;
        }
        draw();
      } else if (state === 'idle') {
        // Hide hint when cursor is near the bottom bar area
        if (hint) {
          if (my > fullHeight - 80) {
            hint.classList.add('hidden');
          } else {
            hint.classList.remove('hidden');
          }
        }

        if (windows.length > 0) {
          // Highlight window under cursor
          var win = findWindowAt(mx, my);
          if (win !== hoveredWindow) {
            hoveredWindow = win;
            draw();
          }
        }
      }
    }

    function onMouseUp(e) {
      var mx = e.clientX, my = e.clientY;

      if (state !== 'drawing') return;

      // Unfade ratio bar
      if (ratioBar) ratioBar.classList.remove('ratio-bar-faded');

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

      // Show ratio bar and attach listeners
      if (ratioBar) {
        ratioBar.classList.remove('hidden');
        ratioBar.classList.remove('ratio-bar-faded');
        for (var i = 0; i < ratioButtons.length; i++) {
          ratioButtons[i].addEventListener('click', onRatioClick);
        }
      }

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

      // Hide ratio bar and remove listeners
      if (ratioBar) {
        ratioBar.classList.add('hidden');
        for (var i = 0; i < ratioButtons.length; i++) {
          ratioButtons[i].removeEventListener('click', onRatioClick);
        }
      }

      // Reset ratio to free for next session
      activeRatio = null;
      activeRatioName = null;
      if (ratioButtons.length) {
        for (var j = 0; j < ratioButtons.length; j++) {
          ratioButtons[j].classList.remove('active');
        }
        ratioButtons[0].classList.add('active');
      }
    }

    return { activate, cleanup };
  }

  return { attach };
})();
