import { promptManager } from '../prompts/promptManager.js';

/**
 * @param {ReturnType<typeof import('../plugins/openAiVisionChat.js').createOpenAiCompatibleAdapter>} adapter
 * @param {{
 *   userGoal: string,
 *   screenDescription: string,
 *   executedSummary: string,
 *   signal?: AbortSignal,
 * }} ctx
 */
export async function runPlanner(adapter, ctx) {
  const userText = `【用户目标】\n${ctx.userGoal}\n\n【当前屏幕】\n${ctx.screenDescription}\n\n【已执行摘要】\n${ctx.executedSummary || '（尚无）'}\n\n请输出 JSON 规划。`;
  const raw = await adapter.complete({
    system: promptManager.plannerNextSteps(),
    userText,
    signal: ctx.signal,
  });
  return String(raw || '').trim();
}
