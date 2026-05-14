/**
 * DataChannel 控制消息（JSON），与 PRD 3.5 对齐的最小集。
 * @typedef {{ type: 'move', x: number, y: number, frameW?: number, frameH?: number }} ControlMove
 * @typedef {{ type: 'click', x: number, y: number, button?: 'left'|'right', frameW?: number, frameH?: number }} ControlClick
 * @typedef {{ type: 'wheel', x: number, y: number, deltaX?: number, deltaY: number, frameW?: number, frameH?: number }} ControlWheel
 * @typedef {{ type: 'key', phase: 'down'|'up', key: string, code: string, repeat?: boolean, ctrlKey?: boolean, shiftKey?: boolean, altKey?: boolean, metaKey?: boolean }} ControlKey
 * @typedef {{ type: 'text', text: string }} ControlText IME / 整段上屏
 * @typedef {{ type: 'recapture' }} ControlRecapture 被控端专用：重新选择屏幕/窗口共享（不经主进程键鼠）
 */

/** @param {unknown} data */
export function parseControlMessage(data) {
  if (typeof data !== 'string') return null;
  try {
    const o = JSON.parse(data);
    if (!o || typeof o.type !== 'string') return null;
    return o;
  } catch {
    return null;
  }
}

export function stringifyControl(cmd) {
  return JSON.stringify(cmd);
}
