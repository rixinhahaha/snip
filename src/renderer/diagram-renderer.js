/* global mermaid */
(function () {
  'use strict';

  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    flowchart: { htmlLabels: false }
  });

  var renderCount = 0;
  window.snip.onDiagramCode(async function (data) {
    var container = document.getElementById('diagram-container');
    container.innerHTML = '';
    renderCount++;
    try {
      var result = await mermaid.render('snip-diagram-' + renderCount, data.code);
      container.innerHTML = result.svg;

      await new Promise(function (r) { requestAnimationFrame(r); });

      // Measure container (includes 24px padding on each side)
      var containerRect = container.getBoundingClientRect();

      window.snip.diagramRendered({
        success: true,
        width: Math.ceil(containerRect.width),
        height: Math.ceil(containerRect.height)
      });
    } catch (err) {
      window.snip.diagramRendered({
        success: false,
        error: err.message || String(err)
      });
    }
  });
})();
