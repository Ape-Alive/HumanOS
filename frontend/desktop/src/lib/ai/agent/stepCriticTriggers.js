/** 输入/发送类步骤执行后需触发 Critic */
export function shouldRunStepCritic(step) {
  if (!step || typeof step !== 'object') return false;
  const s = /** @type {Record<string, unknown>} */ (step);
  const action = String(s.action || '').toLowerCase();
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
