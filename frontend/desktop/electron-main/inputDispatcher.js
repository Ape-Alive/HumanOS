'use strict';

const { dispatchKeyboard } = require('./keyboardDispatch.js');

/**
 * 主进程执行远程控制指令（PRD 3.5），使用 @nut-tree-fork/nut-js（内置 libnut provider）。
 * @param {Record<string, unknown>} cmd
 * @returns {Promise<{ ok: boolean, reason?: string, stub?: boolean }>}
 */
async function dispatch(cmd) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') {
    return { ok: false, reason: 'invalid-cmd' };
  }

  /** @type {typeof import('@nut-tree-fork/nut-js') | null} */
  let nut = null;
  try {
    nut = require('@nut-tree-fork/nut-js');
  } catch (e) {
    console.warn('[HumanOS] nut-js unavailable:', e.message);
    return { ok: false, reason: 'nut-unavailable' };
  }

  if (cmd.type === 'key' || cmd.type === 'text') {
    try {
      return await dispatchKeyboard(nut, cmd);
    } catch (e) {
      const msg = e && typeof e.message === 'string' ? e.message : String(e);
      console.error('[HumanOS] keyboard dispatch', msg);
      return { ok: false, reason: msg };
    }
  }

  const { mouse, Point, Button } = nut;
  const x = Math.max(0, Math.min(65535, Math.round(Number(cmd.x) || 0)));
  const y = Math.max(0, Math.min(65535, Math.round(Number(cmd.y) || 0)));
  const pt = new Point(x, y);

  try {
    if (cmd.type === 'move') {
      await mouse.setPosition(pt);
      return { ok: true };
    }
    if (cmd.type === 'click') {
      await mouse.setPosition(pt);
      if (cmd.button === 'right') await mouse.click(Button.RIGHT);
      else await mouse.click(Button.LEFT);
      return { ok: true };
    }
    if (cmd.type === 'wheel') {
      await mouse.setPosition(pt);
      const dy = Number(cmd.deltaY) || 0;
      const steps = Math.max(1, Math.min(12, Math.round(Math.abs(dy) / 40)));
      if (dy > 0) await mouse.scrollDown(steps);
      else if (dy < 0) await mouse.scrollUp(steps);
      return { ok: true };
    }
    return { ok: false, reason: 'unsupported-type' };
  } catch (e) {
    const msg = e && typeof e.message === 'string' ? e.message : String(e);
    console.error('[HumanOS] input dispatch', msg);
    return { ok: false, reason: msg };
  }
}

module.exports = { dispatch };
