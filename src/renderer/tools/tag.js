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
   * Ungroup a tag group for editing, enter textbox editing, regroup on exit.
   * Used both by the tool (initial creation) and globally (double-click edit).
   */
  function enterTagEditing(canvas, group) {
    var items = group.removeAll();
    canvas.remove(group);

    var textbox = null;
    for (var i = 0; i < items.length; i++) {
      canvas.add(items[i]);
      if (items[i].type === 'textbox') {
        textbox = items[i];
        items[i].set({ selectable: true, evented: true, editable: true });
      } else {
        items[i].set({ selectable: false, evented: false });
      }
    }

    if (!textbox) return;

    // Find sibling parts for live resizing
    var bubbleRect = null;
    var leaderLine = null;
    for (var k = 0; k < items.length; k++) {
      if (items[k].type === 'rect') bubbleRect = items[k];
      else if (items[k].type === 'line') leaderLine = items[k];
    }

    // Live-resize bubble as user types
    var onChanged = function() {
      resizeTagParts(canvas, textbox, bubbleRect, leaderLine);
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
      resizeTagParts(canvas, textbox, bubbleRect, leaderLine);

      // Remove all from canvas, regroup
      for (var m = 0; m < items.length; m++) {
        canvas.remove(items[m]);
      }

      var newGroup = new fabric.Group(items, {
        selectable: true,
        evented: true,
        subTargetCheck: true
      });
      newGroup._snipTagType = true;
      // Preserve tag color from the bubble fill
      var bubbleObj = null;
      for (var n = 0; n < items.length; n++) {
        if (items[n].type === 'rect') { bubbleObj = items[n]; break; }
      }
      if (bubbleObj) newGroup._snipTagColor = bubbleObj.fill;
      canvas.add(newGroup);
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
        var items = [parts.tip, parts.line, parts.bubble, parts.textbox];
        for (var i = 0; i < items.length; i++) {
          canvas.add(items[i]);
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

        // On editing exit, final auto-size and group everything
        var onExitEditing = function() {
          parts.textbox.off('editing:exited', onExitEditing);
          parts.textbox.off('changed', onChanged);

          // Final auto-size bubble to fit text
          resizeTagParts(canvas, parts.textbox, parts.bubble, parts.line);

          // Remove all from canvas, group them
          for (var j = 0; j < items.length; j++) {
            canvas.remove(items[j]);
          }

          var group = new fabric.Group(items, {
            selectable: true,
            evented: true,
            subTargetCheck: true
          });
          group._snipTagType = true;
          group._snipTagColor = color;
          canvas.add(group);
          canvas.setActiveObject(group);
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
