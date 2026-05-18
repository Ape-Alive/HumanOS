/** 任务描述是否涉及「复制到剪贴板」类验收 */
export function isCopyLikeGoal(userGoal) {
  const g = String(userGoal || '');
  return /复制|拷贝|copy|剪贴板|clipboard|粘贴板/i.test(g);
}

/**
 * @param {string | null | undefined} before
 * @param {string | null | undefined} after
 * @param {string} userGoal
 * @param {{ hadInteraction?: boolean }} [opts] 本轮须有过 click 或 Ctrl/Cmd+C 才允许凭剪贴板判通过
 * @returns {{ passed: boolean, evidence: string, skipped?: boolean }}
 */
export function tryClipboardAssertion(before, after, userGoal, opts = {}) {
  if (!isCopyLikeGoal(userGoal)) {
    return { passed: false, evidence: '', skipped: true };
  }
  if (!opts.hadInteraction) {
    return { passed: false, evidence: '', skipped: true };
  }
  const b = String(before ?? '');
  const a = String(after ?? '');
  if (a !== b && a.trim().length > 0) {
    const preview = a.length > 48 ? `${a.slice(0, 48)}…` : a;
    return {
      passed: true,
      evidence: `远端剪贴板内容已更新（${preview.replace(/\s+/g, ' ')}）`,
    };
  }
  if (a !== b && a.trim().length === 0 && b.trim().length > 0) {
    return { passed: false, evidence: '远端剪贴板已清空，未检测到有效复制内容' };
  }
  return { passed: false, evidence: '远端剪贴板内容与操作前相同' };
}
