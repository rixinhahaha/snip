const { Tray, Menu, app, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const { getTheme, setTheme, getShortcuts } = require('./store');

let tray = null;
let trayCallbacks = { capture: null, search: null, home: null };

function buildTrayMenu() {
  const currentTheme = getTheme();
  const shortcuts = getShortcuts();

  const captureAccel = (shortcuts['capture'] || '').replace('CommandOrControl', 'CmdOrCtrl');
  const searchAccel = (shortcuts['search'] || '').replace('CommandOrControl', 'CmdOrCtrl');

  const template = [
    {
      label: 'Snip It',
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
        {
          label: 'Glass',
          type: 'radio',
          checked: currentTheme === 'glass',
          click: () => broadcastTheme('glass')
        }
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
  if (captureAccel) template[0].accelerator = captureAccel;
  if (searchAccel) template[1].accelerator = searchAccel;

  try {
    const contextMenu = Menu.buildFromTemplate(template);
    tray.setContextMenu(contextMenu);
  } catch (err) {
    console.error('[Snip] Failed to build tray menu, retrying without accelerators:', err);
    delete template[0].accelerator;
    delete template[1].accelerator;
    const contextMenu = Menu.buildFromTemplate(template);
    tray.setContextMenu(contextMenu);
  }
}

function createTray(captureCallback, searchCallback, homeCallback) {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray-iconTemplate.png');

  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('Empty icon');
  } catch (e) {
    console.warn('[Snip] Tray icon not found at', iconPath, '— tray menu still accessible via menubar.');
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  trayCallbacks.capture = captureCallback;
  trayCallbacks.search = searchCallback;
  trayCallbacks.home = homeCallback;

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
