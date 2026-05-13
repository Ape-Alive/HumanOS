'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('humanos', {
  getDefaultSignalUrl: () => ipcRenderer.invoke('app:get-default-signal-url'),
  getInviteSignalHint: () => ipcRenderer.invoke('app:get-invite-signal-hint'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  inputDispatch: (cmd) => ipcRenderer.invoke('input:dispatch', cmd),
  getPrimaryScreenSourceId: () => ipcRenderer.invoke('screen:get-primary-source-id'),
});
