/* global mermaid */
(function () {
  'use strict';

  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    flowchart: { htmlLabels: false }
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
      var naturalW = Math.ceil(rect.width);
      var naturalH = Math.ceil(rect.height);

      // Scale SVG to 2x for crisp text — SVG is vector so browser re-rasterizes
      svg.style.width = (naturalW * 2) + 'px';
      svg.style.height = (naturalH * 2) + 'px';
      svg.style.maxWidth = 'none';

      // Wait for re-layout at 2x size
      await new Promise(function (r) { requestAnimationFrame(r); });

      // Report 2x dimensions + container padding (24px × 2 sides = 48px)
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
