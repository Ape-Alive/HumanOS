'use strict';

const { ipcMain, dialog, BrowserWindow, shell, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

function sanitizeFilename(name) {
  return String(name || 'report').replace(/[^\w.\-()\u4e00-\u9fff]+/g, '_').slice(0, 180);
}

function stripExt(n) {
  const s = String(n || '');
  return s.replace(/\.(md|docx|pdf)$/i, '');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 将不含 data-URL 图片的 Markdown 片段转为 HTML（行级规则）。
 * @param {string} fragment
 */
function markdownBlockToHtml(fragment) {
  const lines = String(fragment || '').replace(/\r\n/g, '\n').split('\n');
  const parts = [];
  let inFence = false;
  for (const raw of lines) {
    const line = raw;
    const t = line.trim();
    if (t.startsWith('```')) {
      inFence = !inFence;
      parts.push(inFence ? '<pre><code>' : '</code></pre>\n');
      continue;
    }
    if (inFence) {
      parts.push(`${escHtml(line)}\n`);
      continue;
    }
    if (!t) {
      parts.push('<br/>');
      continue;
    }
    if (/^###\s+/.test(line)) parts.push(`<h3>${escHtml(line.replace(/^#+\s*/, '').trim())}</h3>`);
    else if (/^##\s+/.test(line)) parts.push(`<h2>${escHtml(line.replace(/^#+\s*/, '').trim())}</h2>`);
    else if (/^#\s+/.test(line)) parts.push(`<h1>${escHtml(line.replace(/^#+\s*/, '').trim())}</h1>`);
    else if (/^[-*]\s+/.test(line)) parts.push(`<p class="li">• ${escHtml(line.replace(/^[-*]\s+/, '').trim())}</p>`);
    else parts.push(`<p>${escHtml(line)}</p>`);
  }
  return parts.join('\n');
}

/** Markdown 全文 → 可打印 HTML（识别 `![](data:image/...;base64,...)` 嵌入截图） */
function markdownToPrintHtml(md) {
  const full = String(md || '').replace(/\r\n/g, '\n');
  /** data: URL 中不应含 `)`；base64 行内不换行 */
  const imgRe = /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)\)/g;
  const chunks = [];
  let last = 0;
  let m;
  while ((m = imgRe.exec(full)) !== null) {
    if (m.index > last) {
      chunks.push({ type: 'md', html: markdownBlockToHtml(full.slice(last, m.index)) });
    }
    const caption = m[1] || '关键截图';
    const src = m[2];
    chunks.push({
      type: 'img',
      html: `<figure class="shot" style="margin:14px 0;page-break-inside:avoid;"><div style="font-size:11px;color:#555;margin:0 0 6px;font-weight:600;">${escHtml(caption)}</div><img src="${src}" alt="${escHtml(caption)}" style="max-width:100%;height:auto;border:1px solid #ddd;border-radius:6px;display:block;"/></figure>`,
    });
    last = m.index + m[0].length;
  }
  if (last < full.length) {
    chunks.push({ type: 'md', html: markdownBlockToHtml(full.slice(last)) });
  }
  if (chunks.length === 0) {
    chunks.push({ type: 'md', html: markdownBlockToHtml(full) });
  }
  const body = chunks.map((c) => c.html).join('\n');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  body { font-family: 'PingFang SC','Microsoft YaHei','Helvetica Neue',sans-serif; padding: 28px; line-height: 1.55; color: #111; font-size: 13px; }
  h1 { font-size: 20px; margin: 0.6em 0; }
  h2 { font-size: 17px; margin: 0.55em 0; }
  h3 { font-size: 15px; margin: 0.5em 0; }
  pre { background: #f4f4f6; padding: 12px; border-radius: 6px; overflow: auto; white-space: pre-wrap; font-size: 12px; }
  p { margin: 0.35em 0; }
  p.li { margin-left: 0.5em; }
  figure.shot { break-inside: avoid; }
</style></head><body>${body}</body></html>`;
}

/**
 * @param {string} markdown
 * @param {import('electron').BrowserWindow | null} parentWin
 * @returns {Promise<Buffer>}
 */
function markdownToPdfBuffer(markdown, parentWin) {
  return new Promise((resolve, reject) => {
    const html = markdownToPrintHtml(markdown);
    const tmpDir = app.getPath('temp');
    const tmpPath = path.join(
      tmpDir,
      `humanos-report-print-${Date.now()}-${Math.random().toString(16).slice(2)}.html`,
    );
    let unlinked = false;
    const unlinkSafe = () => {
      if (unlinked) return;
      unlinked = true;
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    };

    try {
      fs.writeFileSync(tmpPath, html, 'utf8');
    } catch (e) {
      unlinkSafe();
      reject(e);
      return;
    }

    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      parent: parentWin || undefined,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    const timer = setTimeout(() => {
      try {
        win.destroy();
      } catch {
        /* ignore */
      }
      unlinkSafe();
      reject(new Error('printToPDF 超时'));
    }, 120000);

    const cleanup = () => {
      clearTimeout(timer);
      unlinkSafe();
      try {
        win.destroy();
      } catch {
        /* ignore */
      }
    };

    win.webContents.once('did-fail-load', (_e, code, desc) => {
      cleanup();
      reject(new Error(`页面加载失败: ${code} ${desc}`));
    });

    win.webContents.once('did-finish-load', async () => {
      try {
        const buf = await win.webContents.printToPDF({
          printBackground: true,
          margins: { marginType: 'default' },
          pageSize: 'A4',
        });
        cleanup();
        resolve(buf);
      } catch (e) {
        cleanup();
        reject(e);
      }
    });

    /** 含多张大图 base64 时 data: URL 会超过 Chromium 长度上限 → ERR_INVALID_URL；改用临时文件 + loadFile */
    win.loadFile(tmpPath).catch((e) => {
      cleanup();
      reject(e);
    });
  });
}

/**
 * @param {string} markdown
 * @returns {Promise<Buffer>}
 */
async function markdownToDocxBuffer(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  /** @type {unknown[]} */
  const children = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (/^\s*!\[[^\]]*\]\(\s*data:image\//.test(line)) {
      continue;
    }
    if (!t) {
      children.push(new Paragraph({ text: '' }));
      continue;
    }
    if (t.startsWith('### ')) {
      children.push(
        new Paragraph({ text: t.slice(4).trim(), heading: HeadingLevel.HEADING_3 }),
      );
    } else if (t.startsWith('## ')) {
      children.push(
        new Paragraph({ text: t.slice(3).trim(), heading: HeadingLevel.HEADING_2 }),
      );
    } else if (t.startsWith('# ')) {
      children.push(
        new Paragraph({ text: t.slice(2).trim(), heading: HeadingLevel.HEADING_1 }),
      );
    } else if (t.startsWith('```')) {
      children.push(new Paragraph({ text: '' }));
    } else if (/^[-*]\s+/.test(t)) {
      children.push(new Paragraph({ children: [new TextRun(`• ${t.replace(/^[-*]\s+/, '').trim()}`)] }));
    } else {
      children.push(new Paragraph({ children: [new TextRun(line)] }));
    }
  }
  if (children.length === 0) {
    children.push(new Paragraph({ text: '（空报告）' }));
  }
  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  return await Packer.toBuffer(doc);
}

function registerReportIpc() {
  ipcMain.handle('report:export', async (event, opts) => {
    const o = opts || {};
    const format = String(o.format || 'markdown').toLowerCase();
    const content = String(o.content ?? '');
    const win = BrowserWindow.fromWebContents(event.sender);
    const base = sanitizeFilename(o.defaultFilename || `humanos-ai-report-${Date.now()}`);
    const baseNoExt = stripExt(base);

    try {
      if (format === 'markdown') {
        const name = baseNoExt.endsWith('.md') ? baseNoExt : `${baseNoExt}.md`;
        const { canceled, filePath } = await dialog.showSaveDialog(win || undefined, {
          title: '导出测试报告 (Markdown)',
          defaultPath: path.join(app.getPath('downloads'), name),
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (canceled || !filePath) return { ok: false, canceled: true };
        fs.writeFileSync(filePath, content, 'utf8');
        return { ok: true, path: filePath };
      }

      if (format === 'word') {
        const buf = await markdownToDocxBuffer(content);
        const { canceled, filePath } = await dialog.showSaveDialog(win || undefined, {
          title: '导出测试报告 (Word)',
          defaultPath: path.join(app.getPath('downloads'), `${baseNoExt}.docx`),
          filters: [{ name: 'Word', extensions: ['docx'] }],
        });
        if (canceled || !filePath) return { ok: false, canceled: true };
        fs.writeFileSync(filePath, buf);
        return { ok: true, path: filePath };
      }

      if (format === 'pdf') {
        const buf = await markdownToPdfBuffer(content, win);
        const { canceled, filePath } = await dialog.showSaveDialog(win || undefined, {
          title: '导出测试报告 (PDF)',
          defaultPath: path.join(app.getPath('downloads'), `${baseNoExt}.pdf`),
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (canceled || !filePath) return { ok: false, canceled: true };
        fs.writeFileSync(filePath, buf);
        return { ok: true, path: filePath };
      }

      if (format === 'preview-pdf') {
        const buf = await markdownToPdfBuffer(content, win);
        const tmp = path.join(app.getPath('temp'), `humanos-report-preview-${Date.now()}.pdf`);
        fs.writeFileSync(tmp, buf);
        const openErr = await shell.openPath(tmp);
        if (openErr) return { ok: false, error: openErr, path: tmp };
        return { ok: true, path: tmp, preview: true };
      }

      /** 供渲染进程内嵌预览：返回 PDF 二进制（Base64），不弹保存框 */
      if (format === 'pdf-data') {
        const buf = await markdownToPdfBuffer(content, win);
        return { ok: true, base64: buf.toString('base64') };
      }

      return { ok: false, error: `unknown-format:${format}` };
    } catch (e) {
      return { ok: false, error: String(/** @type {{ message?: string }} */ (e)?.message || e) };
    }
  });
}

module.exports = { registerReportIpc };
