import { promptManager } from '../prompts/promptManager.js';
import { tryClipboardAssertion } from './clipboardAssertion.js';

/**
 * @param {string} raw
 */
function parseAssertionJson(raw) {
  try {
    const str = String(raw);
    const i = str.indexOf('{');
    const j = str.lastIndexOf('}');
    const parsed = JSON.parse(str.slice(i, j + 1));
    return {
      passed: !!parsed.passed,
      evidence: typeof parsed.evidence === 'string' ? parsed.evidence : '',
    };
  } catch {
    return { passed: false, evidence: '断言 JSON 解析失败' };
  }
}

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
    temperature: 0.1,
  });
  return parseAssertionJson(raw);
}

/**
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
    temperature: 0.06,
  });
  return parseAssertionJson(raw);
}

/**
 * 早帧（主图）+ 晚帧（extraCaptures）双图验收；任一张可见成功态即通过。
 * @param {ReturnType<typeof import('../plugins/openAiVisionChat.js').createOpenAiCompatibleAdapter>} adapter
 * @param {{
 *   userGoal: string,
 *   earlyCapture: { base64: string, mime: string },
 *   lateCapture: { base64: string, mime: string },
 *   signal?: AbortSignal,
 * }} ctx
 */
export async function runAssertionWithDualVision(adapter, ctx) {
  const userText = `【用户目标】\n${ctx.userGoal}\n\n图1为点击后较早截图，图2为轮末较晚截图。请输出 JSON。`;
  const raw = await adapter.complete({
    system: promptManager.assertionTaskDoneDualVision(),
    userText,
    imageBase64: ctx.earlyCapture.base64,
    mime: ctx.earlyCapture.mime,
    extraCaptures: [{ base64: ctx.lateCapture.base64, mime: ctx.lateCapture.mime }],
    signal: ctx.signal,
    temperature: 0.06,
  });
  return parseAssertionJson(raw);
}

/**
 * 综合验收：剪贴板 + 视觉。
 * - clipboardScope `round`（默认）：复制类任务下剪贴板或视觉任一通过即可。
 * - clipboardScope `task`：任务级剪贴板对比（macro/最终），禁止仅凭剪贴板通过，须视觉也通过。
 * @param {ReturnType<typeof import('../plugins/openAiVisionChat.js').createOpenAiCompatibleAdapter>} adapter
 * @param {{
 *   userGoal: string,
 *   lateCapture: { base64: string, mime: string },
 *   earlyCapture?: { base64: string, mime: string } | null,
 *   clipboardBefore?: string | null,
 *   clipboardAfter?: string | null,
 *   hadInteraction?: boolean,
 *   clipboardScope?: 'round' | 'task',
 *   roundCheckpoint?: string,
 *   totalSuccessCriteria?: string,
 *   signal?: AbortSignal,
 * }} ctx
 */
export async function runRoundEndAssertion(adapter, ctx) {
  const clipboardScope = ctx.clipboardScope === 'task' ? 'task' : 'round';
  const checkpointHint = ctx.roundCheckpoint
    ? `\n【本轮 checkpoint】${ctx.roundCheckpoint}\n`
    : ctx.totalSuccessCriteria
      ? `\n【总成功标准】${ctx.totalSuccessCriteria}\n`
      : '';
  const clipNotes = [];
  let clipPassed = false;
  let clipEvidence = '';
  if (ctx.clipboardBefore != null && ctx.clipboardAfter != null) {
    const cb = tryClipboardAssertion(ctx.clipboardBefore, ctx.clipboardAfter, ctx.userGoal, {
      hadInteraction: !!ctx.hadInteraction,
    });
    if (cb.passed) {
      clipPassed = true;
      clipEvidence = cb.evidence;
    } else if (!cb.skipped && cb.evidence) {
      clipNotes.push(cb.evidence);
    }
  }

  const visionGoal = `${ctx.userGoal}${checkpointHint}`;

  let vision;
  if (ctx.earlyCapture?.base64 && ctx.lateCapture?.base64) {
    vision = await runAssertionWithDualVision(adapter, {
      userGoal: visionGoal,
      earlyCapture: ctx.earlyCapture,
      lateCapture: ctx.lateCapture,
      signal: ctx.signal,
    });
  } else {
    vision = await runAssertionWithVision(adapter, {
      userGoal: visionGoal,
      capture: ctx.lateCapture,
      signal: ctx.signal,
    });
  }

  if (clipboardScope === 'task' && clipPassed && !vision.passed) {
    clipNotes.push('任务级剪贴板已变化，但视觉未确认，不能仅凭剪贴板通过');
  }

  if (clipPassed && vision.passed) {
    return {
      passed: true,
      evidence: `剪贴板：${clipEvidence}；视觉：${vision.evidence}`,
    };
  }
  if (clipPassed && clipboardScope === 'round') {
    return { passed: true, evidence: `剪贴板验收：${clipEvidence}` };
  }
  if (vision.passed) {
    return { passed: true, evidence: vision.evidence };
  }

  const parts = [...clipNotes, vision.evidence].filter(Boolean);
  return { passed: false, evidence: parts.join('；') || '验收未通过' };
}
