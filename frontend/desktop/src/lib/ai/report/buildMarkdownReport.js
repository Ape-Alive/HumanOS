import { promptManager } from '../prompts/promptManager.js';

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
