/* exported SelectionTool */

const SelectionTool = (() => {
  function getAccent() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8B5CF6';
  }

  // States: 'idle' | 'drawing' | 'selected' | 'moving'
  function attach(canvasEl, fullWidth, fullHeight, onComplete, onCancel) {
    const overlay = document.getElementById('selection-overlay');
    const ctx = overlay.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Set canvas to physical resolution, CSS to logical for crisp rendering
    overlay.width = fullWidth * dpr;
    overlay.height = fullHeight * dpr;
    overlay.style.width = fullWidth + 'px';
    overlay.style.height = fullHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var state = 'idle';
    // Drawing state
    var drawStartX = 0, drawStartY = 0;
    var drawCurrentX = 0, drawCurrentY = 0;
    // Selection rect (finalized)
    var selX = 0, selY = 0, selW = 0, selH = 0;
    // Moving state
    var moveOffsetX = 0, moveOffsetY = 0;

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
      } else if (state === 'selected' || state === 'moving') {
        x = selX; y = selY; w = selW; h = selH;
      } else {
        return; // idle — just dim
      }

      if (w < 1 || h < 1) return;

      // Cut out the selected region
      ctx.clearRect(x, y, w, h);

      // Draw selection border
      ctx.strokeStyle = getAccent();
      ctx.lineWidth = 2;
      if (state === 'drawing') {
        ctx.setLineDash([6, 3]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      // Dimensions label at top-left
      if (w > 30 && h > 20) {
        var label = Math.round(w) + ' \u00d7 ' + Math.round(h);
        ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
        var textW = ctx.measureText(label).width;
        var labelX = x;
        var labelY = y - 8;
        if (labelY - 16 < 0) labelY = y + 20;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(labelX, labelY - 16, textW + 12, 22);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText(label, labelX + 6, labelY - 1);
      }
    }

    function isInsideSelection(mx, my) {
      return mx >= selX && mx <= selX + selW && my >= selY && my <= selY + selH;
    }

    function onMouseDown(e) {
      var mx = e.clientX, my = e.clientY;

      if (state === 'selected' && isInsideSelection(mx, my)) {
        // Start moving existing selection
        state = 'moving';
        moveOffsetX = mx - selX;
        moveOffsetY = my - selY;
        overlay.style.cursor = 'grabbing';
      } else {
        // Start new drawing (from idle or replacing existing selection)
        state = 'drawing';
        drawStartX = mx;
        drawStartY = my;
        drawCurrentX = mx;
        drawCurrentY = my;
        overlay.style.cursor = 'crosshair';
      }
      draw();
    }

    function onMouseMove(e) {
      var mx = e.clientX, my = e.clientY;

      if (state === 'drawing') {
        drawCurrentX = mx;
        drawCurrentY = my;
        draw();
      } else if (state === 'moving') {
        selX = Math.max(0, Math.min(mx - moveOffsetX, fullWidth - selW));
        selY = Math.max(0, Math.min(my - moveOffsetY, fullHeight - selH));
        draw();
      } else if (state === 'selected') {
        // Update cursor based on hover
        overlay.style.cursor = isInsideSelection(mx, my) ? 'grab' : 'crosshair';
      }
    }

    function onMouseUp(e) {
      var mx = e.clientX, my = e.clientY;

      if (state === 'drawing') {
        var x = Math.min(drawStartX, drawCurrentX);
        var y = Math.min(drawStartY, drawCurrentY);
        var w = Math.abs(drawCurrentX - drawStartX);
        var h = Math.abs(drawCurrentY - drawStartY);

        if (w > 10 && h > 10) {
          // Valid selection — enter selected state
          selX = x; selY = y; selW = w; selH = h;
          state = 'selected';
          overlay.style.cursor = isInsideSelection(mx, my) ? 'grab' : 'crosshair';
        } else {
          // Too small, reset to idle
          state = 'idle';
          overlay.style.cursor = 'crosshair';
        }
        draw();
      } else if (state === 'moving') {
        state = 'selected';
        overlay.style.cursor = isInsideSelection(mx, my) ? 'grab' : 'crosshair';
        draw();
      }
    }

    function onKeyDown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (state === 'selected') {
          // Confirm the selection
          removeListeners();
          onComplete({ x: selX, y: selY, width: selW, height: selH });
        } else {
          // No selection — full screen
          cleanup();
          onComplete(null);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (state === 'selected') {
          // Clear selection, go back to idle
          state = 'idle';
          selX = selY = selW = selH = 0;
          overlay.style.cursor = 'crosshair';
          draw();
        } else {
          // Cancel entirely
          cleanup();
          onCancel();
        }
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
