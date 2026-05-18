import { promptManager } from '../prompts/promptManager.js';

/**
 * @param {ReturnType<typeof import('../plugins/openAiVisionChat.js').createOpenAiCompatibleAdapter>} adapter
 * @param {{
 *   userGoal: string,
 *   screenDescription: string,
 *   executedSummary: string,
 *   taskPlanBlock?: string,
 *   criticFeedback?: string,
 *   signal?: AbortSignal,
 *   captureW?: number,
 *   captureH?: number,
 *   stagnationHint?: string,
 * }} ctx
 */
export async function runPlanner(adapter, ctx) {
  const dimHint =
    ctx.captureW && ctx.captureH
      ? `\n【坐标系说明】下方「当前屏幕」来自约 ${ctx.captureW}×${ctx.captureH} 像素的截图（相对完整远程画面可能已缩小）。你输出的 nx、ny 必须为 0–1000 的归一化坐标，**相对该截图的宽与高**（左上为 0,0，右下为 1000,1000）。\n`
      : '';
  const stagnationBlock = ctx.stagnationHint ? `${ctx.stagnationHint}\n\n` : '';
  const planBlock = ctx.taskPlanBlock ? `${ctx.taskPlanBlock}\n` : '';
  const criticBlock = ctx.criticFeedback
    ? `【Critic 反馈（上轮或上一步评审，须据此纠偏）】\n${ctx.criticFeedback}\n\n`
    : '';
  const userText = `【用户目标】\n${ctx.userGoal}\n\n${planBlock}${criticBlock}【当前屏幕】\n${ctx.screenDescription}\n${dimHint}\n【已执行摘要】\n${ctx.executedSummary || '（尚无）'}\n\n${stagnationBlock}在输出 JSON 前请自检：每个 click 的 nx、ny 是否与上述空间描述及截图控件位置一致；若某控件位置不确定，宁可多一步 move 接近目标区域再 click，或插入 wait_ms 等待界面稳定。必须填写 round_checkpoint。\n\n请输出 JSON 规划。`;
  const raw = await adapter.complete({
    system: promptManager.plannerNextSteps(),
    userText,
    signal: ctx.signal,
    temperature: 0.08,
  });
  return String(raw || '').trim();
}
