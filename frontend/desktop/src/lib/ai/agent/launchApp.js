/**
 * 打开桌面应用：Mac Spotlight / Win 搜索 / shell 兜底。
 */

/** @typedef {'auto'|'spotlight'|'win_search'|'shell'} LaunchMethod */

/** @param {string} platform @returns {'darwin'|'win32'|''} */
export function normalizeRemotePlatform(platform) {
  const p = String(platform || '').toLowerCase();
  if (p === 'win32' || p === 'windows') return 'win32';
  if (p === 'darwin' || p === 'macos' || p === 'mac') return 'darwin';
  return '';
}

/** @param {string} platform */
export function isKnownRemotePlatform(platform) {
  const p = normalizeRemotePlatform(platform);
  return p === 'darwin' || p === 'win32';
}

/**
 * 等待被控端 agent_hello（避免首轮误用 darwin 默认）。
 * @param {() => string | undefined} getPlatform
 * @param {{ timeoutMs?: number, pollMs?: number }} [opts]
 * @returns {Promise<'darwin'|'win32'|''>}
 */
export async function waitForRemotePlatform(getPlatform, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const pollMs = opts.pollMs ?? 80;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const p = normalizeRemotePlatform(getPlatform?.() ?? '');
    if (p) return p;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return normalizeRemotePlatform(getPlatform?.() ?? '');
}

/** @param {string} raw @returns {string} */
export function normalizeAppSearchName(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const aliases = {
    chrome: 'Google Chrome',
    googlechrome: 'Google Chrome',
    vscode: 'Visual Studio Code',
    code: 'Visual Studio Code',
    'visual studio code': 'Visual Studio Code',
    terminal: 'Terminal',
    iterm: 'iTerm',
    safari: 'Safari',
    wechat: 'WeChat',
    微信: 'WeChat',
    wework: '企业微信',
    企业微信: '企业微信',
    cursor: 'Cursor',
    finder: 'Finder',
  };
  const k = s.toLowerCase().replace(/\s+/g, '');
  return aliases[k] || s;
}

/** @param {string} appName */
export function buildLaunchOpenCheckpoint(appName) {
  const name = normalizeAppSearchName(appName) || String(appName || '').trim() || '目标应用';
  return `应用「${name}」已在前台打开或窗口清晰可见；若仍在桌面、Spotlight/搜索框、或其他应用前台，则未通过。`;
}

/**
 * @param {string} appName
 * @param {string} platform darwin|win32
 */
export function buildShellLaunchCommand(appName, platform) {
  const name = normalizeAppSearchName(appName);
  if (!name) return '';
  const plat = normalizeRemotePlatform(platform);
  if (plat !== 'darwin' && plat !== 'win32') return '';
  if (plat === 'win32') {
    const token = name.replace(/"/g, '');
    if (/^[a-z0-9._-]+$/i.test(token) && token.length < 64) {
      return `cmd.exe /c start "" ${token}`;
    }
    return `cmd.exe /c start "" "${token.replace(/"/g, '')}"`;
  }
  if (name.includes(' ')) return `open -a "${name.replace(/"/g, '')}"`;
  return `open -a ${name}`;
}

/**
 * @param {{ appName: string, platform: string, method?: LaunchMethod }} p
 * @returns {LaunchMethod}
 */
export function resolveLaunchMethod(p) {
  const m = String(p.method || 'auto').toLowerCase();
  if (m === 'spotlight' || m === 'win_search' || m === 'shell') return /** @type {LaunchMethod} */ (m);
  const plat = normalizeRemotePlatform(p.platform);
  if (plat === 'win32') return 'win_search';
  if (plat === 'darwin') return 'spotlight';
  return 'shell';
}

/**
 * 展开为 Planner 可识别的 step 列表（再由 stepToControlCommands 转控制指令）。
 * @param {{ appName: string, platform: string, method?: LaunchMethod }} p
 * @returns {Record<string, unknown>[]}
 */
export function expandLaunchAppToSteps(p) {
  const appName = normalizeAppSearchName(p.appName);
  if (!appName) return [];
  const plat = normalizeRemotePlatform(p.platform);
  const method = resolveLaunchMethod({ ...p, platform: plat });

  if (method === 'shell' || !plat) {
    return [{ action: 'launch_app', app_name: appName, method: 'shell' }];
  }

  if (method === 'spotlight' && plat === 'darwin') {
    return [
      { action: 'press_key', code: 'Escape' },
      { action: 'wait_ms', ms: 120 },
      { action: 'press_key', code: 'Space', metaKey: true },
      { action: 'wait_ms', ms: 450 },
      { action: 'type_text', text: appName },
      { action: 'wait_ms', ms: 200 },
      { action: 'press_key', code: 'Enter' },
      { action: 'wait_ms', ms: 600 },
    ];
  }

  if (method === 'win_search' && plat === 'win32') {
    return [
      { action: 'press_key', code: 'Escape' },
      { action: 'wait_ms', ms: 120 },
      { action: 'press_key', code: 'MetaLeft', phase: 'down' },
      { action: 'press_key', code: 'MetaLeft', phase: 'up' },
      { action: 'wait_ms', ms: 450 },
      { action: 'type_text', text: appName },
      { action: 'wait_ms', ms: 200 },
      { action: 'press_key', code: 'Enter' },
      { action: 'wait_ms', ms: 600 },
    ];
  }

  return [{ action: 'launch_app', app_name: appName, method: 'shell' }];
}

/** @param {string} platform */
export function launchMethodLabel(platform, method) {
  const plat = normalizeRemotePlatform(platform);
  const m = resolveLaunchMethod({ appName: 'x', platform: plat, method });
  if (m === 'spotlight') return 'Spotlight (⌘Space)';
  if (m === 'win_search') return 'Win 搜索';
  return '命令行';
}
