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

  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(r); }); }

  // --- HTML format renderer ---
  // Uses a sandboxed srcdoc iframe so full HTML documents (with <body> styles,
  // DOCTYPE, etc.) render correctly without affecting the Mermaid host page.
  async function renderHtml(code) {
    var overlay = document.getElementById('html-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'html-overlay';
      overlay.style.cssText = 'position:absolute;top:0;left:0;';
      document.body.appendChild(overlay);
    }
    var diagramContainer = document.getElementById('diagram-container');
    if (diagramContainer) diagramContainer.style.display = 'none';

    // Wrap fragments in a minimal document; pass full documents through unchanged
    var isFullDoc = /^\s*<!doctype|^\s*<html/i.test(code);
    var htmlDoc = isFullDoc
      ? code
      : '<!DOCTYPE html><html><head><style>*{margin:0;padding:0;}body{display:inline-block;padding:24px;}</style></head><body>' + code + '</body></html>';

    // Clean up previous iframe to abort any pending resource loads
    var existing = overlay.querySelector('iframe');
    if (existing) { existing.srcdoc = ''; existing.src = 'about:blank'; }
    overlay.innerHTML = '';

    // Create sandboxed iframe — allow-same-origin for measurement, no allow-scripts
    var iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-same-origin';
    // Start wide so content lays out without wrapping; height 1px so scrollHeight
    // reflects actual content height, not iframe height
    iframe.style.cssText = 'border:none;overflow:visible;display:block;width:4096px;height:1px;';
    iframe.srcdoc = htmlDoc;

    await new Promise(function (resolve) {
      iframe.onload = resolve;
      overlay.appendChild(iframe);
    });

    // Wait for fonts + images inside iframe, with 500ms ceiling
    var iframeDoc = iframe.contentDocument;
    var imgs = Array.from(iframeDoc.querySelectorAll('img'));
    var fontReady = iframeDoc.fonts ? iframeDoc.fonts.ready : Promise.resolve();
    var imgReady = imgs.length
      ? Promise.all(imgs.map(function (img) {
          if (img.complete) return Promise.resolve();
          return new Promise(function (r) { img.onload = img.onerror = r; });
        }))
      : Promise.resolve();
    await Promise.race([
      Promise.all([fontReady, imgReady]),
      new Promise(function (r) { setTimeout(r, 500); })
    ]);
    await nextFrame();

    // Measure natural content dimensions at 1x
    // Step 1: shrink-wrap body to get intrinsic content width
    var origBodyWidth = iframeDoc.body.style.width;
    iframeDoc.body.style.width = 'fit-content';
    await nextFrame();
    var bodyRect = iframeDoc.body.getBoundingClientRect();
    var naturalW = Math.ceil(bodyRect.width);
    var naturalH = Math.ceil(bodyRect.height);
    iframeDoc.body.style.width = origBodyWidth;

    // Step 2: resize iframe to measured width and re-check for overflow
    // This catches cases where body has explicit CSS width (e.g. width:900px)
    // that fit-content doesn't fully account for with padding
    iframe.style.width = naturalW + 'px';
    await nextFrame();
    var overflowW = Math.ceil(Math.max(iframeDoc.documentElement.scrollWidth, iframeDoc.body.scrollWidth));
    var overflowH = Math.ceil(Math.max(iframeDoc.documentElement.scrollHeight, iframeDoc.body.scrollHeight));
    if (overflowW > naturalW) naturalW = overflowW;
    if (overflowH > naturalH) naturalH = overflowH;
    naturalW = Math.min(Math.max(naturalW, 100), 4096);
    naturalH = Math.min(Math.max(naturalH, 100), 4096);

    // Resize iframe to fit content exactly
    iframe.style.overflow = 'hidden';
    iframe.style.width = naturalW + 'px';
    iframe.style.height = naturalH + 'px';
    await nextFrame();

    window.snip.diagramRendered({
      success: true,
      width: naturalW,
      height: naturalH
    });
  }

  // --- Mermaid format renderer ---
  async function renderMermaid(code) {
    // Clean up any HTML overlay from a previous render
    var overlay = document.getElementById('html-overlay');
    if (overlay) overlay.innerHTML = '';

    var container = document.getElementById('diagram-container');
    container.style.display = '';
    container.innerHTML = '';
    renderCount++;

    var result = await mermaid.render('snip-diagram-' + renderCount, code);
    container.innerHTML = result.svg;

    var svg = container.querySelector('svg');
    if (svg) {
      svg.style.maxWidth = 'none';
    }

    await nextFrame();

    // Measure natural size, then scale 2x for crisp text
    // (hidden windows capture at 1x DPR regardless of display)
    var svgRect = svg ? svg.getBoundingClientRect() : container.getBoundingClientRect();
    var naturalW = Math.ceil(svgRect.width);
    var naturalH = Math.ceil(svgRect.height);

    if (svg) {
      svg.style.width = (naturalW * 2) + 'px';
      svg.style.height = (naturalH * 2) + 'px';
    }

    await nextFrame();

    var containerRect = container.getBoundingClientRect();

    window.snip.diagramRendered({
      success: true,
      width: Math.ceil(containerRect.width),
      height: Math.ceil(containerRect.height)
    });
  }

  // --- Dispatch by format ---
  window.snip.onDiagramCode(async function (data) {
    try {
      if (data.format === 'html') {
        await renderHtml(data.code);
      } else {
        await renderMermaid(data.code);
      }
    } catch (err) {
      // Normalize error — don't leak internal V8/Electron paths to MCP callers
      var safeMsg = (data.format === 'mermaid')
        ? (err.message || 'Mermaid render failed')
        : 'HTML render failed';
      window.snip.diagramRendered({
        success: false,
        error: safeMsg
      });
    }
  });
})();
