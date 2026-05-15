/**
 * 从「已执行摘要」行中解析单步 JSON（形如 `步骤 k: {...}`）。
 * @param {string} line
 * @returns {Record<string, unknown> | null}
 */
function parseExecutedStepLine(line) {
  const i = line.indexOf('{');
  if (i < 0) return null;
  try {
    return JSON.parse(line.slice(i));
  } catch {
    return null;
  }
}

/** @param {unknown} v */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 若近期多次在相近归一化坐标上 click，判定为「卡住」，给 Planner 一段中文约束，
 * 促使其改用键盘切换、Dock、滚动等，而不是继续点同一区域。
 *
 * @param {string[]} executedLines
 * @returns {string} 空字符串表示无需附加提示
 */
export function buildPlannerStagnationHint(executedLines) {
  const lines = Array.isArray(executedLines) ? executedLines : [];
  const tail = lines.slice(-16);
  /** @type {{ nx: number, ny: number }[]} */
  const recentClicks = [];
  for (const line of tail) {
    const s = parseExecutedStepLine(line);
    if (!s || String(s.action || '').toLowerCase() !== 'click') continue;
    const nx = num(s.nx);
    const ny = num(s.ny);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
    recentClicks.push({ nx, ny });
  }
  if (recentClicks.length < 2) return '';

  const last = recentClicks[recentClicks.length - 1];
  let sameAsLast = 0;
  const thr = 55;
  for (let i = recentClicks.length - 1; i >= 0; i--) {
    const c = recentClicks[i];
    if (Math.abs(c.nx - last.nx) <= thr && Math.abs(c.ny - last.ny) <= thr) sameAsLast += 1;
    else break;
  }

  let clusterMax = 0;
  for (let i = 0; i < recentClicks.length; i++) {
    let cnt = 0;
    const a = recentClicks[i];
    for (let j = 0; j < recentClicks.length; j++) {
      const b = recentClicks[j];
      if (Math.abs(a.nx - b.nx) <= thr && Math.abs(a.ny - b.ny) <= thr) cnt += 1;
    }
    clusterMax = Math.max(clusterMax, cnt);
  }

  const clickHeavy = recentClicks.length >= 4 && recentClicks.length >= tail.length * 0.55;
  const stuckTail = sameAsLast >= 3;
  const stuckCluster = clusterMax >= 4;

  if (!stuckTail && !stuckCluster && !(clickHeavy && clusterMax >= 3)) return '';

  const severity = stuckTail || clusterMax >= 5 ? '强' : '中';
  return `【系统提示（${severity}）：近期在相近归一化坐标多次 click，可能未命中目标或界面未切换】
请勿继续在**同一屏幕区域**（nx/ny 彼此相差 < 约 55）重复单击指望「点出来」。本轮规划必须**明显换策略**，至少包含其一：
1) 用 **press_key** 做窗口/应用切换或退出遮挡（如 **Tab**（可配合 altKey/metaKey）、**Escape**）；在 macOS 上若要 Spotlight，可用 **code: "Space", metaKey: true**（先确保焦点在桌面或尝试一次），或 **ArrowDown/Enter** 在列表中选取。
2) 先 **move** 到 **Dock/任务栏/启动台/桌面其它窗口** 等**不同区域**再 **click**，或 **wheel** 滚动后再点。
3) 插入 **wait_ms**（建议 600～1500）等待动画/加载后再操作**与此前不同的坐标**。
若用户目标是「打开某应用」而当前不在该应用内，**优先切到该应用前台**，再点应用内部控件。`;
}
