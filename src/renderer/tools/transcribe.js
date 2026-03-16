/* global ToolUtils */
/* exported TranscribeTool */

var TranscribeTool = (function() {
  'use strict';

  var transcriptData = null;
  var isTranscribing = false;
  var els = {};

  function init() {
    els.panel = document.getElementById('transcript-panel');
    els.loading = document.getElementById('transcript-loading');
    els.language = document.getElementById('transcript-language');
    els.text = document.getElementById('transcript-text');
    els.actions = document.getElementById('transcript-actions');
    els.empty = document.getElementById('transcript-empty');
    els.error = document.getElementById('transcript-error');
    els.errorText = document.getElementById('transcript-error-text');

    var btn = document.getElementById('tool-transcribe');
    if (btn) {
      btn.addEventListener('click', function() {
        if (isTranscribing) return;
        if (els.panel && !els.panel.classList.contains('hidden')) {
          hidePanel();
          return;
        }
        startTranscription();
      });
    }

    var closeBtn = document.getElementById('transcript-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', hidePanel);
    }

    var copyBtn = document.getElementById('transcript-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', copyText);
    }
  }

  function startTranscription() {
    if (transcriptData) {
      if (!transcriptData.text || transcriptData.text.trim() === '') {
        showEmpty();
      } else {
        showResults(transcriptData);
      }
      showPanel();
      return;
    }

    isTranscribing = true;
    showLoading();
    showPanel();

    window.snip.transcribeScreenshot().then(function(result) {
      isTranscribing = false;
      if (result.success) {
        transcriptData = { languages: result.languages, text: result.text };
        if (!result.text || result.text.trim() === '') {
          showEmpty();
        } else {
          showResults(transcriptData);
        }
      } else {
        showError(result.error);
      }
    }).catch(function(err) {
      isTranscribing = false;
      showError(err.message || 'Transcription failed');
    });
  }

  function showPanel() {
    if (els.panel) els.panel.classList.remove('hidden');
  }

  function hidePanel() {
    if (els.panel) els.panel.classList.add('hidden');
  }

  function showLoading() {
    els.loading.classList.remove('hidden');
    els.language.innerHTML = '';
    els.text.textContent = '';
    els.actions.classList.add('hidden');
    els.empty.classList.add('hidden');
    els.error.classList.add('hidden');
  }

  function showResults(data) {
    els.loading.classList.add('hidden');
    els.empty.classList.add('hidden');
    els.error.classList.add('hidden');
    var langs = data.languages.slice(0, 3);
    els.language.innerHTML = '';
    langs.forEach(function(lang) {
      var pill = document.createElement('span');
      pill.className = 'transcript-lang-pill';
      pill.textContent = lang;
      els.language.appendChild(pill);
    });
    els.text.textContent = data.text.replace(/\n{3,}/g, '\n\n').trim();
    els.actions.classList.remove('hidden');
  }

  function showEmpty() {
    els.loading.classList.add('hidden');
    els.error.classList.add('hidden');
    els.actions.classList.add('hidden');
    els.language.innerHTML = '';
    els.text.textContent = '';
    els.empty.classList.remove('hidden');
  }

  function showError(msg) {
    els.loading.classList.add('hidden');
    els.empty.classList.add('hidden');
    els.actions.classList.add('hidden');
    els.language.innerHTML = '';
    els.text.textContent = '';

    els.errorText.textContent = msg;
    els.error.classList.remove('hidden');
  }

  function isActive() {
    return els.panel && !els.panel.classList.contains('hidden');
  }

  function dismiss() {
    hidePanel();
  }

  function copyText() {
    if (transcriptData && transcriptData.text) {
      navigator.clipboard.writeText(transcriptData.text).then(function() {
        ToolUtils.showToast('Text copied to clipboard', 'success', 2000);
      }).catch(function() {
        ToolUtils.showToast('Failed to copy text', 'error', 2000);
      });
    }
  }

  return {
    init: init,
    isActive: isActive,
    dismiss: dismiss,
    copyText: copyText
  };
})();
