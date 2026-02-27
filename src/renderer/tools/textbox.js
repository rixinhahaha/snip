/* global fabric, ToolUtils */
/* exported TextTool */

const TextTool = (() => {
  function attach(canvas, getColor, getFont, getFontSize) {
    function onMouseDown(opt) {
      if (opt.target && opt.target.type === 'textbox') return;
      // If a textbox is currently selected, deselect it instead of creating a new one
      var active = canvas.getActiveObject();
      if (active && active.type === 'textbox') {
        if (active.isEditing) active.exitEditing();
        canvas.discardActiveObject();
        canvas.renderAll();
        return;
      }
      const pointer = ToolUtils.clampedScenePoint(canvas, opt.e);

      const textbox = new fabric.Textbox('Type here', {
        left: pointer.x, top: pointer.y, width: 200,
        originX: 'left', originY: 'top',
        fontSize: getFontSize(), fontFamily: getFont(), fill: getColor(),
        editable: true, cursorColor: getColor(), padding: 5
      });

      canvas.add(textbox);
      canvas.setActiveObject(textbox);
      textbox.enterEditing();
      textbox.selectAll();
    }

    return {
      activate() {
        canvas.on('mouse:down', onMouseDown);
        canvas.selection = false;
        canvas.defaultCursor = 'text';
        canvas.discardActiveObject();
        canvas.renderAll();
      },
      deactivate() {
        canvas.off('mouse:down', onMouseDown);
        canvas.selection = true;
        canvas.defaultCursor = 'default';
        const active = canvas.getActiveObject();
        if (active && active.type === 'textbox' && active.isEditing) active.exitEditing();
        canvas.renderAll();
      }
    };
  }

  return { attach };
})();
