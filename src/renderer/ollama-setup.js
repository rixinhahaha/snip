(function () {
  'use strict';

  // Apply saved theme
  window.snip.getTheme().then(function (theme) {
    document.documentElement.setAttribute('data-theme', theme || 'dark');
  });

  window.snip.onThemeChanged(function (theme) {
    document.documentElement.setAttribute('data-theme', theme);
  });

  var installBtn = document.getElementById('install-btn');
  var modelBtn = document.getElementById('model-btn');
  var skipBtn = document.getElementById('skip-btn');
  var doneBtn = document.getElementById('done-btn');
  var installRetryBtn = document.getElementById('install-retry-btn');
  var modelRetryBtn = document.getElementById('model-retry-btn');

  var installIndicator = document.getElementById('step-install-indicator');
  var runningIndicator = document.getElementById('step-running-indicator');
  var modelIndicator = document.getElementById('step-model-indicator');

  // Initial state check
  refreshStatus();

  // Button handlers
  installBtn.addEventListener('click', function () {
    hideError('install');
    installBtn.disabled = true;
    installBtn.style.display = 'none';
    document.getElementById('install-progress-section').classList.remove('hidden');
    window.snip.installOllama();
  });

  modelBtn.addEventListener('click', function () {
    hideError('model');
    modelBtn.disabled = true;
    modelBtn.style.display = 'none';
    document.getElementById('model-progress-section').classList.remove('hidden');
    window.snip.pullOllamaModel();
  });

  installRetryBtn.addEventListener('click', function () {
    hideError('install');
    installBtn.disabled = true;
    installBtn.style.display = 'none';
    document.getElementById('install-progress-section').classList.remove('hidden');
    window.snip.installOllama();
  });

  modelRetryBtn.addEventListener('click', function () {
    hideError('model');
    modelBtn.disabled = true;
    modelBtn.style.display = 'none';
    document.getElementById('model-progress-section').classList.remove('hidden');
    window.snip.pullOllamaModel();
  });

  skipBtn.addEventListener('click', function () {
    window.snip.closeSetupWindow();
  });

  doneBtn.addEventListener('click', function () {
    window.snip.closeSetupWindow();
  });

  function showError(section, message) {
    var errorDiv = document.getElementById(section + '-error');
    var errorText = document.getElementById(section + '-error-text');
    if (errorDiv) {
      errorText.textContent = message;
      errorDiv.classList.remove('hidden');
    }
  }

  function hideError(section) {
    var errorDiv = document.getElementById(section + '-error');
    if (errorDiv) errorDiv.classList.add('hidden');
  }

  // Listen for install progress
  window.snip.onOllamaInstallProgress(function (progress) {
    var bar = document.getElementById('install-progress-bar');
    var scissors = document.getElementById('install-scissors');
    var detail = document.getElementById('install-progress-detail');

    if (progress.status === 'done') {
      refreshStatus();
      return;
    }

    if (progress.status === 'error') {
      document.getElementById('install-progress-section').classList.add('hidden');
      showError('install', progress.error || 'Installation failed. Check your internet connection and try again.');
      return;
    }

    var percent = progress.percent || 0;
    bar.style.width = percent + '%';
    scissors.style.left = percent + '%';

    var labels = {
      'downloading': 'Downloading Ollama...',
      'extracting': 'Unpacking...',
      'installing': 'Moving to Applications...',
      'launching': 'Starting Ollama...'
    };
    detail.textContent = labels[progress.status] || progress.status || 'Preparing...';
  });

  // Listen for model pull progress
  window.snip.onOllamaPullProgress(function (progress) {
    var bar = document.getElementById('model-progress-bar');
    var scissors = document.getElementById('model-scissors');
    var detail = document.getElementById('model-progress-detail');

    if (progress.status === 'ready') {
      refreshStatus();
      return;
    }

    if (progress.status === 'error') {
      document.getElementById('model-progress-section').classList.add('hidden');
      showError('model', progress.error || 'Model download failed. Check your internet connection and try again.');
      return;
    }

    if (progress.status === 'idle') return;

    var percent = progress.percent || 0;
    bar.style.width = percent + '%';
    scissors.style.left = percent + '%';

    if (progress.total > 0) {
      var downloadedMB = (progress.completed / (1024 * 1024)).toFixed(0);
      var totalMB = (progress.total / (1024 * 1024)).toFixed(0);
      detail.textContent = downloadedMB + ' / ' + totalMB + ' MB (' + progress.percent + '%)';
    } else {
      detail.textContent = progress.percent + '%';
    }
  });

  // Listen for status changes
  window.snip.onOllamaStatusChanged(function () {
    refreshStatus();
  });

  async function refreshStatus() {
    try {
      var status = await window.snip.getOllamaStatus();
      applyStatus(status);
    } catch (err) {
      applyStatus({ installed: false, running: false, modelReady: false });
    }
  }

  function applyStatus(status) {
    var installed = status.installed;
    var running = status.running;
    var modelReady = status.modelReady;

    // Step 1: Install
    if (installed) {
      installIndicator.className = 'step-indicator done';
      installBtn.style.display = 'none';
      document.getElementById('install-progress-section').classList.add('hidden');
      hideError('install');
    } else {
      installIndicator.className = 'step-indicator active';
      if (!status.installing) {
        installBtn.style.display = '';
        installBtn.disabled = false;
      }
    }

    // Step 2: Running
    if (running) {
      runningIndicator.className = 'step-indicator done';
    } else if (installed) {
      runningIndicator.className = 'step-indicator active';
    } else {
      runningIndicator.className = 'step-indicator';
    }

    // Step 3: Model
    if (modelReady) {
      modelIndicator.className = 'step-indicator done';
      modelBtn.style.display = 'none';
      document.getElementById('model-progress-section').classList.add('hidden');
      hideError('model');
    } else if (running) {
      modelIndicator.className = 'step-indicator active';
      if (!status.pulling) {
        modelBtn.style.display = '';
        modelBtn.disabled = false;
      }
    } else {
      modelIndicator.className = 'step-indicator';
      modelBtn.disabled = true;
    }

    // All done?
    if (installed && running && modelReady) {
      document.getElementById('setup-done').classList.remove('hidden');
      skipBtn.style.display = 'none';
      document.querySelector('.setup-steps').style.opacity = '0.5';
    }
  }
})();
