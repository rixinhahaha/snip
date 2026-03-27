const { Tray, Menu, app, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const platform = require('./platform');
const { getTheme, setTheme, getShortcuts } = require('./store');

let tray = null;
let trayCallbacks = { capture: null, search: null, home: null, quickSnip: null };

function buildTrayMenu() {
  const currentTheme = getTheme();
  const shortcuts = getShortcuts();

  const captureAccel = (shortcuts['capture'] || '').replace('CommandOrControl', 'CmdOrCtrl');
  const searchAccel = (shortcuts['search'] || '').replace('CommandOrControl', 'CmdOrCtrl');
  const quickSnipAccel = (shortcuts['quick-snip'] || '').replace('CommandOrControl', 'CmdOrCtrl');

  const template = [
    {
      label: 'Quick Snip',
      click: trayCallbacks.quickSnip
    },
    {
      label: 'Snip and Annotate',
      click: trayCallbacks.capture
    },
    {
      label: 'Search Snips',
      click: trayCallbacks.search
    },
    { type: 'separator' },
    {
      label: 'Theme',
      submenu: [
        {
          label: 'Dark',
          type: 'radio',
          checked: currentTheme === 'dark',
          click: () => broadcastTheme('dark')
        },
        {
          label: 'Light',
          type: 'radio',
          checked: currentTheme === 'light',
          click: () => broadcastTheme('light')
        },
      ]
    },
    { type: 'separator' },
    {
      label: 'Open Snip',
      click: trayCallbacks.home
    },
    { type: 'separator' },
    {
      label: 'Quit Snip',
      accelerator: 'CmdOrCtrl+Q',
      click: () => app.quit()
    }
  ];

  // Add accelerators only if valid (avoid crashing on malformed config)
  if (quickSnipAccel) template[0].accelerator = quickSnipAccel;
  if (captureAccel) template[1].accelerator = captureAccel;
  if (searchAccel) template[2].accelerator = searchAccel;

  try {
    const contextMenu = Menu.buildFromTemplate(template);
    tray.setContextMenu(contextMenu);
  } catch (err) {
    console.error('[Snip] Failed to build tray menu, retrying without accelerators:', err);
    delete template[0].accelerator;
    delete template[1].accelerator;
    delete template[2].accelerator;
    const contextMenu = Menu.buildFromTemplate(template);
    tray.setContextMenu(contextMenu);
  }
}

function createTray(captureCallback, searchCallback, homeCallback, quickSnipCallback) {
  var iconConfig = platform.getTrayIcon();
  const iconPath = path.join(__dirname, '..', '..', 'assets', iconConfig.file);

  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('Empty icon');
    if (iconConfig.resize) {
      trayIcon = trayIcon.resize({ width: iconConfig.resize, height: iconConfig.resize });
    }
  } catch (e) {
    console.warn('[Snip] Tray icon not found at', iconPath, '— tray menu still accessible via menubar.');
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  trayCallbacks.capture = captureCallback;
  trayCallbacks.search = searchCallback;
  trayCallbacks.home = homeCallback;
  trayCallbacks.quickSnip = quickSnipCallback;

  buildTrayMenu();

  tray.setToolTip('Snip');
  tray.setTitle('');

  return tray;
}

function rebuildTrayMenu() {
  if (tray && !tray.isDestroyed()) {
    buildTrayMenu();
  }
}

function broadcastTheme(theme) {
  setTheme(theme);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('theme-changed', theme);
    }
  }
}

module.exports = { createTray, rebuildTrayMenu };
