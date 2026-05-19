'use strict';

const { ipcMain, BrowserWindow } = require('electron');

/** @type {() => import('electron').BrowserWindow | null} */
let getMainWindow = () => null;

/**
 * @param {() => import('electron').BrowserWindow | null} getter
 */
function setMainWindowGetter(getter) {
  getMainWindow = getter;
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerWindowChromeIpc() {
  ipcMain.handle('window-chrome:is-frameless', () => process.platform === 'win32');

  ipcMain.handle('window-chrome:minimize', (event) => {
    const win = windowFromEvent(event) || getMainWindow();
    win?.minimize();
    return { ok: true };
  });

  ipcMain.handle('window-chrome:maximize', (event) => {
    const win = windowFromEvent(event) || getMainWindow();
    if (!win) return { ok: false };
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return { ok: true, maximized: win.isMaximized() };
  });

  ipcMain.handle('window-chrome:close', (event) => {
    const win = windowFromEvent(event) || getMainWindow();
    win?.close();
    return { ok: true };
  });

  ipcMain.handle('window-chrome:is-maximized', (event) => {
    const win = windowFromEvent(event) || getMainWindow();
    return { maximized: !!win?.isMaximized() };
  });
}

/**
 * @param {import('electron').BrowserWindow} win
 */
function attachWindowChromeEvents(win) {
  const send = (maximized) => {
    if (!win.isDestroyed()) win.webContents.send('window-chrome:maximized-changed', maximized);
  };
  win.on('maximize', () => send(true));
  win.on('unmaximize', () => send(false));
}

module.exports = {
  registerWindowChromeIpc,
  setMainWindowGetter,
  attachWindowChromeEvents,
  isWinFrameless: () => process.platform === 'win32',
};
