/* global fabric, ToolUtils */
/* exported RectangleTool */

const RectangleTool = (() => {
  function attach(canvas, getColor, getStrokeWidth, getMode) {
    let isDrawing = false;
    let startX, startY;
    let activeRect = null;

    function onMouseDown(opt) {
      // If clicking on an existing object, let Fabric handle selection/move
      if (opt.target) return;
      isDrawing = true;
      const pointer = ToolUtils.clampedScenePoint(canvas, opt.e);
      startX = pointer.x;
      startY = pointer.y;

      var mode = getMode();

      if (mode === 'highlight') {
        activeRect = new fabric.Rect({
          left: startX, top: startY, width: 0, height: 0,
          originX: 'left', originY: 'top',
          fill: ToolUtils.hexToRgba(getColor(), 0.3), stroke: '', strokeWidth: 0,
          selectable: false, evented: false
        });
      } else {
        activeRect = new fabric.Rect({
          left: startX, top: startY, width: 0, height: 0,
          originX: 'left', originY: 'top',
          fill: 'transparent', stroke: getColor(), strokeWidth: getStrokeWidth(),
          strokeUniform: true, selectable: false, evented: false
        });
      }
      canvas.add(activeRect);
    }

    function onMouseMove(opt) {
      if (!isDrawing || !activeRect) return;
      const pointer = ToolUtils.clampedScenePoint(canvas, opt.e);
      activeRect.set({
        left: Math.min(startX, pointer.x), top: Math.min(startY, pointer.y),
        width: Math.abs(pointer.x - startX), height: Math.abs(pointer.y - startY)
      });
      canvas.requestRenderAll();
    }

    function onMouseUp() {
      if (!activeRect) return;
      isDrawing = false;

      activeRect.setCoords();
      var w = activeRect.width;
      var h = activeRect.height;
      var x = activeRect.left;
      var y = activeRect.top;

      if (w < 3 && h < 3) {
        canvas.remove(activeRect);
        activeRect = null;
        canvas.renderAll();
        return;
      }

      var mode = getMode();

      if (mode === 'blur') {
        canvas.remove(activeRect);
        activeRect = null;

        var blurDataURL = ToolUtils.createMosaicImage(canvas, x, y, w, h);
        if (blurDataURL) {
          var imgEl = new Image();
          imgEl.onload = function() {
            var img = new fabric.FabricImage(imgEl, {
              left: x, top: y,
              originX: 'left', originY: 'top',
              scaleX: w / imgEl.width,
              scaleY: h / imgEl.height,
              selectable: true, evented: true
            });
            canvas.add(img);
            canvas.setActiveObject(img);
            canvas.renderAll();
          };
          imgEl.src = blurDataURL;
        }
      } else {
        activeRect.set({ selectable: true, evented: true });
        canvas.setActiveObject(activeRect);
        activeRect = null;
        canvas.renderAll();
      }
    }

    return {
      activate() {
        canvas.on('mouse:down', onMouseDown);
        canvas.on('mouse:move', onMouseMove);
        canvas.on('mouse:up', onMouseUp);
        canvas.selection = false;
        canvas.defaultCursor = 'crosshair';
        canvas.discardActiveObject();
        canvas.renderAll();
      },
      deactivate() {
        canvas.off('mouse:down', onMouseDown);
        canvas.off('mouse:move', onMouseMove);
        canvas.off('mouse:up', onMouseUp);
        canvas.selection = true;
        canvas.defaultCursor = 'default';
        if (isDrawing && activeRect) { canvas.remove(activeRect); activeRect = null; isDrawing = false; }
        canvas.renderAll();
      }
    };
  }

  return { attach };
})();
