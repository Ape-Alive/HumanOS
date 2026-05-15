/** @param {string} text */
export function extractJsonObject(text) {
  const t = String(text).trim();
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('响应中未找到 JSON 对象');
  return JSON.parse(t.slice(i, j + 1));
}

/**
 * @param {unknown} raw
 * @returns {{ analysis: string, macro_done: boolean, steps: unknown[] }}
 */
export function normalizePlannerJson(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const analysis = typeof o.analysis === 'string' ? o.analysis : '';
  const macro_done = !!o.macro_done;
  const steps = Array.isArray(o.steps) ? o.steps : [];
  return { analysis, macro_done, steps };
}

/**
 * 将规划器输出的 0–1000 归一化坐标转为「远程视频帧」像素坐标。
 * 当 Vision/Planner 使用的 JPEG 与 videoWidth×videoHeight 不一致时（例如截图被缩小），
 * 必须传入 visionW/visionH（与 cap.width/cap.height 一致），否则点击会系统性偏移。
 *
 * @param {number} nx
 * @param {number} ny
 * @param {number} vw  video.videoWidth
 * @param {number} vh  video.videoHeight
 * @param {{ visionW?: number, visionH?: number }} [vision] 若存在，表示 nx/ny 相对该尺寸的截图（再映射到 vw×vh）
 */
export function nxnyToPixel(nx, ny, vw, vh, vision) {
  const vwSafe = Math.max(1, Math.round(Number(vw) || 0));
  const vhSafe = Math.max(1, Math.round(Number(vh) || 0));
  const iw =
    vision?.visionW != null && Number(vision.visionW) > 0 ? Math.round(Number(vision.visionW)) : vwSafe;
  const ih =
    vision?.visionH != null && Number(vision.visionH) > 0 ? Math.round(Number(vision.visionH)) : vhSafe;
  const nxc = Math.max(0, Math.min(1000, Number(nx) || 0));
  const nyc = Math.max(0, Math.min(1000, Number(ny) || 0));
  const pxInVision = (nxc / 1000) * iw;
  const pyInVision = (nyc / 1000) * ih;
  const x = Math.round((pxInVision / iw) * vwSafe);
  const y = Math.round((pyInVision / ih) * vhSafe);
  return {
    x: Math.max(0, Math.min(65535, x)),
    y: Math.max(0, Math.min(65535, y)),
  };
}

/**
 * @param {unknown} step
 * @param {{ videoW: number, videoH: number, visionW?: number, visionH?: number }} dim
 * @returns {{ ok: boolean, cmds?: Record<string, unknown>[], reason?: string }}
 */
export function stepToControlCommands(step, dim) {
  if (!step || typeof step !== 'object') return { ok: false, reason: 'invalid-step' };
  const s = /** @type {Record<string, unknown>} */ (step);
  const action = String(s.action || '').toLowerCase();
  const vw = dim.videoW;
  const vh = dim.videoH;
  const vision =
    dim.visionW != null && dim.visionH != null && dim.visionW > 0 && dim.visionH > 0
      ? { visionW: dim.visionW, visionH: dim.visionH }
      : undefined;

  if (action === 'wait_ms') {
    const ms = Math.max(0, Math.min(15000, Math.floor(Number(s.ms) || 0)));
    return { ok: true, cmds: [{ __wait: ms }] };
  }

  if (action === 'type_text') {
    const text = String(s.text ?? '');
    if (!text) return { ok: false, reason: 'empty-text' };
    return { ok: true, cmds: [{ type: 'text', text: text.slice(0, 4000) }] };
  }

  if (action === 'press_key') {
    let code = String(s.code ?? '').trim();
    const rawKey = String(s.key ?? '').trim();
    if (!code && rawKey) {
      const k = rawKey.toLowerCase();
      const fromKey = {
        enter: 'Enter',
        return: 'Enter',
        esc: 'Escape',
        escape: 'Escape',
        tab: 'Tab',
        space: 'Space',
        backspace: 'Backspace',
        delete: 'Delete',
        left: 'ArrowLeft',
        right: 'ArrowRight',
        up: 'ArrowUp',
        down: 'ArrowDown',
      };
      code = fromKey[k] || (/^arrow/i.test(rawKey) ? rawKey : /^f\d+$/i.test(rawKey) ? rawKey : '');
      if (!code && rawKey.length === 1) {
        const ch = rawKey.toUpperCase();
        if (/[A-Z]/.test(ch)) code = `Key${ch}`;
        else if (/[0-9]/.test(rawKey)) code = `Digit${rawKey}`;
      }
    }
    if (!code) return { ok: false, reason: 'press_key-missing-code' };
    const norm = code.replace(/\s+/g, '');
    const lower = norm.toLowerCase();
    const fromLower = {
      enter: 'Enter',
      return: 'Enter',
      esc: 'Escape',
      escape: 'Escape',
      tab: 'Tab',
      space: 'Space',
      backspace: 'Backspace',
      delete: 'Delete',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      up: 'ArrowUp',
      down: 'ArrowDown',
      pageup: 'PageUp',
      pagedown: 'PageDown',
      home: 'Home',
      end: 'End',
      arrowleft: 'ArrowLeft',
      arrowright: 'ArrowRight',
      arrowup: 'ArrowUp',
      arrowdown: 'ArrowDown',
    };
    const canonical = {
      Enter: 'Enter',
      Return: 'Enter',
      Escape: 'Escape',
      Esc: 'Escape',
      Tab: 'Tab',
      Space: 'Space',
      Backspace: 'Backspace',
      Delete: 'Delete',
      ArrowLeft: 'ArrowLeft',
      ArrowRight: 'ArrowRight',
      ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      Home: 'Home',
      End: 'End',
    };
    const resolved = canonical[norm] || fromLower[lower] || norm;
    const keyFromCode =
      resolved === 'Enter'
        ? 'Enter'
        : resolved === 'Tab'
          ? 'Tab'
          : resolved === 'Escape'
            ? 'Escape'
            : resolved === 'Space'
              ? ' '
              : resolved.startsWith('Arrow')
                ? resolved
                : resolved.startsWith('Key')
                  ? resolved.slice(3).toLowerCase()
                  : resolved.startsWith('Digit')
                    ? resolved.slice(5)
                    : rawKey || resolved;
    return {
      ok: true,
      cmds: [
        {
          type: 'key',
          phase: 'down',
          code: resolved,
          key: keyFromCode,
          repeat: false,
          ctrlKey: !!s.ctrlKey,
          shiftKey: !!s.shiftKey,
          altKey: !!s.altKey,
          metaKey: !!s.metaKey,
        },
      ],
    };
  }

  if (action === 'move' || action === 'click' || action === 'wheel') {
    const nx = Number(s.nx);
    const ny = Number(s.ny);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return { ok: false, reason: 'bad-coords' };
    const { x, y } = nxnyToPixel(nx, ny, vw, vh, vision);
    if (action === 'move') return { ok: true, cmds: [{ type: 'move', x, y }] };
    if (action === 'click') {
      const button = s.button === 'right' ? 'right' : 'left';
      return { ok: true, cmds: [{ type: 'move', x, y }, { type: 'click', x, y, button }] };
    }
    const deltaY = Number(s.deltaY);
    const dy = Number.isFinite(deltaY) ? Math.max(-2000, Math.min(2000, Math.round(deltaY))) : 120;
    return { ok: true, cmds: [{ type: 'move', x, y }, { type: 'wheel', x, y, deltaY: dy, deltaX: 0 }] };
  }

  return { ok: false, reason: `unknown-action:${action}` };
}
