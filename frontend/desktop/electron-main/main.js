'use strict';

const os = require('os');
const { app, BrowserWindow, ipcMain, session, desktopCapturer, clipboard, screen } = require('electron');

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

/** @returns {RTCIceServer[]} */
function readExtraIceServersFromEnv() {
  const raw = process.env.HUMANOS_ICE_SERVERS;
  if (!raw || !String(raw).trim()) return [];
  try {
    const j = JSON.parse(String(raw).trim());
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.iceServers)) return j.iceServers;
  } catch (e) {
    console.warn('[HumanOS] HUMANOS_ICE_SERVERS JSON 解析失败:', e?.message || e);
  }
  return [];
}

function registerIpc() {
  ipcMain.handle('app:get-rtc-ice-servers', () => readExtraIceServersFromEnv());
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
  /** 被控端采集：用主进程枚举屏幕，避免仅依赖 getDisplayMedia 在部分环境下无画面 */
  ipcMain.handle('screen:get-primary-source-id', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    if (!sources.length) return null;

    try {
      const primary = screen.getPrimaryDisplay();
      const want = String(primary.id);
      const byDisplayId = sources.find(
        (s) => s.display_id != null && String(s.display_id) === want
      );
      if (byDisplayId) return byDisplayId.id;
    } catch {
      /* ignore */
    }

    const nameMatch = sources.find((s) =>
      /entire|整个|full\s*screen|screen\s*\d|display\s*\d|主显示器|全屏/i.test(s.name)
    );
    if (nameMatch) return nameMatch.id;

    return sources[0].id;
  });
}

app.whenReady().then(() => {
  if (process.env.HUMANOS_ICE_SERVERS?.trim()) {
    const n = readExtraIceServersFromEnv().length;
    console.log(`[HumanOS] WebRTC: HUMANOS_ICE_SERVERS 已启用（${n} 条）`);
  }
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (
      permission === 'media' ||
      permission === 'display-capture' ||
      permission === 'audioCapture' ||
      permission === 'videoCapture'
    ) {
      callback(true);
      return;
    }
    callback(false);
  });

  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
