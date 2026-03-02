/* global fabric, ToolUtils */
/* exported TagTool */

var TagTool = (function() {
  var TIP_RADIUS = 4;
  var BUBBLE_RX = 6;
  var BUBBLE_PADDING = 8;
  var BUBBLE_MIN_WIDTH = 100;
  var LINE_WIDTH = 2;
  var MIN_DISTANCE = 20;

  /**
   * Resize textbox, bubble, and leader line as user types.
   * Used during both initial creation and double-click re-editing.
   */
  function resizeTagParts(canvas, textbox, bubble, line) {
    var minTextWidth = BUBBLE_MIN_WIDTH - BUBBLE_PADDING * 2;
    var measured = ToolUtils.measureTextWidth(textbox.text, textbox.fontSize, textbox.fontFamily);
    var newTextWidth = Math.max(minTextWidth, measured + 4);
    if (Math.abs(newTextWidth - textbox.width) > 2) {
      textbox.set('width', newTextWidth);
    }
    var bubbleWidth = Math.max(BUBBLE_MIN_WIDTH, textbox.width + BUBBLE_PADDING * 2);
    var bubbleHeight = textbox.height + BUBBLE_PADDING * 2;
    bubble.set({
      width: bubbleWidth,
      height: bubbleHeight,
      left: textbox.left - BUBBLE_PADDING,
      top: textbox.top - BUBBLE_PADDING
    });
    if (line) {
      line.set({
        x2: bubble.left,
        y2: bubble.top + bubble.height / 2
      });
    }
    canvas.renderAll();
  }

  /**
   * Ungroup a tag label group for editing, enter textbox editing, regroup on exit.
   * The label group contains only bubble (rect) + textbox.
   * Linked tip and line remain on canvas as separate objects.
   */
  function enterTagEditing(canvas, group) {
    var tagId = group._snipTagId;
    var tagColor = group._snipTagColor;

    var items = group.removeAll();
    canvas.remove(group);

    var textbox = null;
    var bubbleRect = null;
    for (var i = 0; i < items.length; i++) {
      canvas.add(items[i]);
      if (items[i].type === 'textbox') {
        textbox = items[i];
        items[i].set({ selectable: true, evented: true, editable: true });
      } else {
        if (items[i].type === 'rect') bubbleRect = items[i];
        items[i].set({ selectable: false, evented: false });
      }
    }

    if (!textbox) return;

    // Find linked line on canvas for live resize updates
    var tagLine = null;
    if (tagId) {
      canvas.getObjects().forEach(function(obj) {
        if (obj._snipTagId === tagId && obj._snipTagRole === 'line') tagLine = obj;
      });
    }

    // Live-resize bubble as user types
    var onChanged = function() {
      resizeTagParts(canvas, textbox, bubbleRect, tagLine);
    };
    textbox.on('changed', onChanged);

    canvas.setActiveObject(textbox);
    textbox.enterEditing();
    textbox.selectAll();
    canvas.renderAll();

    var onExitEditing = function() {
      textbox.off('editing:exited', onExitEditing);
      textbox.off('changed', onChanged);

      // Final auto-size bubble to fit text
      resizeTagParts(canvas, textbox, bubbleRect, tagLine);

      // Remove bubble + textbox from canvas, regroup as label group
      for (var m = 0; m < items.length; m++) {
        canvas.remove(items[m]);
      }

      var newGroup = new fabric.Group(items, {
        selectable: true,
        evented: true,
        subTargetCheck: true,
        lockRotation: true,
        hasControls: false
      });
      newGroup._snipTagType = true;
      newGroup._snipTagId = tagId;
      if (tagColor) newGroup._snipTagColor = tagColor;
      // Preserve tag color from the bubble fill if not set
      if (!tagColor && bubbleRect) {
        newGroup._snipTagColor = bubbleRect.fill;
      }
      canvas.add(newGroup);

      // Update line endpoint to match new label group position
      if (tagLine && tagId) {
        var tipObj = null;
        canvas.getObjects().forEach(function(obj) {
          if (obj._snipTagId === tagId && obj._snipTagRole === 'tip') tipObj = obj;
        });
        if (tipObj) {
          var bounds = newGroup.getBoundingRect();
          var endpoint = ToolUtils.lineEndpointForTag(tipObj.left, tipObj.top, bounds);
          tagLine.set({ x2: endpoint.x, y2: endpoint.y });
          tagLine.setCoords();
        }
      }

      canvas.setActiveObject(newGroup);
      canvas.renderAll();
    };

    textbox.on('editing:exited', onExitEditing);
  }

  function attach(canvas, getTagColor, getFont, getFontSize) {
    var state = 'idle';
    var tipX, tipY;
    var previewTip = null;
    var previewLine = null;
    var previewBubble = null;

    function removePreviewObjects() {
      if (previewTip) { canvas.remove(previewTip); previewTip = null; }
      if (previewLine) { canvas.remove(previewLine); previewLine = null; }
      if (previewBubble) { canvas.remove(previewBubble); previewBubble = null; }
    }

    function createPreviewObjects(x, y, color) {
      previewTip = new fabric.Circle({
        left: x,
        top: y,
        radius: TIP_RADIUS,
        fill: color,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        opacity: 0.7
      });

      previewLine = new fabric.Line([x, y, x, y], {
        stroke: color,
        strokeWidth: LINE_WIDTH,
        strokeDashArray: [4, 4],
        selectable: false,
        evented: false,
        opacity: 0.5
      });

      previewBubble = new fabric.Rect({
        left: x,
        top: y - 20,
        width: BUBBLE_MIN_WIDTH,
        height: 40,
        rx: BUBBLE_RX,
        ry: BUBBLE_RX,
        fill: ToolUtils.hexToRgba(color, 0.6),
        stroke: color,
        strokeWidth: 1,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
        opacity: 0.5
      });

      canvas.add(previewTip);
      canvas.add(previewLine);
      canvas.add(previewBubble);
    }

    function createTag(tx, ty, bx, by, color, font, fontSize) {
      var tip = new fabric.Circle({
        left: tx,
        top: ty,
        radius: TIP_RADIUS,
        fill: color,
        stroke: color,
        strokeWidth: 1,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false
      });

      var bubbleHeight = fontSize + BUBBLE_PADDING * 2;

      var line = new fabric.Line([tx, ty, bx, by], {
        stroke: color,
        strokeWidth: LINE_WIDTH,
        selectable: false,
        evented: false
      });

      var bubble = new fabric.Rect({
        left: bx,
        top: by - bubbleHeight / 2,
        width: BUBBLE_MIN_WIDTH,
        height: bubbleHeight,
        rx: BUBBLE_RX,
        ry: BUBBLE_RX,
        fill: color,
        stroke: color,
        strokeWidth: 1,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false
      });

      var textbox = new fabric.Textbox('Label', {
        left: bx + BUBBLE_PADDING,
        top: by - fontSize / 2,
        width: BUBBLE_MIN_WIDTH - BUBBLE_PADDING * 2,
        fontSize: fontSize,
        fontFamily: font,
        fill: '#FFFFFF',
        editable: true,
        cursorColor: '#FFFFFF',
        padding: 2,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false
      });

      return { tip: tip, line: line, bubble: bubble, textbox: textbox };
    }

    function onMouseDown(opt) {
      if (opt.target) return;

      var pointer = ToolUtils.clampedScenePoint(canvas, opt.e);

      if (state === 'idle') {
        tipX = pointer.x;
        tipY = pointer.y;
        state = 'tip_placed';
        createPreviewObjects(tipX, tipY, getTagColor());
        canvas.renderAll();

      } else if (state === 'tip_placed') {
        var bx = pointer.x;
        var by = pointer.y;

        removePreviewObjects();

        var dist = Math.sqrt(Math.pow(bx - tipX, 2) + Math.pow(by - tipY, 2));
        if (dist < MIN_DISTANCE) {
          state = 'idle';
          canvas.renderAll();
          return;
        }

        var color = getTagColor();
        var font = getFont();
        var fontSize = getFontSize();
        var parts = createTag(tipX, tipY, bx, by, color, font, fontSize);

        // Add objects individually for initial text editing
        var allItems = [parts.tip, parts.line, parts.bubble, parts.textbox];
        for (var i = 0; i < allItems.length; i++) {
          canvas.add(allItems[i]);
        }

        // Live-resize bubble as user types during initial creation
        var onChanged = function() {
          resizeTagParts(canvas, parts.textbox, parts.bubble, parts.line);
        };
        parts.textbox.on('changed', onChanged);

        // Make textbox editable and enter editing
        parts.textbox.set({ selectable: true, evented: true, editable: true });
        canvas.setActiveObject(parts.textbox);
        parts.textbox.enterEditing();
        parts.textbox.selectAll();
        canvas.renderAll();

        // On editing exit, create linked objects (label group + separate tip/line)
        var onExitEditing = function() {
          parts.textbox.off('editing:exited', onExitEditing);
          parts.textbox.off('changed', onChanged);

          // Final auto-size bubble to fit text
          resizeTagParts(canvas, parts.textbox, parts.bubble, parts.line);

          // Remove all from canvas
          for (var j = 0; j < allItems.length; j++) {
            canvas.remove(allItems[j]);
          }

          // Generate unique tag ID for linkage
          var tagId = ToolUtils.nextTagId();

          // Create label group (bubble + textbox only) — movable
          var labelGroup = new fabric.Group([parts.bubble, parts.textbox], {
            selectable: true,
            evented: true,
            subTargetCheck: true,
            lockRotation: true,
            hasControls: false
          });
          labelGroup._snipTagType = true;
          labelGroup._snipTagColor = color;
          labelGroup._snipTagId = tagId;

          // Mark tip and line as linked non-interactive parts
          parts.tip._snipTagId = tagId;
          parts.tip._snipTagRole = 'tip';
          parts.line._snipTagId = tagId;
          parts.line._snipTagRole = 'line';

          // Add in z-order: tip (bottom), line, label group (top)
          canvas.add(parts.tip);
          canvas.add(parts.line);
          canvas.add(labelGroup);

          // Update line endpoint to connect to label group edge
          var bounds = labelGroup.getBoundingRect();
          var endpoint = ToolUtils.lineEndpointForTag(parts.tip.left, parts.tip.top, bounds);
          parts.line.set({ x2: endpoint.x, y2: endpoint.y });
          parts.line.setCoords();

          canvas.setActiveObject(labelGroup);
          canvas.renderAll();
        };

        parts.textbox.on('editing:exited', onExitEditing);
        state = 'idle';
      }
    }

    function onMouseMove(opt) {
      if (state !== 'tip_placed') return;
      var pointer = ToolUtils.clampedScenePoint(canvas, opt.e);

      if (previewLine) {
        previewLine.set({ x2: pointer.x, y2: pointer.y });
      }
      if (previewBubble) {
        previewBubble.set({
          left: pointer.x,
          top: pointer.y - 20
        });
      }
      canvas.renderAll();
    }

    function onKeyDown(e) {
      if (state === 'tip_placed' && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        removePreviewObjects();
        state = 'idle';
        canvas.renderAll();
      }
    }

    return {
      activate: function() {
        canvas.on('mouse:down', onMouseDown);
        canvas.on('mouse:move', onMouseMove);
        document.addEventListener('keydown', onKeyDown, true);
        canvas.selection = false;
        canvas.defaultCursor = 'crosshair';
        canvas.discardActiveObject();
        canvas.renderAll();
      },
      deactivate: function() {
        canvas.off('mouse:down', onMouseDown);
        canvas.off('mouse:move', onMouseMove);
        document.removeEventListener('keydown', onKeyDown, true);
        canvas.selection = true;
        canvas.defaultCursor = 'default';
        if (state === 'tip_placed') {
          removePreviewObjects();
          state = 'idle';
        }
        canvas.renderAll();
      }
    };
  }

  return { attach: attach, enterTagEditing: enterTagEditing };
})();
