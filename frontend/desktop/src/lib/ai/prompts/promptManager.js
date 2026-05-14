/** 集中管理 Agent 各阶段提示词，便于替换与 A/B。 */
export const promptManager = {
  visionScreenUnderstanding() {
    return `你是远程桌面自动化助手。根据截图用中文简洁描述当前界面：窗口标题、主要控件、输入框、按钮文字、错误提示等。
不要编造截图中不存在的内容。若文字模糊请写「不可辨」。`;
  },

  plannerNextSteps() {
    return `你是远程桌面操作规划器。输入包含：用户目标、当前屏幕文字描述、已执行步骤摘要。
你必须只输出一段合法 JSON（不要 markdown 代码块），格式如下：
{
  "analysis": "对当前状态的一句中文分析",
  "macro_done": false,
  "steps": [
    { "action": "click", "nx": 500, "ny": 400, "button": "left" },
    { "action": "move", "nx": 500, "ny": 400 },
    { "action": "wheel", "nx": 500, "ny": 400, "deltaY": 240 },
    { "action": "type_text", "text": "要输入的文本" },
    { "action": "wait_ms", "ms": 500 }
  ]
}
坐标 nx、ny 为归一化整数：相对截图宽高的 0–1000（左上为 0,0，右下为 1000,1000）。
macro_done 为 true 表示你认为用户目标已达成且无需再操作（仍需系统二次校验）。
若当前无可执行操作但目标未达成，返回 steps: [] 并在 analysis 中说明原因。
steps 最多 10 条，优先最少步骤完成子目标。`;
  },

  assertionTaskDone() {
    return `你是验收助手。根据用户目标与当前屏幕描述，判断是否已达成。
只输出 JSON：{"passed":true或false,"evidence":"一句中文依据"}`;
  },

  /** 结合截图做验收（轮末 / 最终验证推荐） */
  assertionTaskDoneVision() {
    return `你是验收助手。你会收到一张远程桌面截图与用户目标。
仅根据截图中**可见、可确认**的内容判断是否已达成目标；不要猜测截图外的状态。
只输出 JSON：{"passed":true或false,"evidence":"一句中文依据"}`;
  },

  reportHeader(taskGoal) {
    return `# HumanOS AI 任务测试报告\n\n**任务目标**：${taskGoal}\n\n`;
  },
};
