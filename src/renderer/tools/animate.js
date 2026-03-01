/* global ToolUtils */
/* exported AnimateTool */

var AnimateTool = (function() {
  'use strict';

  var cutoutData = null;
  var animationResult = null;
  var presets = [];
  var progressCleanup = null;

  function setCutoutData(data) {
    cutoutData = data;
    animationResult = null;
    // Clear cached presets when a new cutout is provided
    presets = [];
    presetsSource = null;
    // Only show the animate button if fal.ai API key is configured
    window.snip.checkAnimateSupport().then(function(result) {
      if (result && result.supported) {
        showAnimateButton();
      }
    }).catch(function() {
      // API key not configured — don't show the button
    });
  }

  function clearCutoutData() {
    cutoutData = null;
    animationResult = null;
    presets = [];
    presetsSource = null;
    hideAnimateButton();
    hidePresetPanel();
    hideResultPanel();
  }

  function showAnimateButton() {
    var btn = document.getElementById('animate-btn');
    if (btn) {
      btn.classList.remove('hidden');
      initBtnSparkles();
    }
  }

  function hideAnimateButton() {
    var btn = document.getElementById('animate-btn');
    if (btn) btn.classList.add('hidden');
    var container = document.querySelector('.animate-btn-sparks');
    if (container) container.innerHTML = '';
  }

  function initBtnSparkles() {
    var container = document.querySelector('.animate-btn-sparks');
    if (!container) return;
    container.innerHTML = '';
    var styles = ['', 'gold', 'accent', '', 'gold'];
    for (var i = 0; i < 5; i++) {
      var el = document.createElement('div');
      var style = styles[i];
      el.className = 'animate-btn-sparkle' + (style ? ' ' + style : '');
      container.appendChild(el);
    }
  }

  function showPresetPanel() {
    hideAnimateButton();
    var panel = document.getElementById('animate-presets');
    if (panel) panel.classList.remove('hidden');
  }

  function hidePresetPanel() {
    var panel = document.getElementById('animate-presets');
    if (panel) panel.classList.add('hidden');
  }

  function showResultPanel() {
    var panel = document.getElementById('animate-result');
    if (panel) panel.classList.remove('hidden');
  }

  function hideResultPanel() {
    var panel = document.getElementById('animate-result');
    if (panel) panel.classList.add('hidden');
    var preview = document.getElementById('animate-preview');
    if (preview) preview.src = '';
  }

  function redoAnimation() {
    hideResultPanel();
    animationResult = null;
    loadPresetsForCutout();
  }

  // ── Progress overlay with sparks ──
  var sparkInterval = null;

  function showProgress() {
    var overlay = document.getElementById('animate-progress');
    if (overlay) overlay.classList.remove('hidden');
    updateProgress({ message: 'Preparing…', pct: 0, status: 'INIT' });
    startSparks();
  }

  function hideProgress() {
    var overlay = document.getElementById('animate-progress');
    if (overlay) overlay.classList.add('hidden');
    stopSparks();
    var fill = document.getElementById('animate-progress-fill');
    if (fill) fill.style.width = '0%';
  }

  function updateProgress(progress) {
    var fill = document.getElementById('animate-progress-fill');
    var count = document.getElementById('animate-progress-count');
    var text = document.getElementById('animate-progress-text');

    var pct = progress.pct || 0;

    if (fill) fill.style.width = pct + '%';
    if (count) count.textContent = pct + '%';
    if (text) text.textContent = progress.message || 'Working…';
  }

  function spawnSpark() {
    var container = document.getElementById('animate-sparks');
    if (!container) return;
    var spark = document.createElement('div');
    var angle = Math.random() * Math.PI * 2;
    var distance = 40 + Math.random() * 60;
    var dx = Math.cos(angle) * distance;
    var dy = Math.sin(angle) * distance;
    var colors = ['', 'gold', 'white'];
    var colorClass = colors[Math.floor(Math.random() * colors.length)];

    spark.className = 'animate-spark' + (colorClass ? ' ' + colorClass : '');
    spark.style.setProperty('--spark-dx', dx + 'px');
    spark.style.setProperty('--spark-dy', dy + 'px');
    spark.style.width = (2 + Math.random() * 4) + 'px';
    spark.style.height = spark.style.width;
    container.appendChild(spark);

    setTimeout(function() {
      if (spark.parentNode) spark.parentNode.removeChild(spark);
    }, 1000);
  }

  function startSparks() {
    stopSparks();
    sparkInterval = setInterval(function() {
      var count = 2 + Math.floor(Math.random() * 3);
      for (var i = 0; i < count; i++) {
        setTimeout(spawnSpark, Math.random() * 200);
      }
    }, 300);
  }

  function stopSparks() {
    if (sparkInterval) {
      clearInterval(sparkInterval);
      sparkInterval = null;
    }
  }

  var presetsSource = null; // 'ai' or 'static'

  /**
   * Load animation presets for the current cutout.
   * Caches presets within the same cutout session — if presets are already
   * loaded (e.g. after "Redo"), reuses them without calling Ollama again.
   * Sends the cutout image to Ollama for AI-tailored suggestions on first load.
   * Falls back to static presets if Ollama is unavailable.
   */
  function loadPresetsForCutout() {
    if (!cutoutData || !cutoutData.cutoutDataURL) {
      return Promise.resolve();
    }

    // If presets are already cached for this cutout, reuse them
    if (presets.length > 0 && presetsSource) {
      console.log('[Animate] Reusing cached %s presets (%d)', presetsSource, presets.length);
      populatePresetGrid();
      if (presetsSource === 'ai') {
        showAiBadge();
      } else {
        hideAiBadge();
      }
      showPresetPanel();
      return Promise.resolve();
    }

    // Extract raw base64 (strip data URL prefix)
    var base64 = cutoutData.cutoutDataURL.replace(/^data:image\/\w+;base64,/, '');

    // First load — fetch from Ollama
    showPresetLoading();

    return window.snip.generateAnimationPresets(base64).then(function(result) {
      presets = result.presets || [];
      presetsSource = result.source;
      populatePresetGrid();
      if (result.source === 'ai') {
        showAiBadge();
      } else {
        hideAiBadge();
      }
    }).catch(function(err) {
      console.error('[Animate] AI preset generation failed:', err.message);
      // Last resort: fall back to static list
      return window.snip.listAnimationPresets().then(function(staticPresets) {
        presets = staticPresets || [];
        presetsSource = 'static';
        populatePresetGrid();
        hideAiBadge();
      });
    });
  }

  /**
   * Show loading state with sparkle text while Ollama analyses the cutout.
   */
  function showPresetLoading() {
    var grid = document.getElementById('animate-preset-grid');
    if (grid) {
      grid.innerHTML = '';
      var loading = document.createElement('div');
      loading.className = 'animate-preset-loading';
      loading.innerHTML = '<span class="animate-loading-sparkle">\u2728</span>' +
                          '<span class="animate-loading-text">Generating presets</span>' +
                          '<span class="animate-loading-dots"></span>';
      grid.appendChild(loading);
    }
    hideAiBadge();
    // Show the panel immediately so user sees loading state
    showPresetPanel();
  }

  /**
   * Show or hide the AI badge next to the preset panel title.
   */
  function showAiBadge() {
    var title = document.querySelector('.animate-panel-title');
    if (title && !title.querySelector('.ai-badge')) {
      var badge = document.createElement('span');
      badge.className = 'ai-badge';
      badge.textContent = '\u2728 AI';
      title.appendChild(badge);
    }
  }

  function hideAiBadge() {
    var badge = document.querySelector('.animate-panel-title .ai-badge');
    if (badge) badge.parentNode.removeChild(badge);
  }

  function populatePresetGrid() {
    var grid = document.getElementById('animate-preset-grid');
    if (!grid) return;
    grid.innerHTML = '';

    presets.forEach(function(preset) {
      var btn = document.createElement('button');
      btn.className = 'animate-preset-btn';
      btn.innerHTML = '<span class="animate-preset-label">' + preset.label + '</span>' +
                       '<span class="animate-preset-desc">' + preset.description + '</span>';
      btn.addEventListener('click', function() {
        // AI presets pass their prompt as _custom so generateAnimation()
        // uses the AI-generated prompt directly instead of looking up static presets
        if (presetsSource === 'ai') {
          startAnimation('_custom', preset.prompt, preset.numFrames);
        } else {
          startAnimation(preset.name);
        }
      });
      grid.appendChild(btn);
    });
  }

  function startAnimation(presetName, customPrompt, numFrames) {
    if (!cutoutData) {
      ToolUtils.showToast('No cutout available', 'error', 3000);
      return;
    }

    hidePresetPanel();
    showProgress();

    // Set up progress listener
    progressCleanup = window.snip.onAnimateProgress(function(progress) {
      updateProgress(progress);
    });

    var opts = { fps: 16, loops: 0 };
    if (customPrompt) {
      opts.customPrompt = customPrompt;
    }
    if (numFrames) {
      opts.numFrames = numFrames;
    }

    window.snip.animateCutout({
      cutoutDataURL: cutoutData.cutoutDataURL,
      presetName: presetName,
      options: opts
    }).then(function(result) {
      if (progressCleanup) {
        progressCleanup();
        progressCleanup = null;
      }
      hideProgress();
      animationResult = result;
      showResult(result);
    }).catch(function(err) {
      if (progressCleanup) {
        progressCleanup();
        progressCleanup = null;
      }
      hideProgress();
      console.error('[Animate] Animation failed:', err);
      ToolUtils.showToast('Animation failed: ' + (err.message || 'Unknown error'), 'error', 4000);
      showAnimateButton();
    });
  }

  function startCustomAnimation() {
    var input = document.getElementById('animate-custom-input');
    if (!input) return;
    var prompt = input.value.trim();
    if (!prompt) {
      ToolUtils.showToast('Enter a prompt describing the animation', 'error', 3000);
      input.focus();
      return;
    }
    startAnimation('_custom', prompt);
  }

  function showResult(result) {
    var title = document.getElementById('animate-result-title');
    if (title) {
      title.textContent = result.frameCount + ' frames \u00b7 GIF Preview';
    }

    var preview = document.getElementById('animate-preview');
    if (preview && result.gifDataURL) {
      preview.src = result.gifDataURL;
    }

    showResultPanel();
  }

  function saveGIF() {
    if (!animationResult || !animationResult.gifBuffer) return;
    var now = new Date();
    var timestamp = now.toISOString().replace(/T/, '_').replace(/:/g, '-').replace(/\..+/, '');

    window.snip.saveAnimation({
      buffer: animationResult.gifBuffer,
      format: 'gif',
      timestamp: timestamp
    }).then(function(filepath) {
      ToolUtils.showToast('GIF saved', 'success', 2000);
      console.log('[Animate] Saved GIF:', filepath);
      discardResult();
    }).catch(function(err) {
      ToolUtils.showToast('Save failed: ' + err.message, 'error', 3000);
    });
  }

  function saveAPNG() {
    if (!animationResult || !animationResult.apngBuffer) return;
    var now = new Date();
    var timestamp = now.toISOString().replace(/T/, '_').replace(/:/g, '-').replace(/\..+/, '');

    window.snip.saveAnimation({
      buffer: animationResult.apngBuffer,
      format: 'apng',
      timestamp: timestamp
    }).then(function(filepath) {
      ToolUtils.showToast('APNG saved', 'success', 2000);
      console.log('[Animate] Saved APNG:', filepath);
    }).catch(function(err) {
      ToolUtils.showToast('Save failed: ' + err.message, 'error', 3000);
    });
  }

  function discardResult() {
    hideResultPanel();
    animationResult = null;
    showAnimateButton();
  }

  function init() {
    // Animate button click (magic wand)
    var animateBtn = document.getElementById('animate-btn');
    if (animateBtn) {
      animateBtn.addEventListener('click', function() {
        loadPresetsForCutout();
      });
    }

    // Cancel preset selection
    var cancelPreset = document.getElementById('animate-cancel-preset');
    if (cancelPreset) {
      cancelPreset.addEventListener('click', function() {
        hidePresetPanel();
        showAnimateButton();
      });
    }

    // Custom prompt: go button
    var customGoBtn = document.getElementById('animate-custom-go');
    if (customGoBtn) {
      customGoBtn.addEventListener('click', function() {
        startCustomAnimation();
      });
    }

    // Custom prompt: Enter key
    var customInput = document.getElementById('animate-custom-input');
    if (customInput) {
      customInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          startCustomAnimation();
        }
      });
    }

    // Result window buttons
    var saveGifBtn = document.getElementById('animate-save-gif');
    var saveApngBtn = document.getElementById('animate-save-apng');
    var redoBtn = document.getElementById('animate-redo');
    var cancelResult = document.getElementById('animate-cancel-result');

    if (saveGifBtn) saveGifBtn.addEventListener('click', saveGIF);
    if (saveApngBtn) saveApngBtn.addEventListener('click', saveAPNG);
    if (redoBtn) redoBtn.addEventListener('click', redoAnimation);
    if (cancelResult) cancelResult.addEventListener('click', discardResult);
  }

  /**
   * Returns true if any animate panel (preset picker, progress overlay, or
   * result panel) is currently visible. Used by editor-app.js to prevent
   * Enter/Escape from closing the editor while animation UI is active.
   */
  function isActive() {
    var presets = document.getElementById('animate-presets');
    var progress = document.getElementById('animate-progress');
    var result = document.getElementById('animate-result');
    return (presets && !presets.classList.contains('hidden')) ||
           (progress && !progress.classList.contains('hidden')) ||
           (result && !result.classList.contains('hidden'));
  }

  /**
   * Dismiss the topmost animate panel on Escape.
   * - Preset panel → close and show animate button
   * - Result panel → discard the animation
   * - Progress overlay → ignore (can't cancel mid-generation)
   */
  function dismiss() {
    var progress = document.getElementById('animate-progress');
    if (progress && !progress.classList.contains('hidden')) {
      // Can't cancel mid-generation — do nothing
      return;
    }

    var result = document.getElementById('animate-result');
    if (result && !result.classList.contains('hidden')) {
      discardResult();
      return;
    }

    var presets = document.getElementById('animate-presets');
    if (presets && !presets.classList.contains('hidden')) {
      hidePresetPanel();
      showAnimateButton();
      return;
    }
  }

  /**
   * Handle keyboard shortcuts when an animate panel is active.
   * - Result panel: Enter or Cmd+S saves GIF, Esc discards (handled by dismiss())
   * - Other panels: no special handling
   */
  function handleKeydown(e) {
    var resultPanel = document.getElementById('animate-result');
    var resultVisible = resultPanel && !resultPanel.classList.contains('hidden');

    if (resultVisible) {
      // Enter or Cmd+S / Ctrl+S saves the GIF
      if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 's')) {
        e.preventDefault();
        saveGIF();
        return;
      }
      // R — redo (try another preset)
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        redoAnimation();
        return;
      }
    }
  }

  return {
    init: init,
    setCutoutData: setCutoutData,
    clearCutoutData: clearCutoutData,
    isActive: isActive,
    dismiss: dismiss,
    handleKeydown: handleKeydown
  };
})();
