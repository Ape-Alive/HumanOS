import { promptManager } from '../prompts/promptManager.js';

/**
 * @param {ReturnType<typeof import('../plugins/openAiVisionChat.js').createOpenAiCompatibleAdapter>} adapter
 * @param {{
 *   userGoal: string,
 *   screenDescription: string,
 *   executedSummary: string,
 *   taskPlanBlock?: string,
 *   criticFeedback?: string,
 *   remotePlatform?: string,
 *   launchHint?: string,
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
  const plat = String(ctx.remotePlatform || '').toLowerCase();
  const osLine =
    plat === 'win32'
      ? '【被控端系统】Windows（win32）— 打开应用请用 launch_app，等价 Win 搜索启动。\n\n'
      : plat === 'darwin'
        ? '【被控端系统】macOS（darwin）— 打开应用请用 launch_app，等价 Spotlight（⌘Space）。\n\n'
        : plat
          ? ''
          : '【被控端系统】尚未识别 — 打开应用仍可用 launch_app；若 auto 无效可设 method 为 "shell"。\n\n';
  const launchBlock = ctx.launchHint ? `${ctx.launchHint}\n\n` : '';
  const criticBlock = ctx.criticFeedback
    ? `【Critic 反馈（上轮或上一步评审，须据此纠偏）】\n${ctx.criticFeedback}\n\n`
    : '';
  const userText = `【用户目标】\n${ctx.userGoal}\n\n${osLine}${planBlock}${launchBlock}${criticBlock}【当前屏幕】\n${ctx.screenDescription}\n${dimHint}\n【已执行摘要】\n${ctx.executedSummary || '（尚无）'}\n\n${stagnationBlock}在输出 JSON 前请自检：每个 click 的 nx、ny 是否与上述空间描述及截图控件位置一致；若某控件位置不确定，宁可多一步 move 接近目标区域再 click，或插入 wait_ms 等待界面稳定。必须填写 round_checkpoint。\n\n请输出 JSON 规划。`;
  const raw = await adapter.complete({
    system: promptManager.plannerNextSteps(),
    userText,
    signal: ctx.signal,
    temperature: 0.08,
  });
  return String(raw || '').trim();
}
