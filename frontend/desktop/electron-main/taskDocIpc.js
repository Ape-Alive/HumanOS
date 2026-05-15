'use strict';

const { ipcMain } = require('electron');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

function registerTaskDocIpc() {
  ipcMain.handle('task-doc:extract-text', async (_e, payload) => {
    const p = payload || {};
    const ext = String(p.ext || '').toLowerCase();
    const b64 = String(p.base64 || '').replace(/\s/g, '');
    if (!b64) return { ok: false, error: 'empty-base64', text: '' };
    let buf;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch (e) {
      return { ok: false, error: String(/** @type {{ message?: string }} */ (e)?.message || e), text: '' };
    }
    if (!buf.length) return { ok: false, error: 'empty-buffer', text: '' };
    if (buf.length > 25_000_000) return { ok: false, error: 'file-too-large', text: '' };

    try {
      if (ext === '.pdf') {
        const data = await pdfParse(buf);
        return { ok: true, text: String(data?.text || '') };
      }
      if (ext === '.docx') {
        const r = await mammoth.extractRawText({ buffer: buf });
        return { ok: true, text: String(r?.value || '') };
      }
      if (ext === '.doc') {
        const r = await mammoth.extractRawText({ buffer: buf });
        return { ok: true, text: String(r?.value || '') };
      }
      return { ok: false, error: `unsupported-ext:${ext || 'none'}`, text: '' };
    } catch (e) {
      return { ok: false, error: String(/** @type {{ message?: string }} */ (e)?.message || e), text: '' };
    }
  });
}

module.exports = { registerTaskDocIpc };
