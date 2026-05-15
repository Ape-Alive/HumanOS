import { extractJsonObject } from './actionGenerator.js';
import { promptManager } from '../prompts/promptManager.js';

const MAX_DOC_CHARS = 60000;
const MAX_SUBTASKS = 40;

/**
 * 将测试文档拆成可顺序执行的子任务（纯文本，无截图）。
 * @param {{ complete: (req: { system: string, userText: string, signal?: AbortSignal }) => Promise<string> }} adapter
 * @param {string} documentText
 * @param {(s: string) => void} addLog
 * @param {AbortSignal} signal
 * @returns {Promise<string[]>}
 */
export async function splitSubtasksFromDocument(adapter, documentText, addLog, signal) {
  const raw = String(documentText || '').trim();
  if (!raw) {
    addLog('多任务: 文档内容为空');
    return [];
  }
  const clipped = raw.length > MAX_DOC_CHARS ? `${raw.slice(0, MAX_DOC_CHARS)}\n\n…（文档已截断至 ${MAX_DOC_CHARS} 字符）` : raw;
  const sys = promptManager.batchSplitSubtasks();
  const user = `以下为待分析的测试说明 / 用例全文（可能含 Markdown 或纯文本）：\n\n${clipped}`;
  let text;
  try {
    text = await adapter.complete({ system: sys, userText: user, signal });
  } catch (e) {
    addLog(`多任务: 拆分调用失败 ${String(/** @type {{ message?: string }} */ (e)?.message || e)}`);
    return [];
  }
  try {
    const obj = extractJsonObject(text);
    const arr = obj?.subtasks;
    if (!Array.isArray(arr)) throw new Error('缺少 subtasks 数组');
    const out = [];
    for (const x of arr) {
      const s = typeof x === 'string' ? x.trim() : String(x || '').trim();
      if (s) out.push(s.slice(0, 2000));
      if (out.length >= MAX_SUBTASKS) break;
    }
    if (!out.length) throw new Error('subtasks 为空');
    addLog(`多任务: 已拆分为 ${out.length} 个子任务`);
    return out;
  } catch (e) {
    addLog(`多任务: 拆分 JSON 无效 — ${String(/** @type {{ message?: string }} */ (e)?.message || e)}`);
    addLog(`多任务: 模型原文片段：${String(text).slice(0, 400)}…`);
    return [];
  }
}
