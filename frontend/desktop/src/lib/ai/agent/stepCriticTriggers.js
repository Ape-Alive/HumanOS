/** 输入/发送类步骤执行后需触发 Critic */
export function shouldRunStepCritic(step) {
  if (!step || typeof step !== 'object') return false;
  const s = /** @type {Record<string, unknown>} */ (step);
  const action = String(s.action || '').toLowerCase();
  if (action === 'launch_app') return true;
  if (action === 'type_text') {
    const text = String(s.text ?? '').trim();
    return text.length > 0;
  }
  if (action === 'press_key') {
    const code = String(s.code || s.key || '')
      .toLowerCase()
      .replace(/\s/g, '');
    return code === 'enter' || code === 'return' || code === 'keyenter';
  }
  return false;
}

/** @param {unknown} step */
export function getLaunchAppNameFromStep(step) {
  if (!step || typeof step !== 'object') return '';
  const s = /** @type {Record<string, unknown>} */ (step);
  if (String(s.action || '').toLowerCase() !== 'launch_app') return '';
  return String(s.app_name ?? s.name ?? '').trim();
}
