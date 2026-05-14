'use strict';

const { ipcMain } = require('electron');

/** @type {Map<string, AbortController>} */
const pending = new Map();

/**
 * @param {string} u
 */
function assertHttpUrl(u) {
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error('invalid-url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only-http-s-allowed');
  }
}

function registerAiHttpIpc() {
  ipcMain.handle('ai:http-abort', (_e, payload) => {
    const id = String(payload?.requestId || '');
    const ac = pending.get(id);
    if (ac) {
      ac.abort();
      return { ok: true };
    }
    return { ok: false };
  });

  ipcMain.handle('ai:http-post', async (_e, payload) => {
    const url = String(payload?.url || '').trim();
    assertHttpUrl(url);

    const method = String(payload?.method || 'POST').toUpperCase() || 'POST';
    const headers =
      payload?.headers && typeof payload.headers === 'object' && !Array.isArray(payload.headers)
        ? /** @type {Record<string, string>} */ (payload.headers)
        : {};
    const body = typeof payload?.body === 'string' ? payload.body : '';
    const timeoutMs = Math.min(300000, Math.max(5000, Number(payload?.timeoutMs) || 120000));
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';

    const ac = new AbortController();
    if (requestId) pending.set(requestId, ac);

    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        signal: ac.signal,
      });
      const text = await res.text();
      return {
        ok: true,
        status: res.status,
        statusText: res.statusText,
        body: text,
      };
    } catch (e) {
      const msg = String(/** @type {{ message?: string }} */ (e)?.message || e);
      return {
        ok: false,
        error: msg,
      };
    } finally {
      clearTimeout(timer);
      if (requestId) pending.delete(requestId);
    }
  });
}

module.exports = { registerAiHttpIpc };
