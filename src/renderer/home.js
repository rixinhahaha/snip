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

  let screenshotsDir = '';
  let currentSubdir = ''; // relative path within screenshots dir

  // ── Navigation ──
  let searchInitialized = false;

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

  // Listen for navigate-to-search IPC (from Cmd+Shift+F or tray)
  if (window.snip.onNavigateToSearch) {
    window.snip.onNavigateToSearch(function() {
      switchToPage('search');
      var input = document.getElementById('search-input');
      if (input) input.focus();
    });
  }

  // ── Screenshots page ──
  async function init() {
    screenshotsDir = await window.snip.getScreenshotsDir();
    loadFolder('');
    initOllamaSettings();
    initAnimationSettings();
    loadTags();
    initThemeToggle();
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
          '</div>' +
          '<div class="file-name">' + escapeHtml(item.name) + '</div>';
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

  document.getElementById('btn-refresh').addEventListener('click', function() {
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

  // ── Settings: AI Assistant (Ollama) ──

  // Static specs for model info tooltip
  var MODEL_SPECS = {
    'minicpm-v': { params: '8B', size: '~5.1 GB', quant: 'Q4_K_M', description: 'Best balance of accuracy and speed for screenshot analysis.' }
  };

  async function initOllamaSettings() {
    // Setup info tooltip toggle (click to show, click-outside to dismiss)
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

    // Listen for model download progress push events
    if (window.snip.onOllamaPullProgress) {
      window.snip.onOllamaPullProgress(function(progress) {
        updateDownloadProgress(progress);
      });
    }

    // Initial status refresh
    refreshOllamaStatus();
  }

  async function refreshOllamaStatus() {
    var dot = document.getElementById('ollama-status-dot');
    var text = document.getElementById('ollama-status-text');

    var config = await window.snip.getOllamaConfig();
    var modelName = config.model || 'minicpm-v';

    try {
      var status = await window.snip.getOllamaStatus();
      if (status.running && status.modelReady) {
        dot.className = 'status-dot running';
        text.textContent = 'Running';
        hideDownloadProgress();
      } else if (status.pulling) {
        dot.className = 'status-dot stopped';
        text.textContent = 'Downloading model...';
        updateDownloadProgress(status.pullProgress);
        setTimeout(refreshOllamaStatus, 3000);
      } else if (status.running && !status.modelReady) {
        dot.className = 'status-dot stopped';
        text.textContent = 'Preparing model...';
        setTimeout(refreshOllamaStatus, 3000);
      } else {
        dot.className = 'status-dot stopped';
        text.textContent = status.error ? 'Starting... (' + status.error + ')' : 'Starting...';
        // Retry in a few seconds (server may still be booting)
        setTimeout(refreshOllamaStatus, 3000);
      }
    } catch (err) {
      dot.className = 'status-dot stopped';
      text.textContent = 'Error: ' + err.message;
    }

    updateCurrentModelCard(modelName);
  }

  function updateDownloadProgress(progress) {
    var section = document.getElementById('model-download-section');
    var bar = document.getElementById('model-download-bar');
    var detail = document.getElementById('model-download-detail');

    if (!section) return;

    if (progress.status === 'ready') {
      hideDownloadProgress();
      var dot = document.getElementById('ollama-status-dot');
      var text = document.getElementById('ollama-status-text');
      if (dot) dot.className = 'status-dot running';
      if (text) text.textContent = 'Running';
      return;
    }

    if (progress.status === 'error') {
      section.classList.remove('hidden');
      bar.style.width = '0%';
      detail.textContent = 'Download failed: ' + (progress.error || 'unknown error');
      return;
    }

    if (progress.status === 'idle') return;

    // Show download progress
    section.classList.remove('hidden');
    bar.style.width = progress.percent + '%';

    if (progress.total > 0) {
      var downloadedMB = (progress.completed / (1024 * 1024)).toFixed(0);
      var totalMB = (progress.total / (1024 * 1024)).toFixed(0);
      detail.textContent = progress.status + ' — ' + downloadedMB + ' / ' + totalMB + ' MB (' + progress.percent + '%)';
    } else {
      detail.textContent = progress.status || 'Preparing...';
    }
  }

  function hideDownloadProgress() {
    var section = document.getElementById('model-download-section');
    if (section) section.classList.add('hidden');
  }

  function updateCurrentModelCard(modelName) {
    var nameEl = document.getElementById('current-model-name');
    nameEl.textContent = modelName;

    var specs = MODEL_SPECS[modelName] || { params: '—', size: '—', quant: '—', description: 'Custom model' };
    document.getElementById('info-model').textContent = modelName;
    document.getElementById('info-params').textContent = specs.params;
    document.getElementById('info-size').textContent = specs.size;
    document.getElementById('info-quant').textContent = specs.quant;
    document.getElementById('info-desc').textContent = specs.description;
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

  async function displaySearchResults(items) {
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
      var item = items[i];
      var card = document.createElement('div');
      card.className = 'search-result-card';
      (function(itemRef) {
        card.addEventListener('click', function() {
          window.snip.revealInFinder(itemRef.path);
        });
      })(item);

      var img = document.createElement('img');
      img.className = 'search-result-thumbnail';
      img.alt = item.name || item.filename;
      var thumbURL = await window.snip.getThumbnail(item.path);
      img.src = thumbURL || '';

      var info = document.createElement('div');
      info.className = 'search-result-info';

      var name = document.createElement('div');
      name.className = 'search-result-name';
      name.textContent = item.name || item.filename;

      var filename = document.createElement('div');
      filename.className = 'search-result-filename';
      filename.textContent = item.filename || '';

      var meta = document.createElement('div');
      meta.className = 'search-result-meta';

      var category = document.createElement('span');
      category.className = 'search-result-category';
      category.textContent = item.category || 'uncategorized';
      meta.appendChild(category);

      if (item.score !== undefined) {
        var score = document.createElement('span');
        score.className = 'search-result-score';
        score.textContent = (item.score * 100).toFixed(0) + '%';
        meta.appendChild(score);
      }

      info.appendChild(name);
      if (item.filename) info.appendChild(filename);
      info.appendChild(meta);

      card.appendChild(img);
      card.appendChild(info);
      grid.appendChild(card);
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
