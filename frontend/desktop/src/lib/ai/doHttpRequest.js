'use strict';

/**
 * 将 HeadersInit 转为普通对象（供 Electron 主进程 IPC 序列化）。
 * @param {HeadersInit | undefined} h
 * @returns {Record<string, string>}
 */
function flattenHeaders(h) {
  if (!h) return {};
  if (h instanceof Headers) {
    /** @type {Record<string, string>} */
    const o = {};
    h.forEach((v, k) => {
      o[k] = v;
    });
    return o;
  }
  if (Array.isArray(h)) {
    /** @type {Record<string, string>} */
    const o = {};
    for (const [k, v] of h) o[String(k)] = String(v);
    return o;
  }
  return /** @type {Record<string, string>} */ ({ ...h });
}

/**
 * 在 Electron 中优先走主进程 fetch，避免第三方 API 未配置 CORS 时出现 `Failed to fetch`。
 *
 * @param {string} url
 * @param {{ method?: string, headers?: HeadersInit, body?: string | null, signal?: AbortSignal, timeoutMs?: number }} init
 * @returns {Promise<{ ok: boolean, status: number, statusText: string, text: string }>}
 */
export async function doHttpRequest(url, init = {}) {
  const hp =
    typeof window !== 'undefined' &&
    window.humanos &&
    typeof window.humanos.aiHttpPost === 'function'
      ? window.humanos.aiHttpPost
      : null;

  const method = init.method || 'POST';
  const headers = flattenHeaders(init.headers);
  const body = init.body == null ? '' : String(init.body);
  const timeoutMs = Math.min(300000, Math.max(8000, Number(init.timeoutMs) || 180000));

  if (hp) {
    const requestId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `ai-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    const signal = init.signal;
    const onAbort = () => {
      try {
        const ab = window.humanos?.aiHttpAbort;
        if (typeof ab === 'function') void ab({ requestId });
      } catch {
        /* ignore */
      }
    };
    if (signal?.aborted) {
      throw new DOMException('The user aborted a request.', 'AbortError');
    }
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      /** @type {{ ok: boolean, status?: number, statusText?: string, body?: string, error?: string }} */
      const r = await hp({
        url,
        method,
        headers,
        body,
        timeoutMs,
        requestId,
      });
      if (!r || typeof r !== 'object' || !r.ok) {
        throw new Error(r?.error || '主进程 HTTP 请求失败');
      }
      return {
        ok: (r.status ?? 0) >= 200 && (r.status ?? 0) < 300,
        status: Number(r.status) || 0,
        statusText: String(r.statusText || ''),
        text: typeof r.body === 'string' ? r.body : '',
      };
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  const res = await fetch(url, {
    method,
    headers: init.headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
    signal: init.signal,
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    text,
  };
}
