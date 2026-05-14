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

/** @param {number} nx @param {number} ny @param {number} vw @param {number} vh */
export function nxnyToPixel(nx, ny, vw, vh) {
  const x = Math.round((Math.max(0, Math.min(1000, nx)) / 1000) * vw);
  const y = Math.round((Math.max(0, Math.min(1000, ny)) / 1000) * vh);
  return {
    x: Math.max(0, Math.min(65535, x)),
    y: Math.max(0, Math.min(65535, y)),
  };
}

/**
 * @param {unknown} step
 * @param {{ videoW: number, videoH: number }} dim
 * @returns {{ ok: boolean, cmds?: Record<string, unknown>[], reason?: string }}
 */
export function stepToControlCommands(step, dim) {
  if (!step || typeof step !== 'object') return { ok: false, reason: 'invalid-step' };
  const s = /** @type {Record<string, unknown>} */ (step);
  const action = String(s.action || '').toLowerCase();
  const vw = dim.videoW;
  const vh = dim.videoH;

  if (action === 'wait_ms') {
    const ms = Math.max(0, Math.min(15000, Math.floor(Number(s.ms) || 0)));
    return { ok: true, cmds: [{ __wait: ms }] };
  }

  if (action === 'type_text') {
    const text = String(s.text ?? '');
    if (!text) return { ok: false, reason: 'empty-text' };
    return { ok: true, cmds: [{ type: 'text', text: text.slice(0, 4000) }] };
  }

  if (action === 'move' || action === 'click' || action === 'wheel') {
    const nx = Number(s.nx);
    const ny = Number(s.ny);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return { ok: false, reason: 'bad-coords' };
    const { x, y } = nxnyToPixel(nx, ny, vw, vh);
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
