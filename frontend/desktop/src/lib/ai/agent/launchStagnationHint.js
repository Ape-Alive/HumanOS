/**
 * 打开应用失败多次时，建议降级 launch 方式（Spotlight/Win搜索 → shell）。
 * @param {string[]} executedLines
 * @param {string} currentMethod spotlight|win_search|shell|auto
 * @returns {string}
 */
export function buildLaunchDegradeHint(executedLines, currentMethod) {
  const lines = Array.isArray(executedLines) ? executedLines : [];
  let launchCount = 0;
  let launchFailHints = 0;
  for (const line of lines.slice(-12)) {
    if (/launch_app|"action":"launch_app"/i.test(line)) launchCount += 1;
    if (/\bshell:\s/i.test(line) || /open\s+-a|cmd\.exe\s+\/c\s+start/i.test(line)) launchCount += 1;
    if (/Critic\(打开应用\)/i.test(line) && /failed|partial|未通过/i.test(line)) launchFailHints += 1;
    if (/打开|launch|应用.*未|前台/i.test(line) && /Critic|未通过|failed|partial/i.test(line)) {
      launchFailHints += 1;
    }
  }
  if (launchCount < 1 && launchFailHints < 1) return '';

  const method = String(currentMethod || 'spotlight');
  if (method === 'shell' && shouldResetLaunchToAuto(lines, method)) {
    return `【系统提示：命令行打开多次仍失败】请修正 app_name，或改用 launch_app 且 method 为 "auto" 重试 Spotlight/Win 搜索；勿重复 shell。`;
  }
  if (method === 'shell') {
    return `【系统提示：已使用命令行打开应用仍不理想】请检查应用名是否正确，或尝试 click 聚焦窗口；避免重复 launch_app。`;
  }
  return `【系统提示：打开/切换应用未成功】本轮请勿再盲目 click Dock。请改用 launch_app 且 method 设为 "shell"（命令行兜底）；或修正 app_name 后重试 Spotlight/Win 搜索。当前键盘方式已尝试：${method}。`;
}

/**
 * shell 连续失败后允许恢复 auto（键盘启动）。
 * @param {string[]} executedLines
 * @param {string} currentMethod
 */
export function shouldResetLaunchToAuto(executedLines, currentMethod) {
  if (String(currentMethod || '') !== 'shell') return false;
  const lines = Array.isArray(executedLines) ? executedLines : [];
  let shellFail = 0;
  let openCriticFail = 0;
  for (const line of lines.slice(-10)) {
    if (/\bshell:.*→\s*fail/i.test(line)) shellFail += 1;
    if (/Critic\(打开应用\).*—\s*(failed|partial)/i.test(line)) openCriticFail += 1;
  }
  return shellFail >= 2 || openCriticFail >= 2;
}
