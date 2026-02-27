/* global fabric, ToolUtils */
/* exported EditorCanvasManager */

const EditorCanvasManager = (() => {
  let canvas = null;
  let physImageEl = null;
  let originalDataURL = null;
  let cssW = 0;
  let cssH = 0;
  let redoStack = [];
  let isRedoing = false;

  function initCanvas(cssWidth, cssHeight) {
    cssW = cssWidth;
    cssH = cssHeight;

    // Set accent-colored selection controls for all fabric objects
    var accent = ToolUtils.getAccentColor();
    fabric.FabricObject.ownDefaults.borderColor = accent;
    fabric.FabricObject.ownDefaults.cornerColor = accent;
    fabric.FabricObject.ownDefaults.cornerStrokeColor = accent;
    fabric.FabricObject.ownDefaults.transparentCorners = false;
    fabric.FabricObject.ownDefaults.cornerSize = 8;

    const canvasEl = document.getElementById('annotation-canvas');
    canvas = new fabric.Canvas(canvasEl, {
      width: cssWidth,
      height: cssHeight,
      selection: true,
      preserveObjectStacking: true,
      enableRetinaScaling: true,
      uniformScaling: false
    });

    // Clear redo stack when a new annotation is drawn (not from redo)
    canvas.on('object:added', function() {
      if (!isRedoing) {
        redoStack = [];
      }
    });

    return canvas;
  }

  function setBackgroundImage(dataURL, cssWidth, cssHeight) {
    // Store original on first call only (for reset)
    if (!originalDataURL) {
      originalDataURL = dataURL;
    }
    applyBackground(dataURL, cssWidth, cssHeight);
  }

  function replaceBackground(dataURL) {
    // Replace background without updating originalDataURL
    applyBackground(dataURL, cssW, cssH);
  }

  function applyBackground(dataURL, w, h) {
    var bgImgEl = document.getElementById('background-image');
    bgImgEl.src = dataURL;
    bgImgEl.style.width = w + 'px';
    bgImgEl.style.height = h + 'px';

    physImageEl = new Image();
    physImageEl.src = dataURL;
    canvas._bgOriginalImg = physImageEl;
  }

  function resetToOriginal() {
    if (originalDataURL) {
      applyBackground(originalDataURL, cssW, cssH);
    }
    redoStack = [];
    clearAnnotations();
  }

  function exportAsDataURL(format, quality) {
    format = format || 'jpeg';
    quality = quality || 0.92;

    var dpr = window.devicePixelRatio || 1;
    var exportW = Math.round(cssW * dpr);
    var exportH = Math.round(cssH * dpr);

    var exportCanvas = document.createElement('canvas');
    exportCanvas.width = exportW;
    exportCanvas.height = exportH;
    var ctx = exportCanvas.getContext('2d');

    // Layer 1: background image at physical resolution
    if (physImageEl) {
      ctx.drawImage(physImageEl, 0, 0, exportW, exportH);
    }

    // Layer 2: Fabric annotations at matching resolution
    var fabricExport = canvas.toCanvasElement(dpr);
    ctx.drawImage(fabricExport, 0, 0, exportW, exportH);

    return exportCanvas.toDataURL('image/' + format, quality);
  }

  function clearAnnotations() {
    if (!canvas) return;
    canvas.getObjects().forEach(function(obj) {
      canvas.remove(obj);
    });
    redoStack = [];
    canvas.renderAll();
  }

  function removeLastObject() {
    if (!canvas) return;
    var objects = canvas.getObjects();
    if (objects.length > 0) {
      var removed = objects[objects.length - 1];
      canvas.remove(removed);
      redoStack.push(removed);
      canvas.renderAll();
    }
  }

  function redoLastObject() {
    if (!canvas || redoStack.length === 0) return;
    isRedoing = true;
    var obj = redoStack.pop();
    canvas.add(obj);
    canvas.renderAll();
    isRedoing = false;
  }

  function getCanvas() { return canvas; }

  function getBackgroundDataURL() {
    return physImageEl ? physImageEl.src : null;
  }

  return { initCanvas, setBackgroundImage, replaceBackground, resetToOriginal, exportAsDataURL, clearAnnotations, removeLastObject, redoLastObject, getCanvas, getBackgroundDataURL };
})();
