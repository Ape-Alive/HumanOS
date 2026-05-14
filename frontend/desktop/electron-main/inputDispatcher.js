'use strict';

const { screen } = require('electron');
const { dispatchKeyboard } = require('./keyboardDispatch.js');

/**
 * 控制端按 <video> 的 videoWidth/videoHeight 发来坐标；在 macOS Retina 上该尺寸常为物理像素，
 * 而 nut-js / 系统鼠标位置使用与 Electron `display.bounds` 一致的全局逻辑坐标（DIP），需按比例并加上显示器原点偏移。
 * @param {number} x
 * @param {number} y
 * @param {number} frameW
 * @param {number} frameH
 * @returns {{ x: number, y: number }}
 */
function mapVideoFramePointToGlobalScreen(x, y, frameW, frameH) {
  const ix = Number(x) || 0;
  const iy = Number(y) || 0;
  const fw = Math.round(Number(frameW) || 0);
  const fh = Math.round(Number(frameH) || 0);
  if (!(fw > 0) || !(fh > 0)) {
    return { x: Math.round(ix), y: Math.round(iy) };
  }
  let best = null;
  let bestScore = Infinity;
  for (const d of screen.getAllDisplays()) {
    const pw = Math.round(d.bounds.width * d.scaleFactor);
    const ph = Math.round(d.bounds.height * d.scaleFactor);
    const score = Math.abs(pw - fw) + Math.abs(ph - fh);
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  const tol = Math.max(48, Math.round(0.02 * (fw + fh)));
  if (!best || bestScore > tol) {
    const p = screen.getPrimaryDisplay();
    const arF = fw / fh;
    const arB = p.bounds.width / p.bounds.height;
    if (Number.isFinite(arF) && arF > 0 && Math.abs(arF - arB) < 0.02) {
      return {
        x: Math.round((ix * p.bounds.width) / fw + p.bounds.x),
        y: Math.round((iy * p.bounds.height) / fh + p.bounds.y),
      };
    }
    return { x: Math.round(ix), y: Math.round(iy) };
  }
  const d = best;
  const gx = Math.round((ix * d.bounds.width) / fw + d.bounds.x);
  const gy = Math.round((iy * d.bounds.height) / fh + d.bounds.y);
  return { x: gx, y: gy };
}

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
  const frameW = Number(cmd.frameW) || 0;
  const frameH = Number(cmd.frameH) || 0;
  const mapped =
    cmd.type === 'move' || cmd.type === 'click' || cmd.type === 'wheel'
      ? mapVideoFramePointToGlobalScreen(Number(cmd.x) || 0, Number(cmd.y) || 0, frameW, frameH)
      : { x: Number(cmd.x) || 0, y: Number(cmd.y) || 0 };
  const x = Math.max(0, Math.min(65535, Math.round(mapped.x)));
  const y = Math.max(0, Math.min(65535, Math.round(mapped.y)));
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
