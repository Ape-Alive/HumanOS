'use strict';

const { ipcMain } = require('electron');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');

const MAX_BUF = 25_000_000;
/** Gemini / API 内联附件上限（字节） */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_OUT = 60_000;
const MAX_SHEETS = 8;
const MAX_ROWS_PER_SHEET = 350;

/**
 * @param {string} ext
 */
function mimeForExt(ext) {
  const e = String(ext || '').toLowerCase();
  const m = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv; charset=utf-8',
  };
  return m[e] || 'application/octet-stream';
}

/**
 * @param {Buffer} buf
 * @param {string} ext
 * @param {string} fileName
 * @returns {{ mime: string, base64: string, fileName: string } | null}
 */
function buildAttachment(buf, ext, fileName) {
  if (!buf || buf.length === 0 || buf.length > MAX_ATTACHMENT_BYTES) return null;
  return {
    mime: mimeForExt(ext),
    base64: buf.toString('base64'),
    fileName: String(fileName || 'document').replace(/[/\\]/g, '_').slice(0, 200),
  };
}

/**
 * @param {string} s
 */
function clipText(s) {
  const t = String(s || '');
  if (t.length <= MAX_TEXT_OUT) return t;
  return `${t.slice(0, MAX_TEXT_OUT)}\n\n…（文本已截断至 ${MAX_TEXT_OUT} 字符）`;
}

/**
 * @param {Buffer} buf
 * @returns {string}
 */
function extractSpreadsheetText(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const lines = [];
  const names = wb.SheetNames || [];
  const nSheets = Math.min(names.length, MAX_SHEETS);
  for (let si = 0; si < nSheets; si++) {
    const name = names[si];
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    lines.push(`\n## 工作表: ${name}\n`);
    const cap = Math.min(rows.length, MAX_ROWS_PER_SHEET);
    for (let r = 0; r < cap; r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;
      const cells = row.map((c) => String(c ?? '').replace(/\r?\n/g, ' ').slice(0, 240));
      lines.push(cells.join('\t'));
    }
    if (rows.length > cap) {
      lines.push(`…（本表共 ${rows.length} 行，已截断展示前 ${cap} 行；完整结构见附件）`);
    }
  }
  return lines.join('\n').trim();
}

function registerTaskDocIpc() {
  ipcMain.handle('task-doc:extract-text', async (_e, payload) => {
    const p = payload || {};
    const ext = String(p.ext || '').toLowerCase();
    const b64 = String(p.base64 || '').replace(/\s/g, '');
    const fileName = String(p.fileName || 'document').replace(/[/\\]/g, '_').slice(0, 200);
    if (!b64) return { ok: false, error: 'empty-base64', text: '', attachment: null };
    let buf;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch (e) {
      return {
        ok: false,
        error: String(/** @type {{ message?: string }} */ (e)?.message || e),
        text: '',
        attachment: null,
      };
    }
    if (!buf.length) return { ok: false, error: 'empty-buffer', text: '', attachment: null };
    if (buf.length > MAX_BUF) return { ok: false, error: 'file-too-large', text: '', attachment: null };

    const supported = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv'];
    if (!supported.includes(ext)) {
      return { ok: false, error: `unsupported-ext:${ext || 'none'}`, text: '', attachment: null };
    }

    try {
      if (ext === '.csv') {
        let text = buf.toString('utf8');
        if (!text || /^[\x00-\x08]/.test(text.slice(0, 8))) {
          try {
            text = buf.toString('latin1');
          } catch {
            /* keep utf8 */
          }
        }
        const attachment = buildAttachment(buf, ext, fileName);
        return { ok: true, text: clipText(text), attachment };
      }

      if (ext === '.xlsx' || ext === '.xls') {
        let text = '';
        try {
          text = extractSpreadsheetText(buf);
        } catch (e) {
          text = '';
        }
        if (!String(text).trim()) {
          text = '（系统未能将表格解析为可读文本，请完全依赖附件中的电子表格原件进行分析。）';
        } else {
          text = clipText(text);
        }
        const attachment = buildAttachment(buf, ext, fileName);
        return { ok: true, text, attachment };
      }

      if (ext === '.pdf') {
        const data = await pdfParse(buf);
        const text = clipText(String(data?.text || ''));
        const attachment = buildAttachment(buf, ext, fileName);
        return { ok: true, text, attachment };
      }

      if (ext === '.docx' || ext === '.doc') {
        const r = await mammoth.extractRawText({ buffer: buf });
        const text = clipText(String(r?.value || ''));
        const attachment = buildAttachment(buf, ext, fileName);
        return { ok: true, text, attachment };
      }

      return { ok: false, error: `unsupported-ext:${ext}`, text: '', attachment: null };
    } catch (e) {
      return {
        ok: false,
        error: String(/** @type {{ message?: string }} */ (e)?.message || e),
        text: '',
        attachment: null,
      };
    }
  });
}

module.exports = { registerTaskDocIpc };
