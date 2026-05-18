/** @param {unknown} step */
export function isCopyShortcutStep(step) {
  if (!step || typeof step !== 'object') return false;
  const s = /** @type {Record<string, unknown>} */ (step);
  if (String(s.action || '').toLowerCase() !== 'press_key') return false;
  const raw = String(s.code || s.key || '')
    .toLowerCase()
    .replace(/\s/g, '');
  const isC = raw === 'c' || raw === 'keyc' || raw.endsWith('keyc');
  if (!isC) return false;
  return !!(s.ctrlKey || s.metaKey);
}

/** 点击或 Ctrl/Cmd+C 等可能产生瞬态 UI / 剪贴板变化 */
export function shouldCaptureTransientFeedback(step) {
  if (!step || typeof step !== 'object') return false;
  const action = String(/** @type {Record<string, unknown>} */ (step).action || '').toLowerCase();
  return action === 'click' || isCopyShortcutStep(step);
}
