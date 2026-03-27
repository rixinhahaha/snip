const CHECK_DELAY_MS = 10000;
const RECHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

var timeoutHandle = null;
var intervalHandle = null;
var updaterRef = null;
var isDownloading = false;
var pendingInstall = false;

function initAutoUpdater() {
  timeoutHandle = setTimeout(function () {
    timeoutHandle = null;
    try {
      var { autoUpdater } = require('electron-updater');
      updaterRef = autoUpdater;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.allowDowngrade = false;
      autoUpdater.logger = null; // suppress default logging

      autoUpdater.on('update-available', function (info) {
        console.log('[AutoUpdate] Update available:', info.version, '— downloading automatically');
        isDownloading = true;
      });

      autoUpdater.on('update-not-available', function () {
        console.log('[AutoUpdate] Up to date');
      });

      autoUpdater.on('update-downloaded', function (info) {
        console.log('[AutoUpdate] Downloaded:', info.version, '— will install on quit');
        isDownloading = false;
        pendingInstall = true;
      });

      autoUpdater.on('error', function (err) {
        console.error('[AutoUpdate] Error:', err.message);
        isDownloading = false;
      });

      autoUpdater.checkForUpdates();

      // Periodic re-check for long-running tray app
      intervalHandle = setInterval(function () {
        if (!isDownloading) {
          try { autoUpdater.checkForUpdates(); } catch (err) {
            console.error('[AutoUpdate] Check failed:', err.message);
          }
        }
      }, RECHECK_INTERVAL_MS);
    } catch (err) {
      console.warn('[AutoUpdate] Not available:', err.message);
    }
  }, CHECK_DELAY_MS);
}

function isPendingInstall() {
  return pendingInstall;
}

function cancelAutoUpdater() {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (updaterRef) {
    updaterRef.removeAllListeners();
    updaterRef = null;
  }
}

module.exports = { initAutoUpdater, cancelAutoUpdater, isPendingInstall };
