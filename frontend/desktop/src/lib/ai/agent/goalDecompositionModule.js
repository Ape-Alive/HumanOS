import { promptManager } from '../prompts/promptManager.js';
import { extractJsonObject } from './actionGenerator.js';

/**
 * @param {unknown} raw
 */
export function normalizeTaskPlan(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const totalSuccessCriteria =
    typeof o.total_success_criteria === 'string' && o.total_success_criteria.trim()
      ? o.total_success_criteria.trim()
      : typeof o.totalSuccessCriteria === 'string'
        ? o.totalSuccessCriteria.trim()
        : '';
  const phasesIn = Array.isArray(o.phases) ? o.phases : [];
  /** @type {{ id: number, title: string, checkpoint: string, done_when: string, not_done_when: string }[]} */
  const phases = [];
  for (let i = 0; i < phasesIn.length; i++) {
    const p = phasesIn[i];
    if (!p || typeof p !== 'object') continue;
    const po = /** @type {Record<string, unknown>} */ (p);
    const checkpoint = String(po.checkpoint || po.check_point || '').trim();
    if (!checkpoint) continue;
    phases.push({
      id: Number(po.id) > 0 ? Math.floor(Number(po.id)) : i + 1,
      title: String(po.title || `阶段${i + 1}`).trim(),
      checkpoint,
      done_when: String(po.done_when || po.doneWhen || '').trim(),
      not_done_when: String(po.not_done_when || po.notDoneWhen || '').trim(),
    });
  }
  return {
    totalSuccessCriteria,
    phases: phases.slice(0, 8),
  };
}

/** @param {{ totalSuccessCriteria: string, phases: { id: number, title: string, checkpoint: string }[] }} plan */
export function formatTaskPlanForPrompt(plan, currentPhaseIndex) {
  let s = `【总成功标准】\n${plan.totalSuccessCriteria || '（与用户目标一致）'}\n\n【阶段/checkpoint】\n`;
  if (!plan.phases.length) {
    s += '（未拆分阶段，按用户总目标推进）\n';
    return s;
  }
  for (let i = 0; i < plan.phases.length; i++) {
    const p = plan.phases[i];
    const cur = i === currentPhaseIndex ? ' ← 当前' : i < currentPhaseIndex ? '（已完成）' : '';
    s += `${i + 1}. ${p.title} — checkpoint: ${p.checkpoint}${cur}\n`;
  }
  return s;
}

/** @param {{ phases: { checkpoint: string }[] }} plan @param {number} idx */
export function getPhaseCheckpoint(plan, idx) {
  const p = plan.phases[idx];
  return p?.checkpoint || '';
}

/**
 * @param {ReturnType<typeof import('../plugins/openAiVisionChat.js').createOpenAiCompatibleAdapter>} adapter
 * @param {{ userGoal: string, signal?: AbortSignal }} ctx
 */
export async function runGoalDecomposition(adapter, ctx) {
  const userText = `【用户目标】\n${ctx.userGoal}\n\n请输出 JSON 任务分解。`;
  const raw = await adapter.complete({
    system: promptManager.goalDecomposition(),
    userText,
    signal: ctx.signal,
    temperature: 0.12,
  });
  try {
    return normalizeTaskPlan(extractJsonObject(String(raw || '')));
  } catch {
    const g = ctx.userGoal;
    const isPolishChat = /润色|周报|deepseek|聊天|复制/i.test(g);
    if (isPolishChat) {
      return {
        totalSuccessCriteria:
          '对话中已出现润色后的完整周报正文（非仅「请提供原文」类索要），且可进行复制或已复制',
        phases: [
          {
            id: 1,
            title: '发出润色请求',
            checkpoint: 'DeepSeek 对话中已出现助手回复（可为索要周报原文）',
            done_when: '助手已回复',
            not_done_when: '无回复或仍在加载',
          },
          {
            id: 2,
            title: '提供周报原文',
            checkpoint: '用户消息区或输入框已发送周报工作内容原文',
            done_when: '原文已发送',
            not_done_when: '仅停留在索要原文、原文未发送',
          },
          {
            id: 3,
            title: '获得润色结果',
            checkpoint: '助手回复中出现润色后的周报正文（多段、成稿形态）',
            done_when: '润色成稿可见',
            not_done_when: '仅有索要材料、仅有确认语而无成稿',
          },
        ],
      };
    }
    return {
      totalSuccessCriteria: g,
      phases: [
        {
          id: 1,
          title: '完成用户目标',
          checkpoint: `屏幕可见证据表明：${g}`,
          done_when: '与目标直接相关的最终结果已出现',
          not_done_when: '仅中间提示、空页面、错误或仍在输入框未提交',
        },
      ],
    };
  }
}
