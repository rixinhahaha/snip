/* global mermaid */
(function () {
  'use strict';

  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    flowchart: { htmlLabels: true }
  });

  window.snip.onDiagramCode(async function (data) {
    var container = document.getElementById('diagram-container');
    try {
      var result = await mermaid.render('snip-diagram', data.code);
      container.innerHTML = result.svg;

      // Wait for layout to complete before measuring
      await new Promise(function (r) { requestAnimationFrame(r); });

      var svg = container.querySelector('svg');
      var rect = svg.getBoundingClientRect();

      window.snip.diagramRendered({
        success: true,
        width: Math.ceil(rect.width) + 48,  // +48 = 24px padding × 2 sides
        height: Math.ceil(rect.height) + 48
      });
    } catch (err) {
      window.snip.diagramRendered({
        success: false,
        error: err.message || String(err)
      });
    }
  });
})();
