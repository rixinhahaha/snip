/* global fabric, ToolUtils */
/* exported BlurBrushTool */

const BlurBrushTool = (() => {
  function attach(canvas, getBrushSize) {
    let isDrawing = false;
    let points = [];
    let previewObjects = [];
    let cursorCircle = null;

    function addMosaicTile(pt) {
      var size = getBrushSize();
      var tileX = Math.max(0, pt.x - size / 2);
      var tileY = Math.max(0, pt.y - size / 2);
      var tileW = Math.min(size, canvas.width - tileX);
      var tileH = Math.min(size, canvas.height - tileY);

      if (tileW < 1 || tileH < 1) return;

      var dataURL = ToolUtils.createMosaicImage(canvas, tileX, tileY, tileW, tileH, 8);
      if (!dataURL) return;

      var imgEl = new Image();
      imgEl.onload = function() {
        var img = new fabric.FabricImage(imgEl, {
          left: tileX,
          top: tileY,
          originX: 'left',
          originY: 'top',
          scaleX: tileW / imgEl.width,
          scaleY: tileH / imgEl.height,
          selectable: false,
          evented: false
        });
        img._isBlurPreview = true;
        canvas.add(img);
        previewObjects.push(img);
        canvas.renderAll();
      };
      imgEl.src = dataURL;
    }

    function finalizeBrushStroke() {
      if (points.length === 0 || previewObjects.length === 0) return;

      var size = getBrushSize();

      // Compute bounding box of all brush points, expanded by brush radius
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < points.length; i++) {
        if (points[i].x - size / 2 < minX) minX = points[i].x - size / 2;
        if (points[i].y - size / 2 < minY) minY = points[i].y - size / 2;
        if (points[i].x + size / 2 > maxX) maxX = points[i].x + size / 2;
        if (points[i].y + size / 2 > maxY) maxY = points[i].y + size / 2;
      }

      // Clamp to canvas bounds
      minX = Math.max(0, Math.floor(minX));
      minY = Math.max(0, Math.floor(minY));
      maxX = Math.min(canvas.width, Math.ceil(maxX));
      maxY = Math.min(canvas.height, Math.ceil(maxY));

      var bbW = maxX - minX;
      var bbH = maxY - minY;
      if (bbW < 1 || bbH < 1) return;

      // Create full mosaic of bounding box region
      var mosaicURL = ToolUtils.createMosaicImage(canvas, minX, minY, bbW, bbH, 8);
      if (!mosaicURL) return;

      // Create a clip mask from the brush path
      // Build a canvas to draw the brush stroke as a white mask on black
      var maskCanvas = document.createElement('canvas');
      maskCanvas.width = bbW;
      maskCanvas.height = bbH;
      var maskCtx = maskCanvas.getContext('2d');
      maskCtx.fillStyle = 'black';
      maskCtx.fillRect(0, 0, bbW, bbH);

      // Draw white circles at each brush point
      maskCtx.fillStyle = 'white';
      var radius = size / 2;
      for (var j = 0; j < points.length; j++) {
        maskCtx.beginPath();
        maskCtx.arc(points[j].x - minX, points[j].y - minY, radius, 0, Math.PI * 2);
        maskCtx.fill();
      }

      // Also connect consecutive points with thick lines for smooth coverage
      if (points.length > 1) {
        maskCtx.strokeStyle = 'white';
        maskCtx.lineWidth = size;
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';
        maskCtx.beginPath();
        maskCtx.moveTo(points[0].x - minX, points[0].y - minY);
        for (var k = 1; k < points.length; k++) {
          maskCtx.lineTo(points[k].x - minX, points[k].y - minY);
        }
        maskCtx.stroke();
      }

      // Composite: apply mask to mosaic image
      var compositeCanvas = document.createElement('canvas');
      compositeCanvas.width = bbW;
      compositeCanvas.height = bbH;
      var compCtx = compositeCanvas.getContext('2d');

      var mosaicImg = new Image();
      mosaicImg.onload = function() {
        // Draw mosaic
        compCtx.drawImage(mosaicImg, 0, 0, bbW, bbH);

        // Apply mask using destination-in: keeps mosaic pixels only where mask is white
        compCtx.globalCompositeOperation = 'destination-in';
        compCtx.drawImage(maskCanvas, 0, 0);
        compCtx.globalCompositeOperation = 'source-over';

        var finalURL = compositeCanvas.toDataURL('image/png');

        // Remove all preview tiles
        for (var p = 0; p < previewObjects.length; p++) {
          canvas.remove(previewObjects[p]);
        }
        previewObjects = [];

        // Add final composited image as a single object
        var finalImg = new Image();
        finalImg.onload = function() {
          var fabricImg = new fabric.FabricImage(finalImg, {
            left: minX,
            top: minY,
            originX: 'left',
            originY: 'top',
            scaleX: bbW / finalImg.width,
            scaleY: bbH / finalImg.height,
            selectable: true,
            evented: true
          });
          canvas.add(fabricImg);
          canvas.setActiveObject(fabricImg);
          canvas.renderAll();
        };
        finalImg.src = finalURL;
      };
      mosaicImg.src = mosaicURL;
    }

    function updateCursor(e) {
      var pt = ToolUtils.clampedScenePoint(canvas, e);
      var size = getBrushSize();
      if (!cursorCircle) {
        cursorCircle = new fabric.Circle({
          radius: size / 2,
          left: pt.x,
          top: pt.y,
          originX: 'center',
          originY: 'center',
          fill: 'transparent',
          stroke: ToolUtils.hexToRgba(ToolUtils.getAccentColor(), 0.6),
          strokeWidth: 1.5,
          selectable: false,
          evented: false,
          excludeFromExport: true
        });
        cursorCircle._isBrushCursor = true;
        canvas.add(cursorCircle);
      } else {
        cursorCircle.set({ left: pt.x, top: pt.y, radius: size / 2 });
      }
      canvas.renderAll();
    }

    function removeCursor() {
      if (cursorCircle) {
        canvas.remove(cursorCircle);
        cursorCircle = null;
      }
    }

    function onMouseDown(opt) {
      if (opt.target && !opt.target._isBrushCursor) return;
      isDrawing = true;
      points = [];
      previewObjects = [];
      var pt = ToolUtils.clampedScenePoint(canvas, opt.e);
      points.push(pt);
      addMosaicTile(pt);
    }

    function onMouseMove(opt) {
      updateCursor(opt.e);
      if (!isDrawing) return;
      var pt = ToolUtils.clampedScenePoint(canvas, opt.e);
      // Only add point if moved enough (avoid excessive tiles)
      var last = points[points.length - 1];
      var dist = Math.sqrt((pt.x - last.x) * (pt.x - last.x) + (pt.y - last.y) * (pt.y - last.y));
      var size = getBrushSize();
      if (dist >= size * 0.3) {
        points.push(pt);
        addMosaicTile(pt);
      }
    }

    function onMouseUp() {
      if (!isDrawing) return;
      isDrawing = false;
      finalizeBrushStroke();
      points = [];
    }

    return {
      activate() {
        canvas.on('mouse:down', onMouseDown);
        canvas.on('mouse:move', onMouseMove);
        canvas.on('mouse:up', onMouseUp);
        canvas.selection = false;
        canvas.defaultCursor = 'none';
        canvas.discardActiveObject();
        canvas.renderAll();
      },
      deactivate() {
        canvas.off('mouse:down', onMouseDown);
        canvas.off('mouse:move', onMouseMove);
        canvas.off('mouse:up', onMouseUp);
        // Clean up any in-progress drawing
        if (isDrawing) {
          for (var p = 0; p < previewObjects.length; p++) {
            canvas.remove(previewObjects[p]);
          }
          previewObjects = [];
          points = [];
          isDrawing = false;
        }
        removeCursor();
        canvas.selection = true;
        canvas.defaultCursor = 'default';
        canvas.renderAll();
      }
    };
  }

  return { attach };
})();
