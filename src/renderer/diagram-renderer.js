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

      var svg = container.querySelector('svg');
      var rect = svg.getBoundingClientRect();
      var naturalW = Math.ceil(rect.width);
      var naturalH = Math.ceil(rect.height);

      // Scale SVG to 2x for crisp text on Retina
      svg.style.width = (naturalW * 2) + 'px';
      svg.style.height = (naturalH * 2) + 'px';
      svg.style.maxWidth = 'none';

      await new Promise(function (r) { requestAnimationFrame(r); });

      window.snip.diagramRendered({
        success: true,
        width: naturalW * 2 + 48,
        height: naturalH * 2 + 48
      });
    } catch (err) {
      window.snip.diagramRendered({
        success: false,
        error: err.message || String(err)
      });
    }
  });
})();
