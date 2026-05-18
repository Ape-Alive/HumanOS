import { promptManager } from '../prompts/promptManager.js';

/**
 * 多任务入库/导出用：去掉 data URL 截图，保留文字，避免 DB 截断与 PDF 超长 URL。
 * @param {string} md
 * @param {string} [placeholder]
 */
export function stripDataUrlImagesFromMarkdown(md, placeholder = '_[截图已省略]_') {
  return String(md || '').replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/gi, (_, cap) => {
    const label = String(cap || '').trim();
    return label ? `${placeholder}（${label}）` : placeholder;
  });
}

/**
 * @param {{
 *   taskGoal: string,
 *   taskId: string,
 *   outcome: string,
 *   rounds: {
 *     round: number,
 *     vision: string,
 *     analysis: string,
 *     stepsExecuted: string[],
 *     roundCheckpoint?: string,
 *     criticRound?: { status: string, evidence: string } | null,
 *     roundEndVisionAssert?: { passed: boolean, evidence: string } | null,
 *     prePlanDataUrl?: string | null,
 *     postExecDataUrl?: string | null,
 *   }[],
 *   finalAssertion: { passed: boolean, evidence: string },
 *   finalFrameDataUrl?: string | null,
 *   errorMessage?: string,
 * }} p
 */
export function buildMarkdownReport(p) {
  let md = promptManager.reportHeader(p.taskGoal);
  md += `**任务 ID**：\`${p.taskId}\`\n\n`;
  md += `**结果**：${p.outcome}\n\n`;
  if (p.errorMessage) md += `**错误**：${p.errorMessage}\n\n`;
  md += `## 最终验收\n\n`;
  if (p.finalFrameDataUrl) {
    md += `**最终画面（关键截图）**\n\n![](${p.finalFrameDataUrl})\n\n`;
  }
  md += `- 通过：${p.finalAssertion.passed ? '是' : '否'}\n- 依据：${p.finalAssertion.evidence || '—'}\n\n`;
  md += `## 执行轮次\n\n`;
  for (const r of p.rounds) {
    md += `### 第 ${r.round + 1} 轮\n\n`;
    if (r.prePlanDataUrl) {
      md += `**本轮 · 规划前画面**\n\n![](${r.prePlanDataUrl})\n\n`;
    }
    md += `**Vision**\n\n${r.vision}\n\n`;
    md += `**规划分析**：${r.analysis || '—'}\n\n`;
    if (r.roundCheckpoint) {
      md += `**本轮 checkpoint**：${r.roundCheckpoint}\n\n`;
    }
    if (r.criticRound) {
      md += `**Critic（轮末）**：${r.criticRound.status} — ${r.criticRound.evidence || '—'}\n\n`;
    }
    if (r.roundEndVisionAssert) {
      md += `**轮末截图验收**：${r.roundEndVisionAssert.passed ? '通过' : '未通过'} — ${r.roundEndVisionAssert.evidence || '—'}\n\n`;
    }
    if (r.postExecDataUrl) {
      md += `**本轮 · 执行后画面（轮末验收用图）**\n\n![](${r.postExecDataUrl})\n\n`;
    }
    md += `**已执行步骤**：\n\n`;
    for (const line of r.stepsExecuted) {
      md += `- ${line}\n`;
    }
    md += `\n`;
  }
  md += `---\n\n*由 HumanOS AI Agent Layer 自动生成*\n`;
  return md;
}

/**
 * @param {{
 *   sourceFileName: string,
 *   items: { index: number, goal: string, outcome: string, taskId: string, markdown: string }[],
 * }} p
 */
export function buildBatchMarkdownReport(p) {
  const name = String(p.sourceFileName || '—');
  const items = Array.isArray(p.items) ? p.items : [];
  const passN = items.filter((x) => x.outcome === 'passed').length;
  let md = `# HumanOS 多任务测试报告\n\n`;
  md += `**来源文件**：${name}\n\n`;
  md += `**子任务数**：${items.length}（通过 ${passN} / 未通过或失败 ${items.length - passN}）\n\n`;
  md += `| # | 结果 | 目标摘要 |\n|---|------|----------|\n`;
  for (const it of items) {
    const goalOne = String(it.goal || '')
      .replace(/\|/g, '\\|')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    md += `| ${it.index + 1} | ${it.outcome} | ${goalOne || '—'} |\n`;
  }
  md += `\n---\n\n`;
  for (const it of items) {
    md += `## 子任务 ${it.index + 1} / ${items.length}\n\n`;
    md += `**目标**：${it.goal}\n\n`;
    md += `**结果**：${it.outcome}\n\n`;
    let body = String(it.markdown || '').replace(/^#\s+HumanOS[^\n]*\n*/i, '').trim();
    body = stripDataUrlImagesFromMarkdown(body);
    md += body ? `${body}\n\n` : `*（该子任务无详细报告正文）*\n\n`;
    md += `---\n\n`;
  }
  md += `*由 HumanOS AI Agent 多任务编排自动生成*\n`;
  return md;
}

/**
 * 历史导出：若 DB 中 markdown 被截断，尝试用 summary_json 中的子任务正文重建。
 * @param {{ markdown?: string, summary_json?: string, outcome?: string }} result
 * @param {{ goal?: string }} [task]
 */
export function resolveHistoryReportMarkdown(result, task) {
  const md = String(result?.markdown || '');
  const goal = String(task?.goal || '');
  const isBatch = goal.startsWith('多任务:') || result?.outcome === 'batch';
  if (!isBatch) return md;

  let summary = null;
  try {
    summary =
      result?.summary_json && typeof result.summary_json === 'string'
        ? JSON.parse(result.summary_json)
        : null;
  } catch {
    summary = null;
  }
  const items = Array.isArray(summary?.items) ? summary.items : [];
  const expected = summary?.subtaskCount || items.length;
  const sectionCount = (md.match(/## 子任务 \d+/g) || []).length;
  if (expected > 0 && sectionCount >= expected && md.includes('多任务测试报告')) {
    return md;
  }
  if (items.length && items.some((x) => x.markdown)) {
    return buildBatchMarkdownReport({
      sourceFileName: summary?.sourceFileName || '历史多任务',
      items: items.map((x, i) => ({
        index: typeof x.index === 'number' ? x.index : i,
        goal: x.goal || '',
        outcome: x.outcome || '—',
        taskId: x.taskId || '',
        markdown: x.markdown || '',
      })),
    });
  }
  return md;
}
