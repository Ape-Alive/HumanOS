'use strict';

const os = require('os');
const { app, BrowserWindow, ipcMain, session, desktopCapturer, clipboard, screen, systemPreferences } =
  require('electron');

/**
 * 局域网 WebRTC 需要拿到「真实」host 候选；新版 Chromium 往往不能只靠关闭 mDNS 特性。
 * - force-webrtc-ip-handling-policy：显式允许暴露私网接口（官方策略名）
 * - WebRtcHideLocalIpsWithMdns：旧路径，仍保留以兼容旧内核
 * 均须在 app ready 之前设置。
 */
app.commandLine.appendSwitch(
  'force-webrtc-ip-handling-policy',
  'default_public_and_private_interfaces'
);
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

function scoreIp(addr) {
  if (/^192\.168\./.test(addr)) return 100;
  if (/^10\./.test(addr)) return 85;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(addr)) return 80;
  if (/^169\.254\./.test(addr)) return 25;
  return 45;
}

/** 虚拟/隧道网卡名降权，避免优先选 Docker/utun；仍可在没有更好地址时作为兜底 */
function ifacePenalty(name) {
  if (/^(lo|loopback)$/i.test(name)) return -10000;
  if (
    /^(docker|veth|br-|virbr|vboxnet|vmnet|utun|awdl|llw|bridge|hyper-v|vEthernet|vethernet)/i.test(name)
  )
    return -35;
  return 0;
}

function pickLanIPv4() {
  const nets = os.networkInterfaces();
  /** @type {{ address: string, score: number }[]} */
  const candidates = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const fam = net.family;
      const isV4 = fam === 'IPv4' || fam === 4;
      if (!isV4 || net.internal) continue;
      const a = net.address;
      if (!a || a === '127.0.0.1') continue;
      const score = scoreIp(a) + ifacePenalty(name);
      candidates.push({ address: a, score });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best.score < 0) return null;
  return best.address;
}

/** 开发时开第二个 Electron 实例时设置，避免与第一个实例共用 userData / localStorage */
{
  const suffix = process.env.HUMANOS_USER_DATA_SUFFIX;
  if (suffix) {
    const base = app.getPath('userData');
    app.setPath('userData', `${base}-${suffix}`);
  }
}

const { createMainWindow } = require('./windowManager.js');
const { dispatch: dispatchInput } = require('./inputDispatcher.js');
const { registerAgentDbIpc } = require('./agentDb/ipc.js');
const { registerAiHttpIpc } = require('./aiHttpIpc.js');
const { rankDesktopScreenSources } = require('./screenSourcesRank.js');
const { installHumanosDisplayMediaHandler } = require('./displayMediaHandler.js');

function registerIpc() {
  const { initAgentDatabase } = require('./agentDb/repository.js');
  initAgentDatabase().catch((e) => console.warn('[HumanOS] agent DB init', e));

  ipcMain.handle('app:get-default-signal-url', () => {
    const explicit = process.env.HUMANOS_SIGNAL_WS_URL;
    if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
    const port = process.env.SIGNAL_PORT || '8787';
    return `ws://127.0.0.1:${port}/ws`;
  });
  /** 被控端展示 / 复制邀请：局域网建议 ws 与本机 IPv4 */
  ipcMain.handle('app:get-invite-signal-hint', () => {
    const port = process.env.SIGNAL_PORT || '8787';
    const explicit = process.env.HUMANOS_SIGNAL_WS_URL;
    if (typeof explicit === 'string' && explicit.trim()) {
      return { suggestedUrl: explicit.trim(), lanIpv4: pickLanIpv4() };
    }
    const lan = pickLanIPv4();
    if (lan) return { suggestedUrl: `ws://${lan}:${port}/ws`, lanIpv4: lan };
    /** 无可用局域网网卡时仍给本机信令地址；IPv4 显示为回环便于理解「仅本机」 */
    return { suggestedUrl: `ws://127.0.0.1:${port}/ws`, lanIpv4: '127.0.0.1' };
  });
  ipcMain.handle('clipboard:write-text', (_event, text) => {
    try {
      clipboard.writeText(String(text ?? ''));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
  ipcMain.handle('input:dispatch', async (_event, cmd) => dispatchInput(cmd));

  async function listRankedScreenSources() {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    if (!sources.length) return [];
    let primaryId = '';
    try {
      primaryId = String(screen.getPrimaryDisplay().id);
    } catch {
      /* ignore */
    }
    return rankDesktopScreenSources(sources, screen.getAllDisplays(), primaryId);
  }

  /**
   * 被控端采集：返回按优先级排序的若干 screen sourceId，供渲染进程依次 getUserMedia(desktop) 尝试。
   */
  ipcMain.handle('screen:get-desktop-capture-source-ids', async () => {
    const ranked = await listRankedScreenSources();
    return { ids: ranked.slice(0, 8).map((s) => s.id) };
  });

  /**
   * 被控端采集：单个最佳 sourceId（兼容旧 preload）。
   */
  ipcMain.handle('screen:get-primary-source-id', async () => {
    const ranked = await listRankedScreenSources();
    return ranked[0]?.id ?? null;
  });

  /** 被控端 UI：主显示器逻辑分辨率（与 scaleFactor 一并返回） */
  ipcMain.handle('screen:get-primary-display-spec', () => {
    try {
      const d = screen.getPrimaryDisplay();
      const w = d.size?.width ?? d.bounds?.width ?? 0;
      const h = d.size?.height ?? d.bounds?.height ?? 0;
      return {
        width: w,
        height: h,
        scaleFactor: d.scaleFactor ?? 1,
      };
    } catch {
      return { width: 0, height: 0, scaleFactor: 1 };
    }
  });

  /** 被控端启动前：屏幕录制权限状态 + 可共享的显示器列表（供前端校验与选择） */
  ipcMain.handle('screen:get-agent-capture-preflight', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    const hasSources = sources.length > 0;
    let screenAccessStatus = 'unknown';
    try {
      if (typeof systemPreferences.getMediaAccessStatus === 'function') {
        screenAccessStatus = systemPreferences.getMediaAccessStatus('screen');
      }
    } catch {
      screenAccessStatus = 'unknown';
    }
    let primaryId = '';
    try {
      primaryId = String(screen.getPrimaryDisplay().id);
    } catch {
      /* ignore */
    }
    const ranked = hasSources ? rankDesktopScreenSources(sources, screen.getAllDisplays(), primaryId) : [];
    const list = ranked.slice(0, 16).map((s) => ({
      id: s.id,
      name: String(s.name || '显示器'),
      displayId: s.display_id != null ? String(s.display_id) : '',
    }));
    const denied = screenAccessStatus === 'denied';
    return {
      ok: true,
      platform: process.platform,
      screenAccessStatus,
      hasSources,
      denied,
      /** 建议阻止启动：系统明确拒绝，或当前枚举不到任何显示器源 */
      shouldBlockStart: denied || !hasSources,
      sources: list,
    };
  });

  registerAgentDbIpc();
  registerAiHttpIpc();
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (
      permission === 'media' ||
      permission === 'display-capture' ||
      permission === 'audioCapture' ||
      permission === 'videoCapture' ||
      /** HTML5 全屏（控制端「全屏观看」）；未放行时 requestFullscreen 无效果 */
      permission === 'fullscreen'
    ) {
      callback(true);
      return;
    }
    callback(false);
  });

  installHumanosDisplayMediaHandler();

  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
