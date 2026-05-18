/**
 * DataChannel 上远端剪贴板读写（被控端读系统剪贴板 → 回传控制端）。
 * @typedef {{ type: 'clipboard_get', id: string }} ClipboardGet
 * @typedef {{ type: 'clipboard_result', id: string, ok: boolean, text?: string, error?: string }} ClipboardResult
 */

/** @param {unknown} data */
export function parseClipboardResult(data) {
  if (typeof data !== 'string') return null;
  try {
    const o = JSON.parse(data);
    if (!o || o.type !== 'clipboard_result' || typeof o.id !== 'string') return null;
    return o;
  } catch {
    return null;
  }
}

/**
 * @param {ClipboardResult} msg
 */
export function stringifyClipboardResult(msg) {
  return JSON.stringify(msg);
}

/**
 * @param {string} id
 */
export function stringifyClipboardGet(id) {
  return JSON.stringify({ type: 'clipboard_get', id });
}
