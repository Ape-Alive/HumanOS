'use strict';

const { BrowserWindow, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { isWinFrameless, attachWindowChromeEvents } = require('./windowChromeIpc.js');

const useDevServer = process.env.ELECTRON_USE_DEV_SERVER === '1';
const DEV_URL = 'http://127.0.0.1:5173';

function resolveWindowIcon() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.svg'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img;
  }
  return undefined;
}

const windowIcon = resolveWindowIcon();

/** @type {import('electron').BrowserWindow | null} */
let mainWindowRef = null;

function createMainWindow() {
  const winFrameless = isWinFrameless();
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: windowIcon,
    frame: !winFrameless,
    autoHideMenuBar: winFrameless,
    backgroundColor: '#0c1220',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (winFrameless) {
    Menu.setApplicationMenu(null);
    win.setMenuBarVisibility(false);
    attachWindowChromeEvents(win);
  }

  if (useDevServer) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindowRef = win;
  win.on('closed', () => {
    if (mainWindowRef === win) mainWindowRef = null;
  });

  return win;
}

function getMainWindow() {
  return mainWindowRef;
}

module.exports = { createMainWindow, getMainWindow };
