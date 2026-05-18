import { promptManager } from '../prompts/promptManager.js';
import { extractJsonObject } from './actionGenerator.js';

/**
 * @param {unknown} raw
 * @returns {{ status: 'passed' | 'partial' | 'failed', evidence: string, suggested_next: string }}
 */
export function normalizeCriticResult(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const st = String(o.status || o.result || '').toLowerCase();
  let status = 'failed';
  if (st === 'passed' || st === 'pass' || st === 'true') status = 'passed';
  else if (st === 'partial' || st === 'ongoing' || st === 'in_progress') status = 'partial';
  return {
    status: /** @type {'passed' | 'partial' | 'failed'} */ (status),
    evidence: typeof o.evidence === 'string' ? o.evidence : '',
    suggested_next: typeof o.suggested_next === 'string' ? o.suggested_next : typeof o.suggestedNext === 'string' ? o.suggestedNext : '',
  };
}

/**
 * Critic：独立于 Planner，根据截图判断 checkpoint 是否满足（像人一样看结果）。
 * @param {ReturnType<typeof import('../plugins/openAiVisionChat.js').createOpenAiCompatibleAdapter>} adapter
 * @param {{
 *   userGoal: string,
 *   checkpoint: string,
 *   capture: { base64: string, mime: string },
 *   lastAction?: string,
 *   totalSuccessCriteria?: string,
 *   signal?: AbortSignal,
 * }} ctx
 */
export async function runCriticCheckpoint(adapter, ctx) {
  const cp = String(ctx.checkpoint || '').trim();
  if (!cp) {
    return { status: 'partial', evidence: '未提供 checkpoint，跳过严格评审', suggested_next: '' };
  }
  let userText = `【用户总目标】\n${ctx.userGoal}\n\n【本轮/checkpoint 验收标准】\n${cp}\n`;
  if (ctx.totalSuccessCriteria) {
    userText += `\n【总成功标准（参考）】\n${ctx.totalSuccessCriteria}\n`;
  }
  if (ctx.lastAction) {
    userText += `\n【刚执行的操作】\n${ctx.lastAction}\n`;
  }
  userText += `\n请仔细阅读截图中**回复区/结果区/主内容区**的文字与界面状态，判断 checkpoint 是否成立。输出 JSON。`;

  const raw = await adapter.complete({
    system: promptManager.criticCheckpointVision(),
    userText,
    imageBase64: ctx.capture.base64,
    mime: ctx.capture.mime,
    signal: ctx.signal,
    temperature: 0.05,
  });
  try {
    return normalizeCriticResult(extractJsonObject(String(raw || '')));
  } catch {
    return { status: 'failed', evidence: 'Critic JSON 解析失败', suggested_next: '' };
  }
}

/** @param {{ status: string }} r */
export function criticIsPass(r) {
  return r.status === 'passed';
}

/** @param {{ status: string }} r */
export function criticNeedsContinue(r) {
  return r.status === 'partial' || r.status === 'failed';
}

/**
 * @param {{ status: string, evidence: string, suggested_next?: string }} critic
 * @param {{ status?: string, evidence?: string }} [roundCritic]
 */
export function buildContinueFeedback(critic, roundCritic) {
  const parts = ['【须继续·未达总目标】'];
  if (roundCritic?.evidence && roundCritic.status !== 'passed') {
    parts.push(`本轮：${roundCritic.evidence}`);
  }
  parts.push(`总目标：${critic.evidence}`);
  if (critic.suggested_next) parts.push(`建议下一步：${critic.suggested_next}`);
  parts.push('禁止 macro_done；须根据建议继续输入/点击，直到总成功标准满足。');
  return parts.join(' ');
}
