import { promptManager } from '../prompts/promptManager.js';

/**
 * @param {ReturnType<typeof import('../plugins/openAiVisionChat.js').createOpenAiCompatibleAdapter>} adapter
 * @param {{ userGoal: string, screenDescription: string, signal?: AbortSignal }} ctx
 */
export async function runAssertion(adapter, ctx) {
  const userText = `【用户目标】\n${ctx.userGoal}\n\n【当前屏幕描述】\n${ctx.screenDescription}\n\n请输出 JSON 验收结果。`;
  const raw = await adapter.complete({
    system: promptManager.assertionTaskDone(),
    userText,
    signal: ctx.signal,
  });
  let parsed;
  try {
    const str = String(raw);
    const i = str.indexOf('{');
    const j = str.lastIndexOf('}');
    parsed = JSON.parse(str.slice(i, j + 1));
  } catch {
    return { passed: false, evidence: '断言 JSON 解析失败' };
  }
  return {
    passed: !!parsed.passed,
    evidence: typeof parsed.evidence === 'string' ? parsed.evidence : '',
  };
}

/**
 * 结合截图的验收（推荐用于「截图验证」环节）。
 * @param {ReturnType<typeof import('../plugins/openAiVisionChat.js').createOpenAiCompatibleAdapter>} adapter
 * @param {{ userGoal: string, capture: { base64: string, mime: string }, signal?: AbortSignal }} ctx
 */
export async function runAssertionWithVision(adapter, ctx) {
  const userText = `【用户目标】\n${ctx.userGoal}\n\n请根据截图判断是否已达成，并输出 JSON。`;
  const raw = await adapter.complete({
    system: promptManager.assertionTaskDoneVision(),
    userText,
    imageBase64: ctx.capture.base64,
    mime: ctx.capture.mime,
    signal: ctx.signal,
  });
  let parsed;
  try {
    const str = String(raw);
    const i = str.indexOf('{');
    const j = str.lastIndexOf('}');
    parsed = JSON.parse(str.slice(i, j + 1));
  } catch {
    return { passed: false, evidence: '视觉验收 JSON 解析失败' };
  }
  return {
    passed: !!parsed.passed,
    evidence: typeof parsed.evidence === 'string' ? parsed.evidence : '',
  };
}
