/* exported ExtensionLoader */

/**
 * Extension Loader — generates toolbar buttons from extension manifests.
 * The manifest list is received from the main process via IPC (already sorted by toolbarPosition).
 */
var ExtensionLoader = (function () {
  var _extensions = [];

  var SVG_ALLOWED_ELEMENTS = ['svg','path','circle','rect','line','polyline','polygon','g','defs','clipPath','ellipse'];
  var SVG_ALLOWED_ATTRS = ['viewbox','width','height','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','d','cx','cy','r','x','y','x1','y1','x2','y2','points','transform','rx','ry','id','clip-path','opacity','fill-opacity','stroke-opacity','fill-rule','clip-rule'];

  /**
   * Sanitize SVG icon using a DOM whitelist approach.
   * Only allows known-safe elements and attributes. Strips everything else.
   */
  function sanitizeSvgIcon(svgString) {
    if (!svgString || !svgString.trimStart().startsWith('<svg')) return '';
    try {
      var parser = new DOMParser();
      var doc = parser.parseFromString(svgString, 'image/svg+xml');
      var svg = doc.querySelector('svg');
      if (!svg) return '';

      function cleanNode(node) {
        var children = Array.from(node.children);
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (!SVG_ALLOWED_ELEMENTS.includes(child.tagName.toLowerCase())) {
            child.remove();
          } else {
            var attrs = Array.from(child.attributes);
            for (var j = 0; j < attrs.length; j++) {
              if (!SVG_ALLOWED_ATTRS.includes(attrs[j].name.toLowerCase())) {
                child.removeAttribute(attrs[j].name);
              }
            }
            cleanNode(child);
          }
        }
      }

      // Clean svg root attributes too
      var svgAttrs = Array.from(svg.attributes);
      for (var k = 0; k < svgAttrs.length; k++) {
        if (!SVG_ALLOWED_ATTRS.includes(svgAttrs[k].name.toLowerCase()) && svgAttrs[k].name !== 'xmlns') {
          svg.removeAttribute(svgAttrs[k].name);
        }
      }
      cleanNode(svg);
      return svg.outerHTML;
    } catch {
      return '';
    }
  }

  /**
   * Get the DOM button ID for an extension.
   * Uses manifest `buttonId` if provided, otherwise `tool-{toolId}`.
   */
  function getButtonId(ext) {
    return ext.buttonId || ('tool-' + ext.toolId);
  }

  /**
   * Build toolbar buttons from an array of extension manifests.
   * Data arrives pre-sorted by toolbarPosition from the registry.
   */
  function buildToolbar(extensions) {
    _extensions = extensions || [];
    var container = document.getElementById('toolbar-tools');
    if (!container) return;

    // Inject renderer scripts for self-contained extensions (path inside extensions/)
    _extensions.forEach(function (ext) {
      if (!ext.renderer) return;
      // Only dynamically inject scripts from extensions/ (not built-in tools/ scripts)
      if (!ext.renderer.startsWith('../extensions/')) return;
      var script = document.createElement('script');
      script.src = ext.renderer;
      document.head.appendChild(script);
    });

    var frag = document.createDocumentFragment();

    _extensions.forEach(function (ext) {
      // Skip processors and tools without a toolId
      if (ext.type === 'processor' || !ext.toolId) return;

      var btn = document.createElement('button');
      btn.id = getButtonId(ext);
      btn.className = 'tool-btn' + (ext.hidden ? ' hidden' : '') + (ext.toolId === 'select' ? ' active' : '');
      btn.setAttribute('data-tooltip', ext.tooltip || ext.displayName);
      var sanitizedIcon = sanitizeSvgIcon(ext.icon);
      if (sanitizedIcon) {
        btn.innerHTML = sanitizedIcon;
      } else {
        btn.textContent = ext.icon || '';
      }
      frag.appendChild(btn);
    });

    container.appendChild(frag);
  }

  /**
   * Return the loaded extensions list.
   */
  function getExtensions() {
    return _extensions;
  }

  /**
   * Build the TOOLS constant from loaded extensions.
   * Returns object like { SELECT: 'select', RECT: 'rect', ... }
   */
  function buildToolsEnum() {
    var tools = {};
    _extensions.forEach(function (ext) {
      if (!ext.toolId) return;
      if (ext.type === 'canvas-tool' || ext.type === 'ai-tool') {
        var key = ext.toolId.toUpperCase().replace(/-/g, '_');
        tools[key] = ext.toolId;
      }
    });
    return tools;
  }

  /**
   * Build shortcut-to-tool map from extension manifests.
   */
  function buildShortcutMap() {
    var map = {};
    _extensions.forEach(function (ext) {
      if (!ext.shortcut || !ext.toolId) return;
      if (ext.type === 'canvas-tool' || ext.type === 'ai-tool') {
        map[ext.shortcut.toLowerCase()] = ext.toolId;
      }
    });
    return map;
  }

  /**
   * Build action shortcut map (shortcuts that click a button rather than switch tool mode).
   */
  function buildActionShortcutMap() {
    var map = {};
    _extensions.forEach(function (ext) {
      if (!ext.shortcut || !ext.toolId) return;
      if (ext.type === 'action-tool') {
        map[ext.shortcut.toLowerCase()] = getButtonId(ext);
      }
    });
    return map;
  }

  /**
   * Get toolbar groups for a given toolId.
   */
  function getToolbarGroups(toolId) {
    for (var i = 0; i < _extensions.length; i++) {
      if (_extensions[i].toolId === toolId) {
        return _extensions[i].toolbarGroups || [];
      }
    }
    return [];
  }

  return {
    buildToolbar: buildToolbar,
    getExtensions: getExtensions,
    buildToolsEnum: buildToolsEnum,
    buildShortcutMap: buildShortcutMap,
    buildActionShortcutMap: buildActionShortcutMap,
    getToolbarGroups: getToolbarGroups
  };
})();
