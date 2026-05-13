'use strict';

const { BrowserWindow } = require('electron');
const path = require('path');

const useDevServer = process.env.ELECTRON_USE_DEV_SERVER === '1';
const DEV_URL = 'http://127.0.0.1:5173';

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (useDevServer) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  return win;
}

module.exports = { createMainWindow };
