'use strict';

const { ipcMain, app } = require('electron');
const repo = require('./repository.js');

function registerAgentDbIpc() {
  ipcMain.handle('agent-db:task-create', async (_e, payload) => {
    try {
      return await repo.taskCreate(payload || {});
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('agent-db:task-update-status', async (_e, payload) => {
    try {
      return await repo.taskUpdateStatus(payload || {});
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('agent-db:log-append', async (_e, payload) => {
    try {
      return await repo.logAppend(payload || {});
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('agent-db:screenshot-save', async (_e, payload) => {
    try {
      const p = payload || {};
      const b64 = typeof p.base64 === 'string' ? p.base64.replace(/\s/g, '') : '';
      if (!b64) return { ok: false, error: 'empty-base64' };
      const buf = Buffer.from(b64, 'base64');
      return await repo.screenshotSave({
        taskId: p.taskId,
        roundIndex: p.roundIndex,
        seq: p.seq,
        label: p.label,
        mime: p.mime || 'image/jpeg',
        width: p.width,
        height: p.height,
        videoW: p.videoW,
        videoH: p.videoH,
        buffer: buf,
      });
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('agent-db:result-save', async (_e, payload) => {
    try {
      return await repo.resultSave(payload || {});
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('agent-db:list-recent-tasks', async (_e, payload) => {
    try {
      return await repo.listRecentTasks(payload || {});
    } catch (e) {
      return { ok: false, error: String(e?.message || e), tasks: [] };
    }
  });

  ipcMain.handle('agent-db:get-logs', async (_e, payload) => {
    try {
      return await repo.getLogsForTask(payload || {});
    } catch (e) {
      return { ok: false, error: String(e?.message || e), logs: [] };
    }
  });
}

module.exports = { registerAgentDbIpc };
