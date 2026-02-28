const { Tray, Menu, app, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const { getTheme, setTheme } = require('./store');

let tray = null;

function createTray(captureCallback, searchCallback, homeCallback) {
  // Create a simple 16x16 tray icon programmatically
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

  const currentTheme = getTheme();

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Snip It',
      accelerator: 'CmdOrCtrl+Shift+2',
      click: captureCallback
    },
    {
      label: 'Search Snips',
      accelerator: 'CmdOrCtrl+Shift+F',
      click: searchCallback
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
      click: homeCallback
    },
    { type: 'separator' },
    {
      label: 'Quit Snip',
      accelerator: 'CmdOrCtrl+Q',
      click: () => app.quit()
    }
  ]);

  tray.setToolTip('Snip');
  tray.setContextMenu(contextMenu);

  // Set title for menubar (shows text next to icon)
  tray.setTitle('');

  return tray;
}

function broadcastTheme(theme) {
  setTheme(theme);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('theme-changed', theme);
    }
  }
}

module.exports = { createTray };
