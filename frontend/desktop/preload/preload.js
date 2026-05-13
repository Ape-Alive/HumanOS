'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('humanos', {
  getDefaultSignalUrl: () => ipcRenderer.invoke('app:get-default-signal-url'),
  getInviteSignalHint: () => ipcRenderer.invoke('app:get-invite-signal-hint'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  inputDispatch: (cmd) => ipcRenderer.invoke('input:dispatch', cmd),
  getPrimaryScreenSourceId: () => ipcRenderer.invoke('screen:get-primary-source-id'),
  /** 主进程从 HUMANOS_ICE_SERVERS 读取的额外 ICE（如 TURN） */
  getRtcIceServers: () => ipcRenderer.invoke('app:get-rtc-ice-servers'),
});
