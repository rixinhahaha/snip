/* global fabric, ToolUtils */
/* exported ArrowTool */

const ArrowTool = (() => {
  function attach(canvas, getColor, getStrokeWidth) {
    let isDrawing = false;
    let startX, startY;
    let tempLine = null;

    function createArrow(fromX, fromY, toX, toY, color, sw) {
      const angle = Math.atan2(toY - fromY, toX - fromX) * (180 / Math.PI);
      const headLen = Math.max(sw * 4, 12);

      const line = new fabric.Line([fromX, fromY, toX, toY], {
        stroke: color, strokeWidth: sw, selectable: false, evented: false
      });
      const head = new fabric.Triangle({
        left: toX, top: toY, width: headLen, height: headLen, fill: color,
        angle: angle + 90, originX: 'center', originY: 'center',
        selectable: false, evented: false
      });
      return new fabric.Group([line, head], { selectable: true, evented: true });
    }

    function onMouseDown(opt) {
      if (opt.target) return;
      isDrawing = true;
      const pointer = ToolUtils.clampedScenePoint(canvas, opt.e);
      startX = pointer.x;
      startY = pointer.y;

      tempLine = new fabric.Line([startX, startY, startX, startY], {
        stroke: getColor(), strokeWidth: getStrokeWidth(),
        selectable: false, evented: false, strokeDashArray: [5, 5]
      });
      canvas.add(tempLine);
    }

    function onMouseMove(opt) {
      if (!isDrawing || !tempLine) return;
      const pointer = ToolUtils.clampedScenePoint(canvas, opt.e);
      tempLine.set({ x2: pointer.x, y2: pointer.y });
      canvas.renderAll();
    }

    function onMouseUp(opt) {
      if (!isDrawing) return;
      isDrawing = false;
      const pointer = ToolUtils.clampedScenePoint(canvas, opt.e);
      const px = pointer.x;
      const py = pointer.y;
      canvas.remove(tempLine);
      tempLine = null;

      const dist = Math.sqrt(Math.pow(px - startX, 2) + Math.pow(py - startY, 2));
      if (dist < 15) return;

      const arrow = createArrow(startX, startY, px, py, getColor(), getStrokeWidth());
      canvas.add(arrow);
      canvas.setActiveObject(arrow);
      canvas.renderAll();
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
        if (tempLine) { canvas.remove(tempLine); tempLine = null; isDrawing = false; }
        canvas.renderAll();
      }
    };
  }

  return { attach };
})();
