'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('humanos', {
  getDefaultSignalUrl: () => ipcRenderer.invoke('app:get-default-signal-url'),
  getInviteSignalHint: () => ipcRenderer.invoke('app:get-invite-signal-hint'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  inputDispatch: (cmd) => ipcRenderer.invoke('input:dispatch', cmd),
  getPrimaryScreenSourceId: () => ipcRenderer.invoke('screen:get-primary-source-id'),
  getPrimaryDisplaySpec: () => ipcRenderer.invoke('screen:get-primary-display-spec'),
  /** AI 大模型 HTTP：主进程代发，绕过渲染进程 CORS（第三方网关常见未放行浏览器源） */
  aiHttpPost: (payload) => ipcRenderer.invoke('ai:http-post', payload),
  aiHttpAbort: (payload) => ipcRenderer.invoke('ai:http-abort', payload),
  agentDb: {
    taskCreate: (payload) => ipcRenderer.invoke('agent-db:task-create', payload),
    taskUpdateStatus: (payload) => ipcRenderer.invoke('agent-db:task-update-status', payload),
    logAppend: (payload) => ipcRenderer.invoke('agent-db:log-append', payload),
    screenshotSave: (payload) => ipcRenderer.invoke('agent-db:screenshot-save', payload),
    resultSave: (payload) => ipcRenderer.invoke('agent-db:result-save', payload),
    listRecentTasks: (payload) => ipcRenderer.invoke('agent-db:list-recent-tasks', payload),
    getLogs: (payload) => ipcRenderer.invoke('agent-db:get-logs', payload),
  },
  saveMarkdownReport: (payload) => ipcRenderer.invoke('report:save-markdown', payload),
});
