import { extractJsonObject } from './actionGenerator.js';
import { promptManager } from '../prompts/promptManager.js';

const MAX_DOC_CHARS = 60000;
/** 同时传 Gemini 附件时，抽取正文略缩短以控制总 token */
const MAX_DOC_CHARS_WITH_FILE = 36000;
const MAX_SUBTASKS = 40;

/**
 * 将测试文档拆成可顺序执行的子任务（可选：把原件作为 inlineData 附件发给 Gemini）。
 * @param {{ complete: (req: { system: string, userText: string, signal?: AbortSignal, attachments?: { mimeType: string, data: string, fileName?: string }[] }) => Promise<string>, kind?: string }} adapter
 * @param {string} documentText
 * @param {(s: string) => void} addLog
 * @param {AbortSignal} signal
 * @param {{ mime: string, base64: string, fileName?: string } | null | undefined} attachment
 * @returns {Promise<string[]>}
 */
export async function splitSubtasksFromDocument(adapter, documentText, addLog, signal, attachment) {
  const raw = String(documentText || '').trim();
  const hasFile =
    attachment &&
    typeof attachment.base64 === 'string' &&
    attachment.base64.length > 0 &&
    typeof attachment.mime === 'string';
  if (!raw && !hasFile) {
    addLog('多任务: 文档内容为空且无附件');
    return [];
  }
  const maxChars = hasFile ? MAX_DOC_CHARS_WITH_FILE : MAX_DOC_CHARS;
  const body = raw || '（无抽取文本，请仅根据附件中的原件理解需求并拆分子任务。）';
  const clipped = body.length > maxChars ? `${body.slice(0, maxChars)}\n\n…（文档已截断至 ${maxChars} 字符）` : body;
  addLog(`多任务: 正在调用模型拆分文档（${clipped.length} 字符${hasFile ? ' + 原件附件' : ''}，无截图）…`);
  const sys = promptManager.batchSplitSubtasks();
  const user = hasFile
    ? `以下为系统从文档抽取的正文（可能与原件排版不一致，**请结合附件原件**综合理解后拆分子任务）。\n\n---\n${clipped}\n---`
    : `以下为待分析的测试说明 / 用例全文（可能含 Markdown 或纯文本）：\n\n${clipped}`;
  const isGemini = String(adapter?.kind || '').toLowerCase() === 'gemini';
  const attachments =
    hasFile && isGemini
      ? [
          {
            mimeType: String(attachment.mime),
            data: String(attachment.base64).replace(/\s/g, ''),
            fileName: attachment.fileName,
          },
        ]
      : undefined;
  if (hasFile && !isGemini) {
    addLog('多任务: 当前为 OpenAI 兼容网关，将以「抽取文本」拆分；原件附件仅在选择 Gemini 执行模型时随请求发送。');
  }
  let text;
  try {
    text = await adapter.complete({ system: sys, userText: user, signal, attachments, temperature: 0.06 });
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
    addLog(`多任务: 拆分完成，共 ${out.length} 条子任务`);
    return out;
  } catch (e) {
    addLog(`多任务: 拆分 JSON 无效 — ${String(/** @type {{ message?: string }} */ (e)?.message || e)}`);
    addLog(`多任务: 模型原文片段：${String(text).slice(0, 400)}…`);
    return [];
  }
}
