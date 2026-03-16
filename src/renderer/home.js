(function() {
  'use strict';

  // Apply theme
  (async function() {
    var theme = await window.snip.getTheme();
    document.documentElement.dataset.theme = theme;
  })();
  window.snip.onThemeChanged(function(theme) {
    document.documentElement.dataset.theme = theme;
  });

  var descriptionSaveTimers = {}; // debounce timers for description auto-save

  var currentSubdir = ''; // relative path within screenshots dir

  // ── Navigation ──
  var searchInitialized = false;

  function switchToPage(pageName) {
    document.querySelectorAll('.nav-item').forEach(function(b) { b.classList.remove('active'); });
    document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
    var btn = document.querySelector('.nav-item[data-page="' + pageName + '"]');
    if (btn) btn.classList.add('active');
    document.getElementById('page-' + pageName).classList.add('active');
    if (pageName === 'search' && !searchInitialized) {
      initSearch();
      searchInitialized = true;
    }
  }

  document.querySelectorAll('.nav-item').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchToPage(btn.dataset.page);
    });
  });

  // Listen for navigate-to-search IPC (from Cmd+Shift+S or tray)
  if (window.snip.onNavigateToSearch) {
    window.snip.onNavigateToSearch(function() {
      switchToPage('search');
      var input = document.getElementById('search-input');
      if (input) input.focus();
    });
  }

  // ── Screenshots page ──
  async function init() {
    loadFolder('');
    initOllamaSettings();
    initAnimationSettings();
    loadTags();
    if (window.snip.onTagsChanged) {
      window.snip.onTagsChanged(function() { loadTags(); });
    }
    initThemeToggle();
    initShortcutsSettings();
    initMcpSettings();
    initCliSettings();
    initExtensionsSettings();
    initSetupOverlay();
  }

  // ── Theme toggle ──
  async function initThemeToggle() {
    var theme = await window.snip.getTheme();
    updateThemeButtons(theme);

    document.getElementById('theme-dark').addEventListener('click', function() {
      window.snip.setTheme('dark');
    });
    document.getElementById('theme-light').addEventListener('click', function() {
      window.snip.setTheme('light');
    });
    document.getElementById('theme-glass').addEventListener('click', function() {
      window.snip.setTheme('glass');
    });

    // Sync when theme changes externally (tray menu or other window)
    window.snip.onThemeChanged(function(t) {
      updateThemeButtons(t);
    });
  }

  function updateThemeButtons(theme) {
    document.getElementById('theme-dark').classList.toggle('active', theme === 'dark');
    document.getElementById('theme-light').classList.toggle('active', theme === 'light');
    document.getElementById('theme-glass').classList.toggle('active', theme === 'glass');
  }

  async function loadFolder(subdir) {
    currentSubdir = subdir;
    updateBreadcrumb();

    var items = await window.snip.listFolder(subdir);
    var grid = document.getElementById('file-grid');
    var empty = document.getElementById('empty-folder');
    grid.innerHTML = '';

    if (items.length === 0) {
      grid.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }

    grid.classList.remove('hidden');
    empty.classList.add('hidden');

    // Sort: folders first, then files by modified time descending
    items.sort(function(a, b) {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return b.mtime - a.mtime;
    });

    items.forEach(function(item) {
      // Skip hidden files like .index.json
      if (item.name.startsWith('.')) return;

      var el = document.createElement('div');
      el.className = 'file-item';

      if (item.isDirectory) {
        el.innerHTML =
          '<div class="file-thumb folder-icon">' +
            '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
              '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>' +
            '</svg>' +
            '<button class="file-delete-btn" title="Delete Folder">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
                '<line x1="6" y1="6" x2="18" y2="18"/>' +
                '<line x1="18" y1="6" x2="6" y2="18"/>' +
              '</svg>' +
            '</button>' +
          '</div>' +
          '<div class="file-name">' + escapeHtml(item.name) + '</div>';
        el.querySelector('.file-delete-btn').addEventListener('click', function(e) {
          e.stopPropagation();
          if (!confirm('Delete folder "' + item.name + '" and all its contents? This moves it to Trash.')) return;
          window.snip.deleteFolder(item.fullPath).then(function() {
            loadFolder(currentSubdir);
          });
        });
        el.addEventListener('click', function() {
          var path = currentSubdir ? currentSubdir + '/' + item.name : item.name;
          loadFolder(path);
        });
        el.addEventListener('contextmenu', function(e) {
          showContextMenu(e, { type: 'folder', path: item.fullPath, name: item.name, subdir: currentSubdir });
        });
      } else {
        var isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(item.name);
        if (isImage) {
          el.innerHTML =
            '<div class="file-thumb">' +
              '<img data-path="' + escapeHtml(item.fullPath) + '" src="" alt="">' +
              '<button class="file-delete-btn" title="Move to Trash">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
                  '<line x1="6" y1="6" x2="18" y2="18"/>' +
                  '<line x1="18" y1="6" x2="6" y2="18"/>' +
                '</svg>' +
              '</button>' +
            '</div>' +
            '<div class="file-name">' + escapeHtml(item.name) + '</div>' +
            '<div class="file-meta">' + formatSize(item.size) + '</div>';
          // Load thumbnail async
          var img = el.querySelector('img');
          loadThumb(img, item.fullPath);
          // Delete button handler
          el.querySelector('.file-delete-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            window.snip.deleteScreenshot(item.fullPath).then(function() {
              loadFolder(currentSubdir);
            });
          });
        } else {
          el.innerHTML =
            '<div class="file-thumb">' +
              '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5">' +
                '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>' +
                '<polyline points="14 2 14 8 20 8"/>' +
              '</svg>' +
            '</div>' +
            '<div class="file-name">' + escapeHtml(item.name) + '</div>' +
            '<div class="file-meta">' + formatSize(item.size) + '</div>';
        }
        el.addEventListener('click', function() {
          window.snip.revealInFinder(item.fullPath);
        });
        el.addEventListener('contextmenu', function(e) {
          showContextMenu(e, { type: 'file', path: item.fullPath, name: item.name });
        });
      }

      grid.appendChild(el);
    });
  }

  async function loadThumb(imgEl, filepath) {
    var dataURL = await window.snip.getThumbnail(filepath);
    if (dataURL) imgEl.src = dataURL;
  }

  function updateBreadcrumb() {
    var container = document.getElementById('folder-breadcrumb');
    container.innerHTML = '';

    if (!currentSubdir) {
      // At root — no breadcrumb shown
      return;
    }

    // Show clickable root to go back
    var root = document.createElement('span');
    root.textContent = '\u2190';
    root.title = 'Back to root';
    root.addEventListener('click', function() { loadFolder(''); });
    container.appendChild(root);

    var parts = currentSubdir.split('/');
    parts.forEach(function(part, i) {
      var sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = ' / ';
      container.appendChild(sep);

      var link = document.createElement('span');
      link.textContent = part;
      if (i === parts.length - 1) {
        link.className = 'current';
      } else {
        var subpath = parts.slice(0, i + 1).join('/');
        link.addEventListener('click', function() { loadFolder(subpath); });
      }
      container.appendChild(link);
    });
  }

  document.getElementById('btn-refresh').addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true;
    btn.style.opacity = '0.5';
    try {
      var result = await window.snip.refreshIndex();
      console.log('[Home] Refresh: pruned %d, embeddings %d', result.pruned, result.embeddings);
    } catch (err) {
      console.warn('[Home] Refresh failed:', err);
    }
    btn.disabled = false;
    btn.style.opacity = '';
    loadFolder(currentSubdir);
  });

  document.getElementById('btn-open-finder').addEventListener('click', function() {
    window.snip.openScreenshotsFolder();
  });

  // ── Context menu ──
  var contextMenu = document.getElementById('context-menu');
  var contextTarget = null; // { type: 'file'|'folder', path, name, subdir }

  function showContextMenu(e, target) {
    e.preventDefault();
    e.stopPropagation();
    contextTarget = target;

    // Position
    var x = e.clientX;
    var y = e.clientY;

    // Show menu to calculate dimensions
    contextMenu.classList.remove('hidden');

    // Keep within viewport
    var menuW = contextMenu.offsetWidth;
    var menuH = contextMenu.offsetHeight;
    if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 4;
    if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 4;

    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';

    // Update label
    var deleteBtn = document.getElementById('ctx-delete');
    deleteBtn.querySelector('svg').nextSibling.textContent = target.type === 'folder' ? ' Delete Folder' : ' Move to Trash';
  }

  function hideContextMenu() {
    contextMenu.classList.add('hidden');
    contextTarget = null;
  }

  // Dismiss on click outside or Esc
  document.addEventListener('click', hideContextMenu);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') hideContextMenu();
  });

  document.getElementById('ctx-open').addEventListener('click', function() {
    if (contextTarget) {
      window.snip.revealInFinder(contextTarget.path);
    }
    hideContextMenu();
  });

  document.getElementById('ctx-delete').addEventListener('click', async function() {
    if (!contextTarget) return;

    if (contextTarget.type === 'folder') {
      var ok = confirm('Delete folder "' + contextTarget.name + '" and all its contents? This moves it to Trash.');
      if (!ok) { hideContextMenu(); return; }
      await window.snip.deleteFolder(contextTarget.path);
      // Navigate up if we were inside the deleted folder
      if (currentSubdir && currentSubdir.startsWith(contextTarget.name)) {
        loadFolder('');
      } else {
        loadFolder(currentSubdir);
      }
    } else {
      await window.snip.deleteScreenshot(contextTarget.path);
      loadFolder(currentSubdir);
    }
    hideContextMenu();
  });

  // ── AI settings visibility ──
  function updateAiSettingsVisibility(enabled) {
    var details = document.getElementById('ai-details');
    var toggle = document.getElementById('ai-toggle-input');
    if (details) {
      details.style.display = enabled === false ? 'none' : '';
    }
    if (toggle) {
      toggle.checked = enabled !== false;
    }
  }

  // ── Settings: Local AI Assistant (Ollama) ──

  var MODEL_SPECS = {
    'minicpm-v': { params: '8B', size: '~5.1 GB', quant: 'Q4_K_M', description: 'Best balance of accuracy and speed for screenshot analysis.' }
  };

  async function initOllamaSettings() {
    // Setup button opens the inline overlay
    var setupBtn = document.getElementById('ollama-setup-btn');
    setupBtn.addEventListener('click', function() {
      if (window._showSetupOverlay) window._showSetupOverlay();
    });

    // AI on/off toggle switch
    var aiToggle = document.getElementById('ai-toggle-input');
    if (aiToggle) {
      aiToggle.addEventListener('change', async function() {
        var enabled = aiToggle.checked;
        await window.snip.setAiEnabled(enabled);
        updateAiSettingsVisibility(enabled);
        if (enabled) {
          refreshOllamaChecklist();
        }
      });
    }

    // Info tooltip toggle
    var infoBtn = document.getElementById('model-info-btn');
    var tooltip = document.getElementById('model-info-tooltip');

    infoBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      tooltip.classList.toggle('hidden');
    });

    document.addEventListener('click', function(e) {
      if (!tooltip.classList.contains('hidden') && !tooltip.contains(e.target) && e.target !== infoBtn) {
        tooltip.classList.add('hidden');
      }
    });

    // Listen for status changes from main process
    if (window.snip.onOllamaStatusChanged) {
      window.snip.onOllamaStatusChanged(function(status) {
        applyOllamaChecklist(status);
      });
    }

    // Initial check
    refreshOllamaChecklist();
  }

  async function refreshOllamaChecklist() {
    try {
      var status = await window.snip.getOllamaStatus();
      applyOllamaChecklist(status);
    } catch (err) {
      applyOllamaChecklist({ installed: false, running: false, modelReady: false });
    }
  }

  function applyOllamaChecklist(status) {
    var checkInstalled = document.getElementById('check-installed');
    var checkRunning = document.getElementById('check-running');
    var checkModel = document.getElementById('check-model');
    var setupBtn = document.getElementById('ollama-setup-btn');
    var readyInfo = document.getElementById('ollama-ready-info');

    setCheckIcon(checkInstalled, status.installed);
    setCheckIcon(checkRunning, status.running);
    setCheckIcon(checkModel, status.modelReady);

    var allReady = status.installed && status.running && status.modelReady;

    if (allReady) {
      setupBtn.style.display = 'none';
      readyInfo.classList.remove('hidden');
      updateCurrentModelCard(status.currentModel || 'minicpm-v', status.host);
    } else {
      readyInfo.classList.add('hidden');
      setupBtn.style.display = '';
      // Smart button text based on state
      if (!status.installed) {
        setupBtn.textContent = 'Set up';
      } else if (!status.running) {
        setupBtn.textContent = 'Reconnect';
      } else if (!status.modelReady) {
        setupBtn.textContent = 'Finish setup';
      }
      // Keep polling until all ready (Ollama may be starting in background)
      setTimeout(refreshOllamaChecklist, 1000);
    }
  }

  function setCheckIcon(el, done) {
    if (done) {
      el.textContent = '\u2713';
      el.className = 'check-icon done';
    } else {
      el.textContent = '\u25CB';
      el.className = 'check-icon pending';
    }
  }

  function updateCurrentModelCard(modelName, host) {
    var nameEl = document.getElementById('current-model-name');
    if (nameEl) nameEl.textContent = modelName;

    var specs = MODEL_SPECS[modelName] || { params: '\u2014', size: '\u2014', quant: '\u2014', description: 'Custom model' };
    var infoModel = document.getElementById('info-model');
    if (infoModel) infoModel.textContent = modelName;
    var infoHost = document.getElementById('info-host');
    if (infoHost) infoHost.textContent = host || '\u2014';
    var infoParams = document.getElementById('info-params');
    if (infoParams) infoParams.textContent = specs.params;
    var infoSize = document.getElementById('info-size');
    if (infoSize) infoSize.textContent = specs.size;
    var infoQuant = document.getElementById('info-quant');
    if (infoQuant) infoQuant.textContent = specs.quant;
    var infoDesc = document.getElementById('info-desc');
    if (infoDesc) infoDesc.textContent = specs.description;
  }


  // ── Settings: Animation ──
  async function initAnimationSettings() {
    var statusEl = document.getElementById('animation-presets-status');
    var keyInput = document.getElementById('fal-api-key');
    var keyToggle = document.getElementById('fal-api-key-toggle');
    var keySave = document.getElementById('fal-api-key-save');
    var keyStatus = document.getElementById('fal-api-key-status');
    var keyLink = document.getElementById('fal-api-key-link');

    if (!keyInput) return;

    // Load existing key
    try {
      var config = await window.snip.getAnimationConfig();
      if (config.falApiKey) {
        keyInput.value = config.falApiKey;
        updateKeyStatus(true);
      } else {
        updateKeyStatus(false);
      }
    } catch (err) {
      updateKeyStatus(false);
    }

    // Toggle visibility
    keyToggle.addEventListener('click', function() {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    });

    // Save key
    keySave.addEventListener('click', function() {
      var key = keyInput.value.trim();
      window.snip.setAnimationConfig({ falApiKey: key }).then(function() {
        updateKeyStatus(!!key);
      });
    });

    // Enter key to save
    keyInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        keySave.click();
      }
    });

    // Open fal.ai in browser
    keyLink.addEventListener('click', function(e) {
      e.preventDefault();
      window.snip.openExternalUrl('https://fal.ai/dashboard/keys');
    });

    function updateKeyStatus(configured) {
      if (configured) {
        keyStatus.innerHTML = '<span class="status-dot running"></span> Configured';
      } else {
        keyStatus.innerHTML = '<span class="status-dot stopped"></span> Not configured — animation features disabled';
      }
    }

    // AI presets status (Ollama)
    if (!statusEl) return;
    try {
      var ollamaStatus = await window.snip.getOllamaStatus();
      if (ollamaStatus && ollamaStatus.running) {
        statusEl.textContent = 'Powered by Ollama (AI-tailored)';
      } else {
        statusEl.textContent = 'Static presets (Ollama starting…)';
        // Retry after Ollama boots
        setTimeout(async function() {
          var retry = await window.snip.getOllamaStatus();
          if (retry && retry.running) {
            statusEl.textContent = 'Powered by Ollama (AI-tailored)';
          } else {
            statusEl.textContent = 'Static presets (Ollama unavailable)';
          }
        }, 5000);
      }
    } catch (err) {
      statusEl.textContent = 'Static presets (fallback)';
    }
  }

  async function loadTags() {
    var tags = await window.snip.getTagsWithDescriptions();
    renderTags(tags);
  }

  function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function renderTags(tags) {
    var list = document.getElementById('tags-list');
    list.innerHTML = '';
    tags.forEach(function(tag) {
      var row = document.createElement('div');
      row.className = 'tag-row';

      var name = document.createElement('span');
      name.className = 'tag-row-name';
      name.textContent = tag.name;

      var descInput = document.createElement('textarea');
      descInput.className = 'tag-row-desc';
      descInput.placeholder = 'Add description\u2026';
      descInput.rows = 1;
      descInput.value = tag.description || '';

      var savedLabel = document.createElement('span');
      savedLabel.className = 'tag-row-saved';
      savedLabel.textContent = 'Saved';

      // Debounced auto-save
      (function(tagName, textarea) {
        textarea.addEventListener('input', function() {
          autoResizeTextarea(textarea);
          clearTimeout(descriptionSaveTimers[tagName]);
          descriptionSaveTimers[tagName] = setTimeout(async function() {
            await window.snip.setTagDescription(tagName, textarea.value.trim());
            savedLabel.classList.add('visible');
            setTimeout(function() { savedLabel.classList.remove('visible'); }, 1500);
          }, 600);
        });
      })(tag.name, descInput);

      row.appendChild(name);
      row.appendChild(descInput);
      row.appendChild(savedLabel);

      if (!tag.isDefault) {
        var removeBtn = document.createElement('button');
        removeBtn.className = 'tag-row-remove';
        removeBtn.textContent = '\u00d7';
        removeBtn.title = 'Remove tag';
        removeBtn.addEventListener('click', async function() {
          await window.snip.removeCategory(tag.name);
          var fullTags = await window.snip.getTagsWithDescriptions();
          renderTags(fullTags);
        });
        row.appendChild(removeBtn);
      }

      list.appendChild(row);

      // Initial resize after element is rendered
      (function(textarea) {
        requestAnimationFrame(function() { autoResizeTextarea(textarea); });
      })(descInput);
    });
  }

  document.getElementById('add-tag-btn').addEventListener('click', async function() {
    var nameInput = document.getElementById('new-tag-name');
    var descInput = document.getElementById('new-tag-description');
    var name = nameInput.value.trim().toLowerCase();
    if (!name) return;
    var description = descInput.value.trim();
    var updatedTags = await window.snip.addCategoryWithDescription(name, description);
    renderTags(updatedTags);
    nameInput.value = '';
    descInput.value = '';
    var status = document.getElementById('tags-status');
    status.textContent = 'Tag "' + name + '" added.';
    status.className = 'status success';
    setTimeout(function() { status.textContent = ''; }, 3000);
  });

  document.getElementById('new-tag-name').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('add-tag-btn').click();
  });

  document.getElementById('new-tag-description').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('add-tag-btn').click();
  });

  // ── Keyboard Shortcuts settings ──
  var SHORTCUT_DEFINITIONS = [
    { action: 'quick-snip', name: 'Quick Snip', context: 'Global', configurable: true },
    { action: 'capture', name: 'Snip and Annotate', context: 'Global', configurable: true },
    { action: 'search', name: 'Search snips', context: 'Global', configurable: true },
    { action: null, name: 'Select tool', context: 'Annotation', configurable: false, display: 'V' },
    { action: null, name: 'Rectangle tool', context: 'Annotation', configurable: false, display: 'R' },
    { action: null, name: 'Text tool', context: 'Annotation', configurable: false, display: 'T' },
    { action: null, name: 'Arrow tool', context: 'Annotation', configurable: false, display: 'A' },
    { action: null, name: 'Tag tool', context: 'Annotation', configurable: false, display: 'G' },
    { action: null, name: 'Blur Brush tool', context: 'Annotation', configurable: false, display: 'B' },
    { action: null, name: 'Segment tool', context: 'Annotation', configurable: false, display: 'S' },
    { action: null, name: 'Upscale', context: 'Annotation', configurable: false, display: 'U' },
    { action: null, name: 'Transcribe', context: 'Annotation', configurable: false, display: 'W' },
    { action: null, name: 'Confirm / full screen', context: 'Selection', configurable: false, display: 'Enter' },
    { action: null, name: 'Cancel selection', context: 'Selection', configurable: false, display: 'Esc' },
    { action: null, name: 'Save snip', context: 'Annotation', configurable: false, display: 'Cmd + S' },
    { action: null, name: 'Undo', context: 'Annotation', configurable: false, display: 'Cmd + Z' },
    { action: null, name: 'Redo', context: 'Annotation', configurable: false, display: 'Cmd + Shift + Z' },
    { action: null, name: 'Delete selected', context: 'Annotation', configurable: false, display: 'Delete' },
    { action: null, name: 'Copy & close', context: 'Annotation', configurable: false, display: 'Esc' },
    { action: null, name: 'Save GIF', context: 'GIF Preview', configurable: false, display: 'Enter / Cmd + S' },
    { action: null, name: 'Redo animation', context: 'GIF Preview', configurable: false, display: 'R' },
    { action: null, name: 'Discard animation', context: 'GIF Preview', configurable: false, display: 'Esc' }
  ];

  var recordingAction = null;
  var recordingBtn = null;
  var recordingEditBtn = null;
  var recordingKeyHandler = null;
  var recordingBlurHandler = null;

  function acceleratorToDisplay(accel) {
    if (!accel) return '';
    return accel
      .replace('CommandOrControl', 'Cmd')
      .replace('CmdOrCtrl', 'Cmd')
      .replace(/\+/g, ' + ');
  }

  async function initShortcutsSettings() {
    var shortcuts = await window.snip.getShortcuts();
    renderShortcuts(shortcuts);

    document.getElementById('shortcuts-reset-btn').addEventListener('click', async function() {
      stopRecording();
      await window.snip.resetShortcuts();
      // The broadcast from reset-shortcuts will trigger onShortcutsChanged which re-renders
      var status = document.getElementById('shortcuts-status');
      status.textContent = 'Restored defaults';
      status.classList.add('visible');
      setTimeout(function() { status.classList.remove('visible'); }, 2500);
    });

    if (window.snip.onShortcutsChanged) {
      window.snip.onShortcutsChanged(function(updated) {
        // Skip re-render if user is actively recording — avoid orphaning the keydown handler
        if (recordingAction !== null) return;
        renderShortcuts(updated);
      });
    }
  }

  function renderShortcuts(shortcuts) {
    var list = document.getElementById('shortcuts-list');
    list.innerHTML = '';

    SHORTCUT_DEFINITIONS.forEach(function(def) {
      var row = document.createElement('div');
      row.className = 'shortcut-row' + (def.configurable ? '' : ' readonly');

      var name = document.createElement('span');
      name.className = 'shortcut-row-name';
      name.textContent = def.name;

      var context = document.createElement('span');
      context.className = 'shortcut-row-context';
      context.textContent = def.context;

      var keySpan = document.createElement('span');
      keySpan.className = 'shortcut-row-key';

      if (def.configurable) {
        var currentAccel = shortcuts[def.action] || '';
        keySpan.textContent = acceleratorToDisplay(currentAccel);

        var editBtn = document.createElement('button');
        editBtn.className = 'shortcut-edit-btn';
        editBtn.title = 'Edit shortcut';
        editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

        (function(d, ks, eb, sc) {
          eb.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            // Only allow one recording at a time — ignore if already recording
            if (recordingAction !== null) return;
            startRecording(d, ks, eb, sc);
          });
        })(def, keySpan, editBtn, shortcuts);

        row.appendChild(name);
        row.appendChild(context);
        row.appendChild(keySpan);
        row.appendChild(editBtn);
      } else {
        keySpan.textContent = def.display;
        row.appendChild(name);
        row.appendChild(context);
        row.appendChild(keySpan);
      }

      list.appendChild(row);
    });
  }

  function startRecording(def, keySpan, editBtn, shortcuts) {
    // Stop any existing recording
    stopRecording();

    recordingAction = def.action;
    recordingBtn = keySpan;
    recordingEditBtn = editBtn;
    keySpan.classList.add('recording');
    keySpan.textContent = 'Press key\u2026';
    editBtn.classList.add('recording');

    recordingKeyHandler = function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Esc cancels recording
      if (e.key === 'Escape') {
        stopRecording();
        renderShortcutsFromStore();
        return;
      }

      // Ignore lone modifier keys
      if (['Meta', 'Control', 'Alt', 'Shift'].indexOf(e.key) !== -1) return;

      // Global shortcuts require at least one modifier
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        keySpan.classList.add('conflict');
        keySpan.textContent = 'Needs modifier';
        setTimeout(function() {
          keySpan.classList.remove('conflict');
          keySpan.textContent = 'Press key\u2026';
        }, 1200);
        return;
      }

      // Build Electron accelerator string
      var parts = [];
      if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      parts.push(electronKeyName(e));
      var accelerator = parts.join('+');

      // Conflict detection
      var conflict = null;
      for (var i = 0; i < SHORTCUT_DEFINITIONS.length; i++) {
        var sd = SHORTCUT_DEFINITIONS[i];
        if (!sd.configurable || sd.action === def.action) continue;
        var existing = shortcuts[sd.action] || '';
        if (existing.toLowerCase() === accelerator.toLowerCase()) {
          conflict = sd;
          break;
        }
      }

      if (conflict) {
        keySpan.classList.add('conflict');
        keySpan.textContent = 'Used by ' + conflict.name;
        setTimeout(function() {
          keySpan.classList.remove('conflict');
          keySpan.textContent = 'Press key\u2026';
        }, 1500);
        return;
      }

      // Save
      stopRecording();
      shortcuts[def.action] = accelerator;
      window.snip.setShortcut(def.action, accelerator);
      keySpan.textContent = acceleratorToDisplay(accelerator);
    };

    document.addEventListener('keydown', recordingKeyHandler, true);

    // Cancel recording if window loses focus
    recordingBlurHandler = function() {
      stopRecording();
      renderShortcutsFromStore();
    };
    window.addEventListener('blur', recordingBlurHandler);
  }

  function electronKeyName(e) {
    // Map DOM key names to Electron accelerator key names
    var key = e.key;
    var map = {
      ' ': 'Space', 'ArrowUp': 'Up', 'ArrowDown': 'Down',
      'ArrowLeft': 'Left', 'ArrowRight': 'Right',
      'Backspace': 'Backspace', 'Delete': 'Delete',
      'Enter': 'Return', 'Tab': 'Tab'
    };
    if (map[key]) return map[key];
    // For letters/numbers, use uppercase
    if (key.length === 1) return key.toUpperCase();
    return key;
  }

  function stopRecording() {
    if (recordingKeyHandler) {
      document.removeEventListener('keydown', recordingKeyHandler, true);
      recordingKeyHandler = null;
    }
    if (recordingBlurHandler) {
      window.removeEventListener('blur', recordingBlurHandler);
      recordingBlurHandler = null;
    }
    if (recordingBtn) {
      recordingBtn.classList.remove('recording');
      recordingBtn.classList.remove('conflict');
      recordingBtn = null;
    }
    if (recordingEditBtn) {
      recordingEditBtn.classList.remove('recording');
      recordingEditBtn = null;
    }
    recordingAction = null;
  }

  async function renderShortcutsFromStore() {
    var shortcuts = await window.snip.getShortcuts();
    renderShortcuts(shortcuts);
  }

  // ── Search page ──
  var searchDebounceTimer = null;
  var activeTag = null; // currently selected tag filter
  var fullIndex = []; // cached full index for tag filtering

  async function initSearch() {
    var index = await window.snip.getScreenshotIndex();
    fullIndex = index;
    var emptyEl = document.getElementById('search-empty');
    if (index.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }
    renderTagBar(index);
    displaySearchResults(index);

    document.getElementById('search-input').addEventListener('input', function() {
      clearTimeout(searchDebounceTimer);
      var loadingEl = document.getElementById('search-loading');
      loadingEl.classList.remove('hidden');
      // Clear active tag when typing a search query
      activeTag = null;
      updateTagBarActive();
      searchDebounceTimer = setTimeout(async function() {
        var query = document.getElementById('search-input').value.trim();
        if (!query) {
          fullIndex = await window.snip.getScreenshotIndex();
          renderTagBar(fullIndex);
          displaySearchResults(fullIndex);
          loadingEl.classList.add('hidden');
          return;
        }
        var results = await window.snip.searchScreenshots(query);
        displaySearchResults(results);
        loadingEl.classList.add('hidden');
      }, 300);
    });

    document.getElementById('search-btn-refresh').addEventListener('click', async function() {
      var btn = this;
      btn.disabled = true;
      btn.style.opacity = '0.5';
      try {
        var result = await window.snip.refreshIndex();
        console.log('[Search] Refresh: pruned %d, embeddings %d', result.pruned, result.embeddings);
      } catch (err) {
        console.warn('[Search] Refresh failed:', err);
      }
      btn.disabled = false;
      btn.style.opacity = '';
      // Reload the index and re-render
      fullIndex = await window.snip.getScreenshotIndex();
      renderTagBar(fullIndex);
      displaySearchResults(fullIndex);
    });
  }

  function renderTagBar(index) {
    var container = document.getElementById('search-tags');
    container.innerHTML = '';

    // Count tags across all entries
    var tagCounts = {};
    for (var i = 0; i < index.length; i++) {
      var tags = index[i].tags;
      if (!tags) continue;
      for (var j = 0; j < tags.length; j++) {
        var t = tags[j];
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      }
    }

    // Sort by count descending
    var sorted = Object.keys(tagCounts).sort(function(a, b) {
      return tagCounts[b] - tagCounts[a];
    });

    if (sorted.length === 0) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    sorted.forEach(function(tag) {
      var chip = document.createElement('span');
      chip.className = 'search-tag-chip';
      if (activeTag === tag) chip.classList.add('active');
      chip.dataset.tag = tag;

      var label = document.createTextNode(tag);
      chip.appendChild(label);

      var count = document.createElement('span');
      count.className = 'search-tag-count';
      count.textContent = tagCounts[tag];
      chip.appendChild(count);

      chip.addEventListener('click', function() {
        if (activeTag === tag) {
          // Deselect
          activeTag = null;
          displaySearchResults(fullIndex);
        } else {
          // Filter by tag
          activeTag = tag;
          var filtered = fullIndex.filter(function(entry) {
            return entry.tags && entry.tags.indexOf(tag) !== -1;
          });
          displaySearchResults(filtered);
        }
        // Clear search input when using tag filter
        document.getElementById('search-input').value = '';
        updateTagBarActive();
      });

      container.appendChild(chip);
    });
  }

  function updateTagBarActive() {
    var chips = document.querySelectorAll('.search-tag-chip');
    chips.forEach(function(chip) {
      chip.classList.toggle('active', chip.dataset.tag === activeTag);
    });
  }

  function displaySearchResults(items) {
    var grid = document.getElementById('search-results-grid');
    var emptyEl = document.getElementById('search-empty');
    var noResultsEl = document.getElementById('search-no-results');
    var countEl = document.getElementById('search-result-count');

    grid.innerHTML = '';
    emptyEl.classList.add('hidden');
    noResultsEl.classList.add('hidden');

    if (items.length === 0) {
      noResultsEl.classList.remove('hidden');
      countEl.textContent = '';
      return;
    }

    countEl.textContent = items.length + ' result' + (items.length === 1 ? '' : 's');

    for (var i = 0; i < items.length; i++) {
      (function(item) {
        var card = document.createElement('div');
        card.className = 'search-result-card';
        card.addEventListener('click', function() {
          window.snip.revealInFinder(item.path);
        });

        var img = document.createElement('img');
        img.className = 'search-result-thumbnail';
        img.alt = item.name || item.filename;
        // Load thumbnail async — don't block card rendering
        window.snip.getThumbnail(item.path).then(function(url) {
          img.src = url || '';
        });

        var info = document.createElement('div');
        info.className = 'search-result-info';

        var name = document.createElement('div');
        name.className = 'search-result-name';
        name.textContent = item.name || item.filename;

        var meta = document.createElement('div');
        meta.className = 'search-result-meta';

        var category = document.createElement('span');
        category.className = 'search-result-category';
        category.textContent = item.category || 'uncategorized';
        meta.appendChild(category);

        if (item.score !== undefined && item.score > 0) {
          var score = document.createElement('span');
          score.className = 'search-result-score';
          score.textContent = 'Match ' + (item.score * 100).toFixed(0) + '%';
          meta.appendChild(score);
        }

        info.appendChild(name);
        info.appendChild(meta);

        card.appendChild(img);
        card.appendChild(info);
        grid.appendChild(card);
      })(items[i]);
    }
  }

  // ── Setup overlay ──
  var setupFailCount = 0;
  var sparkleInterval = null;
  var setupFromSettings = false;
  var INSTALL_LABELS = {
    'downloading': 'Downloading Ollama...',
    'extracting': 'Unpacking...',
    'installing': 'Moving to Applications...',
    'launching': 'Starting Ollama...'
  };
  var FALLBACK_STATUS = { installed: false, running: false, modelReady: false };

  // Shared helpers
  function startSetupAction(section, actionBtn, skipBtn, action) {
    hideSetupError(section);
    actionBtn.disabled = true;
    actionBtn.style.display = 'none';
    document.getElementById('setup-' + section + '-progress').classList.remove('hidden');
    skipBtn.textContent = 'Continue in background';
    action();
  }

  function updateSetupProgress(section, percent, detail) {
    document.getElementById('setup-' + section + '-bar').style.width = percent + '%';
    document.getElementById('setup-' + section + '-detail').textContent = detail;
  }

  function handleSetupError(section, skipBtn, error) {
    document.getElementById('setup-' + section + '-progress').classList.add('hidden');
    showSetupError(section, friendlyError(error));
    skipBtn.textContent = 'Skip for now';
    setupFailCount++;
    if (setupFailCount >= 3) showSetupView('failed');
  }

  function applySetupStatus(status) {
    var screen = determineSetupScreen(status);
    if (screen) {
      applySetupScreen(screen, status);
    } else if (setupFromSettings) {
      // From Settings — just dismiss, no welcome screen
      hideSetupOverlay();
    } else {
      showSetupView('welcome');
      burstSparkles(30);
    }
    return screen;
  }

  function formatPullDetail(progress) {
    var percent = progress.percent || 0;
    if (progress.total > 0) {
      var dlMB = (progress.completed / (1024 * 1024)).toFixed(0);
      var totMB = (progress.total / (1024 * 1024)).toFixed(0);
      return dlMB + ' / ' + totMB + ' MB (' + percent + '%)';
    }
    return percent + '%';
  }

  function restoreSetupBtn(section) {
    var btn = document.getElementById('setup-' + section + '-btn');
    btn.style.display = '';
    btn.disabled = false;
    document.getElementById('setup-' + section + '-progress').classList.add('hidden');
  }

  // ── MCP Server settings ──
  async function initMcpSettings() {
    var masterToggle = document.getElementById('mcp-toggle-input');
    var statusDot = document.getElementById('mcp-status-dot');
    var categoriesDiv = document.getElementById('mcp-categories');
    var infoDiv = document.getElementById('mcp-info');
    var configJson = document.getElementById('mcp-config-json');
    var copyBtn = document.getElementById('mcp-copy-config');

    if (!masterToggle) return;

    // Fetch resolved paths and populate config snippet
    var clientConfig = await window.snip.getMcpClientConfig();
    var configStr = JSON.stringify(clientConfig, null, 2);
    if (configJson) configJson.textContent = configStr;

    // Copy button
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        navigator.clipboard.writeText(configStr).then(function () {
          var label = copyBtn.querySelector('.mcp-copy-label');
          if (label) {
            label.textContent = 'Copied!';
            setTimeout(function () { label.textContent = 'Copy'; }, 1500);
          }
        });
      });
    }

    function updateMcpUI(config) {
      masterToggle.checked = config.enabled;
      statusDot.className = 'status-dot ' + (config.enabled ? 'running' : 'stopped');
      categoriesDiv.classList.toggle('hidden', !config.enabled);
      infoDiv.classList.toggle('hidden', !config.enabled);

      document.querySelectorAll('.mcp-cat-toggle').forEach(function (toggle) {
        var cat = toggle.dataset.category;
        toggle.checked = config.categories[cat] !== false;
      });
    }

    // Load initial state
    var config = await window.snip.getMcpConfig();
    updateMcpUI(config);

    // Master toggle
    masterToggle.addEventListener('change', async function () {
      var result = await window.snip.setMcpConfig({ enabled: masterToggle.checked });
      updateMcpUI(result);
    });

    // Category toggles
    document.querySelectorAll('.mcp-cat-toggle').forEach(function (toggle) {
      toggle.addEventListener('change', async function () {
        var update = { categories: {} };
        update.categories[toggle.dataset.category] = toggle.checked;
        var result = await window.snip.setMcpConfig(update);
        updateMcpUI(result);
      });
    });

    // Listen for external changes
    if (window.snip.onMcpConfigChanged) {
      window.snip.onMcpConfigChanged(function (config) {
        updateMcpUI(config);
      });
    }
  }

  // ── CLI + AI Integration ──
  async function initCliSettings() {
    var installBtn = document.getElementById('install-cli-btn');
    var cliStatus = document.getElementById('cli-status');
    var aiProvidersDiv = document.getElementById('ai-providers');

    if (!installBtn) return;

    function showCliStatus(msg, isError) {
      cliStatus.textContent = msg;
      cliStatus.className = 'extensions-status visible' + (isError ? ' error' : '');
      setTimeout(function () { cliStatus.className = 'extensions-status'; }, 4000);
    }

    // Check CLI state: true = installed, 'stale' = broken wrapper, false = not installed
    var cliState = await window.snip.checkCliInstalled();

    function updateCliButton(state) {
      if (state === true) {
        installBtn.textContent = 'CLI Installed ✓';
        installBtn.className = 'install-cli-btn-installed';
        installBtn.title = 'Click to remove CLI';
      } else if (state === 'stale') {
        installBtn.textContent = 'Update CLI';
        installBtn.className = 'install-cli-btn-primary';
        installBtn.title = 'CLI path changed — click to fix';
        showCliStatus('CLI needs update — app path changed', true);
      } else {
        installBtn.textContent = 'Install CLI';
        installBtn.className = 'install-cli-btn-primary';
        installBtn.title = '';
      }
      if (state === true || state === 'stale') loadAiProviders();
    }

    updateCliButton(cliState);

    installBtn.addEventListener('click', async function () {
      if (cliState === true) {
        // Remove CLI
        await window.snip.uninstallCli();
        cliState = false;
        updateCliButton(false);
        showCliStatus('CLI removed', false);
        aiProvidersDiv.classList.add('hidden');
      } else {
        // Install or update CLI
        var result = await window.snip.installCli();
        if (result.error) {
          showCliStatus(result.error, true);
        } else {
          cliState = true;
          updateCliButton(true);
          var msg = 'Installed at ' + result.path;
          if (result.addToPath) msg += ' — add to your shell: ' + result.addToPath;
          showCliStatus(msg, !result.inPath);
        }
      }
    });

    async function loadAiProviders() {
      var providers = await window.snip.detectAiProviders();
      if (providers.length === 0) {
        aiProvidersDiv.classList.add('hidden');
        return;
      }

      aiProvidersDiv.classList.remove('hidden');
      aiProvidersDiv.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">Add Snip to your AI tools:</div>';

      var PROVIDER_FILES = {
        'claude-code': '~/.claude/CLAUDE.md',
        'cursor': '~/.cursor/rules/snip.mdc',
        'windsurf': '~/.windsurf/rules/snip.md',
        'cline': '~/.cline/rules/snip.md'
      };

      for (var pi = 0; pi < providers.length; pi++) {
        (async function (provider) {
          var row = document.createElement('div');
          row.className = 'ai-provider-row';

          var nameCol = document.createElement('div');
          nameCol.className = 'ai-provider-name';

          var nameText = document.createElement('span');
          nameText.textContent = provider.name;
          nameCol.appendChild(nameText);

          var statusText = document.createElement('span');
          statusText.className = 'ai-provider-status';
          nameCol.appendChild(statusText);

          var isConfigured = await window.snip.checkAiProviderStatus(provider.id);

          function updateStatus() {
            var file = PROVIDER_FILES[provider.id] || '';
            if (isConfigured) {
              statusText.textContent = 'Added to ' + file;
            } else {
              statusText.textContent = '';
            }
          }
          updateStatus();

          var btn = document.createElement('button');
          btn.className = 'ai-provider-btn' + (isConfigured ? ' configured' : '');
          btn.textContent = isConfigured ? 'Remove' : 'Configure';

          btn.addEventListener('click', async function () {
            if (isConfigured) {
              var result = await window.snip.removeAiProvider(provider.id);
              if (!result.error) {
                isConfigured = false;
                btn.textContent = 'Configure';
                btn.className = 'ai-provider-btn';
                updateStatus();
              } else {
                showCliStatus(result.error, true);
              }
            } else {
              var result = await window.snip.configureAiProvider(provider.id);
              if (result.configured) {
                isConfigured = true;
                btn.textContent = 'Remove';
                btn.className = 'ai-provider-btn configured';
                updateStatus();
              } else {
                showCliStatus(result.error, true);
              }
            }
          });

          row.appendChild(nameCol);
          row.appendChild(btn);
          aiProvidersDiv.appendChild(row);
        })(providers[pi]);
      }
    }
  }

  // ── Installed Extensions settings ──
  async function initExtensionsSettings() {
    var listEl = document.getElementById('extensions-list');
    var emptyEl = document.getElementById('extensions-empty');
    var statusEl = document.getElementById('extensions-status');
    var installBtn = document.getElementById('install-extension-btn');

    if (!listEl || !installBtn) return;

    function showStatus(msg, isError) {
      statusEl.textContent = msg;
      statusEl.className = 'extensions-status visible' + (isError ? ' error' : '');
      setTimeout(function () { statusEl.className = 'extensions-status'; }, 3000);
    }

    async function loadAndRender() {
      var extensions = await window.snip.getUserExtensions();
      listEl.innerHTML = '';

      if (extensions.length === 0) {
        listEl.style.display = 'none';
        emptyEl.style.display = '';
        return;
      }

      listEl.style.display = '';
      emptyEl.style.display = 'none';

      extensions.forEach(function (ext) {
        var row = document.createElement('div');
        row.className = 'extension-row';

        var name = document.createElement('span');
        name.className = 'extension-row-name';
        name.textContent = ext.displayName || ext.name;

        var type = document.createElement('span');
        type.className = 'extension-row-type';
        type.textContent = ext.type;

        var spacer = document.createElement('span');
        spacer.className = 'extension-row-spacer';

        var removeBtn = document.createElement('button');
        removeBtn.className = 'extension-row-remove';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', async function () {
          await window.snip.removeUserExtension(ext.name);
          showStatus('Removed ' + ext.name, false);
          loadAndRender();
        });

        row.appendChild(name);
        row.appendChild(type);
        if (ext.permissions && ext.permissions.length > 0) {
          var perms = document.createElement('span');
          perms.className = 'extension-row-type';
          perms.textContent = ext.permissions.join(', ');
          row.appendChild(perms);
        }
        row.appendChild(spacer);
        row.appendChild(removeBtn);
        listEl.appendChild(row);
      });
    }

    await loadAndRender();

    // Refresh when extensions are installed via MCP
    if (window.snip.onUserExtensionsChanged) {
      window.snip.onUserExtensionsChanged(function () { loadAndRender(); });
    }

    installBtn.addEventListener('click', async function () {
      var result = await window.snip.installExtensionFromFolder();
      if (result && result.error) {
        if (result.error !== 'Cancelled') showStatus(result.error, true);
        return;
      }
      if (result && result.installed) {
        showStatus('Installed ' + result.name, false);
        loadAndRender();
      }
    });
  }

  function initSetupOverlay() {
    var overlay = document.getElementById('setup-overlay');
    if (!overlay) return;

    var installBtn = document.getElementById('setup-install-btn');
    var modelBtn = document.getElementById('setup-model-btn');
    var skipBtn = document.getElementById('setup-skip-btn');

    // AI choice buttons
    var aiEnableBtn = document.getElementById('setup-ai-enable-btn');
    var aiSkipBtn = document.getElementById('setup-ai-skip-btn');

    aiEnableBtn.addEventListener('click', async function() {
      await window.snip.setAiEnabled(true);
      updateAiSettingsVisibility(true);
      applySetupStatus(await window.snip.getOllamaStatus());
    });

    aiSkipBtn.addEventListener('click', async function() {
      await window.snip.setAiEnabled(false);
      updateAiSettingsVisibility(false);
      hideSetupOverlay();
    });

    // Permission view buttons
    var permAllowBtn = document.getElementById('setup-perm-allow-btn');
    var permRestartDiv = document.getElementById('setup-perm-restart');
    var permDeniedDiv = document.getElementById('setup-perm-denied');
    var permSettingsBtn = document.getElementById('setup-perm-settings-btn');
    var permRestartBtn = document.getElementById('setup-perm-restart-btn');
    var permRestartBtn2 = document.getElementById('setup-perm-restart-btn2');
    var permSkipBtn = document.getElementById('setup-perm-skip-btn');

    permAllowBtn.addEventListener('click', handlePermissionAllow);

    permSettingsBtn.addEventListener('click', function() {
      window.snip.openExternalUrl('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    });

    var handleRestart = function() { window.snip.restartApp(); };
    permRestartBtn.addEventListener('click', handleRestart);
    permRestartBtn2.addEventListener('click', handleRestart);

    permSkipBtn.addEventListener('click', skipPermissionView);

    // Action buttons — both primary and retry share the same handler
    var installAction = function() { startSetupAction('install', installBtn, skipBtn, window.snip.installOllama); };
    var modelAction = function() { startSetupAction('model', modelBtn, skipBtn, window.snip.pullOllamaModel); };

    installBtn.addEventListener('click', installAction);
    document.getElementById('setup-install-retry').addEventListener('click', installAction);
    modelBtn.addEventListener('click', modelAction);
    document.getElementById('setup-model-retry').addEventListener('click', modelAction);

    // Dismiss buttons all hide the overlay
    var dismissBtns = [skipBtn, document.getElementById('setup-get-started'), document.getElementById('setup-continue-without')];
    for (var i = 0; i < dismissBtns.length; i++) {
      dismissBtns[i].addEventListener('click', hideSetupOverlay);
    }

    // Keyboard shortcuts for setup overlay
    document.addEventListener('keydown', function(e) {
      if (overlay.classList.contains('hidden')) return;

      // Permission screen — Enter to Allow (or Settings if denied), Esc to skip
      var permView = document.getElementById('setup-permission-view');
      if (permView && !permView.classList.contains('hidden')) {
        if (e.key === 'Escape') { skipPermissionView(); return; }
        if (e.key === 'Enter') {
          if (!permAllowBtn.classList.contains('hidden')) {
            permAllowBtn.click();
          } else if (!permRestartDiv.classList.contains('hidden')) {
            permRestartBtn.click();
          } else if (!permDeniedDiv.classList.contains('hidden')) {
            permSettingsBtn.click();
          }
          return;
        }
        return;
      }

      // AI choice screen — Y to enable, N to skip
      var aiChoiceView = document.getElementById('setup-ai-choice-view');
      if (aiChoiceView && !aiChoiceView.classList.contains('hidden')) {
        if (e.key === 'y' || e.key === 'Y') { aiEnableBtn.click(); return; }
        if (e.key === 'n' || e.key === 'N') { aiSkipBtn.click(); return; }
        if (e.key === 'Enter') { aiEnableBtn.click(); return; }
        return;
      }

      // Escape → skip / continue in background
      if (e.key === 'Escape') {
        hideSetupOverlay();
        return;
      }

      if (e.key !== 'Enter') return;

      // Welcome screen → dismiss
      var welcomeView = document.getElementById('setup-welcome-view');
      if (welcomeView && !welcomeView.classList.contains('hidden')) {
        hideSetupOverlay();
        return;
      }

      // Failed screen → try again
      var failedView = document.getElementById('setup-failed-view');
      if (failedView && !failedView.classList.contains('hidden')) {
        setupFailCount = 0;
        showSetupOverlay();
        return;
      }

      // Steps screen → click the visible, enabled action button
      if (!installBtn.disabled && installBtn.style.display !== 'none' &&
          !document.getElementById('setup-install-actions').classList.contains('hidden')) {
        installAction();
      } else if (!modelBtn.disabled && modelBtn.style.display !== 'none' &&
          !document.getElementById('setup-model-actions').classList.contains('hidden')) {
        modelAction();
      }
    });

    document.getElementById('setup-try-again').addEventListener('click', function() {
      setupFailCount = 0;
      showSetupOverlay();
    });

    // IPC progress listeners
    window.snip.onOllamaInstallProgress(function(progress) {
      if (overlay.classList.contains('hidden')) return;
      if (progress.status === 'done') { refreshSetupOverlay(); return; }
      if (progress.status === 'error') { handleSetupError('install', skipBtn, progress.error); return; }
      var percent = progress.percent || 0;
      updateSetupProgress('install', percent, INSTALL_LABELS[progress.status] || progress.status || 'Preparing...');
    });

    window.snip.onOllamaPullProgress(function(progress) {
      if (overlay.classList.contains('hidden')) return;
      if (progress.status === 'ready') { refreshSetupOverlay(); return; }
      if (progress.status === 'error') { handleSetupError('model', skipBtn, progress.error); return; }
      if (progress.status === 'idle') return;
      var percent = progress.percent || 0;
      updateSetupProgress('model', percent, formatPullDetail(progress));
    });

    window.snip.onOllamaStatusChanged(function() { refreshSetupOverlay(); });

    if (window.snip.onShowSetupOverlay) {
      window.snip.onShowSetupOverlay(function() {
        // Don't override the AI choice view if it's showing
        var aiChoiceView = document.getElementById('setup-ai-choice-view');
        if (aiChoiceView && !aiChoiceView.classList.contains('hidden')) return;
        showSetupOverlay();
      });
    }

    window._showSetupOverlay = function() {
      setupFromSettings = true;
      showSetupOverlay();
    };

    checkAndShowSetup();
  }

  async function checkAndShowSetup() {
    var aiEnabled = await window.snip.getAiEnabled();

    // Sync toggle to current state
    updateAiSettingsVisibility(aiEnabled === true ? true : false);

    // First launch — check permission first, then AI choice
    if (aiEnabled === undefined || aiEnabled === null) {
      var permStatus = await window.snip.getScreenPermission();
      document.getElementById('setup-overlay').classList.remove('hidden');
      if (permStatus !== 'granted') {
        showSetupView('permission');
        applyPermissionState(permStatus);
      } else {
        showSetupView('ai-choice');
      }
      return;
    }

    // AI disabled or already enabled — no overlay on launch.
    // User can manage setup from Settings if needed.
    return;
  }

  var PERM_DESC = {
    'default': 'Snip needs Screen Recording access to capture your screen.',
    'restart': 'Snip needs Screen Recording access to capture your screen.',
    'denied': 'Snip needs Screen Recording access to capture your screen.'
  };
  var PERM_DESC_SUB = {
    'restart': 'Restart is needed for the permission to take effect.',
    'denied': 'Enable Snip in System Settings, then restart.'
  };

  function setPermDesc(key) {
    var desc = document.getElementById('setup-perm-desc');
    desc.textContent = '';
    desc.appendChild(document.createTextNode(PERM_DESC[key]));
    if (PERM_DESC_SUB[key]) {
      desc.appendChild(document.createElement('br'));
      desc.appendChild(document.createTextNode(PERM_DESC_SUB[key]));
    }
  }

  function applyPermissionState(status) {
    var allowBtn = document.getElementById('setup-perm-allow-btn');
    var restartDiv = document.getElementById('setup-perm-restart');
    var deniedDiv = document.getElementById('setup-perm-denied');

    allowBtn.classList.add('hidden');
    restartDiv.classList.add('hidden');
    deniedDiv.classList.add('hidden');

    if (status === 'denied') {
      setPermDesc('denied');
      deniedDiv.classList.remove('hidden');
    } else {
      // not-determined or any other state — show Allow button
      setPermDesc('default');
      allowBtn.classList.remove('hidden');
    }
  }

  async function handlePermissionAllow() {
    var allowBtn = document.getElementById('setup-perm-allow-btn');
    allowBtn.disabled = true;
    var result = await window.snip.requestScreenPermission();
    allowBtn.disabled = false;

    if (result === 'granted') {
      // Permission granted but needs restart to take effect
      allowBtn.classList.add('hidden');
      document.getElementById('setup-perm-denied').classList.add('hidden');
      document.getElementById('setup-perm-restart').classList.remove('hidden');
      setPermDesc('restart');
    } else {
      // User denied — show Settings + Restart
      applyPermissionState('denied');
    }
  }

  function skipPermissionView() {
    // Dismiss overlay entirely — reactive dialog in capturer.js handles permission later
    hideSetupOverlay();
  }

  async function showSetupOverlay() {
    document.getElementById('setup-overlay').classList.remove('hidden');
    // When opened from Settings, set aiEnabled=true and skip choice view
    if (setupFromSettings) {
      await window.snip.setAiEnabled(true);
      updateAiSettingsVisibility(true);
    }
    try {
      applySetupStatus(await window.snip.getOllamaStatus());
    } catch (err) {
      applySetupScreen('install', FALLBACK_STATUS);
    }
  }

  function hideSetupOverlay() {
    document.getElementById('setup-overlay').classList.add('hidden');
    stopSparkles();
    setupFromSettings = false;
  }

  async function refreshSetupOverlay() {
    if (document.getElementById('setup-overlay').classList.contains('hidden')) return;
    try {
      applySetupStatus(await window.snip.getOllamaStatus());
    } catch (err) { /* ignore */ }
  }

  function determineSetupScreen(status) {
    if (!status.installed) return 'install';
    if (!status.running) return 'running';
    if (!status.modelReady) return 'model';
    return null;
  }

  function showSetupView(viewName) {
    var views = { permission: 'setup-permission-view', 'ai-choice': 'setup-ai-choice-view', steps: 'setup-steps-view', welcome: 'setup-welcome-view', failed: 'setup-failed-view' };
    var keys = Object.keys(views);
    for (var i = 0; i < keys.length; i++) {
      document.getElementById(views[keys[i]]).classList.add('hidden');
    }

    if (viewName === 'welcome') {
      document.getElementById(views.welcome).classList.remove('hidden');
      var welcomeTitle = document.querySelector('.setup-welcome-title');
      if (welcomeTitle) {
        welcomeTitle.textContent = setupFromSettings ? 'Your AI assistant is ready!' : 'Welcome to Snip';
      }
      startSparkles();
    } else if (viewName === 'failed') {
      document.getElementById(views.failed).classList.remove('hidden');
      stopSparkles();
    } else if (viewName === 'ai-choice') {
      document.getElementById(views['ai-choice']).classList.remove('hidden');
      startSparkles();
    } else if (viewName === 'permission') {
      document.getElementById(views.permission).classList.remove('hidden');
      startSparkles();
    } else {
      document.getElementById(views.steps).classList.remove('hidden');
      startSparkles();
    }
  }

  function applySetupScreen(screen, status) {
    showSetupView('steps');

    var indicators = [
      { id: 'setup-ind-install', done: status.installed },
      { id: 'setup-ind-running', done: status.running },
      { id: 'setup-ind-model', done: status.modelReady }
    ];
    var sections = ['install', 'running', 'model'];

    // Reset all indicators and hide all action areas
    for (var i = 0; i < indicators.length; i++) {
      document.getElementById(indicators[i].id).className = indicators[i].done ? 'setup-card-ind done' : 'setup-card-ind';
      document.getElementById('setup-' + sections[i] + '-actions').classList.add('hidden');
    }

    var skipBtn = document.getElementById('setup-skip-btn');

    if (screen === 'install') {
      document.getElementById('setup-ind-install').className = 'setup-card-ind active';
      document.getElementById('setup-install-actions').classList.remove('hidden');
      if (status.installing) {
        document.getElementById('setup-install-btn').style.display = 'none';
        document.getElementById('setup-install-progress').classList.remove('hidden');
        if (status.installProgress) {
          var ip = status.installProgress;
          updateSetupProgress('install', ip.percent || 0, INSTALL_LABELS[ip.status] || ip.status || 'Preparing...');
        }
      } else {
        restoreSetupBtn('install');
      }
    } else if (screen === 'running') {
      document.getElementById('setup-ind-install').className = 'setup-card-ind done';
      document.getElementById('setup-ind-running').className = 'setup-card-ind active';
      document.getElementById('setup-running-actions').classList.remove('hidden');
    } else if (screen === 'model') {
      document.getElementById('setup-ind-install').className = 'setup-card-ind done';
      document.getElementById('setup-ind-running').className = 'setup-card-ind done';
      document.getElementById('setup-ind-model').className = 'setup-card-ind active';
      document.getElementById('setup-model-actions').classList.remove('hidden');
      if (status.pulling) {
        document.getElementById('setup-model-btn').style.display = 'none';
        document.getElementById('setup-model-progress').classList.remove('hidden');
        if (status.pullProgress) {
          updateSetupProgress('model', status.pullProgress.percent || 0, formatPullDetail(status.pullProgress));
        }
      } else {
        restoreSetupBtn('model');
      }
    }

    skipBtn.textContent = (status.installing || status.pulling) ? 'Continue in background' : 'Skip for now';
  }

  function friendlyError(raw) {
    if (!raw) return 'Something went wrong. Please try again.';
    var lower = raw.toLowerCase();
    if (lower.indexOf('fetch failed') !== -1 || lower.indexOf('econnrefused') !== -1) return 'Could not connect to Ollama. It may have stopped — try again to reconnect.';
    if (lower.indexOf('terminated') !== -1) return 'Connection to Ollama was interrupted. Try again to reconnect.';
    if (lower.indexOf('network') !== -1 || lower.indexOf('etimedout') !== -1 || lower.indexOf('enotfound') !== -1) return 'Network error. Check your internet connection and try again.';
    if (lower.indexOf('not running') !== -1 || lower.indexOf('not installed') !== -1) return raw;
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  function showSetupError(section, message) {
    var errorDiv = document.getElementById('setup-' + section + '-error');
    var errorText = document.getElementById('setup-' + section + '-error-text');
    if (errorDiv) {
      errorText.textContent = message;
      errorDiv.classList.remove('hidden');
    }
  }

  function hideSetupError(section) {
    var errorDiv = document.getElementById('setup-' + section + '-error');
    if (errorDiv) errorDiv.classList.add('hidden');
  }

  // Sparkle system
  function createSparkle() {
    var sparkles = document.getElementById('setup-sparkles');
    if (!sparkles) return;
    var particle = document.createElement('div');
    particle.className = 'setup-sparkle';

    var size = 4 + Math.random() * 8;
    var x = Math.random() * 100;
    var y = 50 + Math.random() * 50;
    var duration = 1.5 + Math.random() * 2;
    var delay = Math.random() * 0.3;

    particle.style.width = size + 'px';
    particle.style.height = size + 'px';
    particle.style.left = x + '%';
    particle.style.top = y + '%';
    particle.style.animationDuration = duration + 's';
    particle.style.animationDelay = delay + 's';

    if (Math.random() > 0.5) {
      particle.classList.add('setup-sparkle-star');
    }

    sparkles.appendChild(particle);

    setTimeout(function() {
      if (particle.parentNode) particle.parentNode.removeChild(particle);
    }, (duration + delay) * 1000 + 100);
  }

  function startSparkles() {
    stopSparkles();
    sparkleInterval = setInterval(createSparkle, 400);
  }

  function stopSparkles() {
    if (sparkleInterval) {
      clearInterval(sparkleInterval);
      sparkleInterval = null;
    }
    var sparkles = document.getElementById('setup-sparkles');
    if (sparkles) sparkles.innerHTML = '';
  }

  function burstSparkles(count) {
    for (var i = 0; i < count; i++) {
      createSparkle();
    }
  }

  // Helpers
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  init();
})();
