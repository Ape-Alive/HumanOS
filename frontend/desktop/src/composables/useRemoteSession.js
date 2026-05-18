import { ref, computed, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue';
import { generateControlCodeRaw, formatControlCodeDisplay } from '@/lib/codeGenerator.js';
import { SignalClient } from '@/lib/signal/SignalClient.js';
import { MESSAGE_TYPES as MT } from '@/lib/signal/protocol.js';
import {
  getStoredSignalUrlSync,
  setStoredSignalUrl,
  resolveSignalUrl,
} from '@/lib/config/signalEndpoint.js';
import { formatInviteBlock, parseInviteClipboard, normalizeSignalUrl } from '@/lib/inviteClipboard.js';
import { AgentRtcSession } from '@/lib/webrtc/agentRtcSession.js';
import { ControllerRtcSession } from '@/lib/webrtc/controllerRtcSession.js';

const AGENT_SIGNAL_LOCAL_KEY = 'humanos_agent_signal_local';
const RECENT_CONTROLLER_KEY = 'humanos_recent_controller_connections';
const RECENT_CONTROLLER_MAX = 40;

/** @param {number} ts */
function formatRelativeTimeZh(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - n) / 1000));
  if (sec < 15) return '刚刚';
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day} 天前`;
  const d = new Date(n);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function loadRecentConnectionsFromStorage() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(RECENT_CONTROLLER_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.codeDigits === 'string' && x.codeDigits.length >= 4)
      .map((x) => ({
        codeDigits: String(x.codeDigits).replace(/\D/g, '').slice(0, 8),
        signalUrl: typeof x.signalUrl === 'string' ? x.signalUrl : '',
        connectedAt: Number(x.connectedAt) || 0,
      }));
  } catch {
    return [];
  }
}

/**
 * @param {{ addLog: (s: string) => void }} deps
 */
export function useRemoteSession(deps) {
  const { addLog } = deps;

  /** @type {import('vue').Ref<'select'|'agent'|'controller'|'session'>} */
  const mode = ref('select');

  const controlCodeRaw = ref(generateControlCodeRaw());
  const controlCodeDisplay = computed(() => formatControlCodeDisplay(controlCodeRaw.value));

  const isAgentRunning = ref(false);
  const controllerCodeRaw = ref('');
  const controllerCodeDisplay = computed(() => formatControlCodeDisplay(controllerCodeRaw.value));

  const signalServerConnected = ref(false);
  const sessionBannerCode = ref('8392 1122');
  /** 控制端本次连接使用的信令 URL（用于写入最近连接） */
  const lastControllerSignalUrl = ref('');

  /** @type {import('vue').Ref<{ codeDigits: string, signalUrl: string, connectedAt: number }[]>} */
  const recentConnectionsRaw = ref(loadRecentConnectionsFromStorage());
  const recentTimeTick = ref(0);
  /** @type {ReturnType<typeof setInterval> | null} */
  let recentTimeInterval = null;

  function persistRecentConnections() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(
        RECENT_CONTROLLER_KEY,
        JSON.stringify(recentConnectionsRaw.value.slice(0, RECENT_CONTROLLER_MAX))
      );
    } catch {
      /* ignore */
    }
  }

  function recordControllerConnectionSuccess(codeDigits, signalUrl) {
    const code = String(codeDigits || '').replace(/\D/g, '').slice(0, 8);
    if (code.length < 4) return;
    const u = normalizeSignalUrl(String(signalUrl || '').trim()) || String(signalUrl || '').trim();
    const rest = recentConnectionsRaw.value.filter((x) => x.codeDigits !== code);
    rest.unshift({ codeDigits: code, signalUrl: u, connectedAt: Date.now() });
    recentConnectionsRaw.value = rest.slice(0, RECENT_CONTROLLER_MAX);
    persistRecentConnections();
    recentTimeTick.value++;
  }

  const signalWsUrl = ref(getStoredSignalUrlSync());
  /** 主进程给出的局域网建议 URL 与 IPv4（用于被控端展示与复制） */
  const inviteHint = ref(
    /** @type {{ suggestedUrl: string, lanIpv4: string | null }} */ ({
      suggestedUrl: '',
      lanIpv4: null,
    })
  );

  /** 被控端：true=本机信令（自动用局域网建议 ws），false=远程信令（仅手动填写） */
  function readAgentSignalLocal() {
    try {
      if (typeof localStorage === 'undefined') return true;
      return localStorage.getItem(AGENT_SIGNAL_LOCAL_KEY) !== '0';
    } catch {
      return true;
    }
  }
  const agentSignalLocal = ref(readAgentSignalLocal());

  const agentLocalSignalDisplay = computed(() => {
    const u = normalizeSignalUrl(inviteHint.value.suggestedUrl);
    if (u) return u;
    return '（未能自动检测本机地址，请确认已联网或改用「远程」手动填写）';
  });

  watch(signalWsUrl, (v) => {
    if (agentSignalLocal.value) return;
    setStoredSignalUrl(v);
  });

  watch(agentSignalLocal, (local) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(AGENT_SIGNAL_LOCAL_KEY, local ? '1' : '0');
      }
    } catch {
      /* ignore */
    }
    if (local) void refreshInviteHint();
  });

  const signalRef = shallowRef(null);
  const agentRtc = shallowRef(null);
  const controllerRtc = shallowRef(null);

  /** 控制端「加入房间」重试：避免先于被控端连上信令时一次失败就断开 */
  let controllerJoinEpoch = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let controllerJoinRetryTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let controllerDialWatchdogTimer = null;

  function clearControllerDialWatchdog() {
    if (controllerDialWatchdogTimer) {
      clearTimeout(controllerDialWatchdogTimer);
      controllerDialWatchdogTimer = null;
    }
  }

  function bumpControllerJoinEpoch() {
    controllerJoinEpoch += 1;
    if (controllerJoinRetryTimer) {
      clearTimeout(controllerJoinRetryTimer);
      controllerJoinRetryTimer = null;
    }
    clearControllerDialWatchdog();
  }

  const remoteStream = shallowRef(null);
  const remoteVideoRef = ref(null);
  const webrtcPcState = ref('new');
  /** 控制端 DataChannel（humanos-control）已 open，与 UI「可下发键鼠」一致 */
  const remoteControlReady = ref(false);
  /** 被控端 OS：darwin | win32（DataChannel agent_hello） */
  const remotePlatform = ref('');
  /**
   * 部分 Chromium/Electron 下 <video> 获焦后仍收不到 keydown，故用 window 捕获转发；
   * 点击远程画面或焦点落在 video 上时为 true，点到本页输入框/按钮等可聚焦控件时清除。
   */
  const latchRemoteKeyboard = ref(false);
  /** 控制端已点「建立连接」、尚未收到 ROOM_READY（仍在远程控制中心页） */
  const controllerDialInProgress = ref(false);

  const recentControllerDevices = computed(() => {
    void recentTimeTick.value;
    const activeDigits = mode.value === 'session' ? controllerCodeRaw.value.replace(/\D/g, '') : '';
    const live = mode.value === 'session' && webrtcPcState.value === 'connected';
    return recentConnectionsRaw.value.map((r) => ({
      id: r.codeDigits,
      codeDisplay: formatControlCodeDisplay(r.codeDigits),
      name: `远程 ${formatControlCodeDisplay(r.codeDigits)}`,
      time: formatRelativeTimeZh(r.connectedAt),
      status: live && r.codeDigits === activeDigits ? 'online' : 'offline',
      signalUrl: r.signalUrl,
    }));
  });

  function startRecentTimeTicker() {
    if (recentTimeInterval) return;
    recentTimeInterval = setInterval(() => {
      recentTimeTick.value++;
    }, 30000);
  }

  function stopRecentTimeTicker() {
    if (recentTimeInterval) {
      clearInterval(recentTimeInterval);
      recentTimeInterval = null;
    }
  }

  watch(mode, (m) => {
    if (m === 'controller' || m === 'session') startRecentTimeTicker();
    else stopRecentTimeTicker();
    if (m !== 'session') latchRemoteKeyboard.value = false;
  });

  watch(webrtcPcState, (st, prev) => {
    if (mode.value !== 'session' || st !== 'connected') return;
    if (prev === 'connected') return;
    const digits = controllerCodeRaw.value.replace(/\D/g, '');
    recordControllerConnectionSuccess(digits, lastControllerSignalUrl.value);
  });

  const remoteVideoHasTrack = computed(
    () => !!remoteStream.value && remoteStream.value.getVideoTracks().length > 0
  );

  const videoStatsLine = computed(() => {
    const el = remoteVideoRef.value;
    if (remoteVideoHasTrack.value) {
      const st = webrtcPcState.value;
      const w = el?.videoWidth || 0;
      const h = el?.videoHeight || 0;
      if (w > 0 && h > 0) return `${w}x${h} · ${st}`;
      return `画面尺寸就绪中… · ${st}`;
    }
    if (mode.value === 'session') {
      const cr = controllerRtc.value;
      if (!cr?.pc) {
        return signalServerConnected.value
          ? '等待房间就绪：请确认被控端已点「启动服务」且控制码与邀请一致'
          : '正在连接信令服务器…';
      }
      const st = webrtcPcState.value;
      if (st === 'new') {
        return 'WebRTC: 协商中（等待画面/ICE；Windows 被控端请完成「屏幕共享」弹窗）';
      }
      return `WebRTC: ${st}`;
    }
    return `WebRTC: ${webrtcPcState.value}`;
  });

  watch(
    [remoteStream, remoteVideoRef],
    async () => {
      const el = remoteVideoRef.value;
      const s = remoteStream.value;
      if (!el) return;
      el.srcObject = s || null;
      if (s) {
        try {
          await el.play();
        } catch (e) {
          console.warn('[HumanOS] video.play()', e);
        }
      }
    },
    { flush: 'post' }
  );

  function ensureSignal() {
    if (!signalRef.value) signalRef.value = new SignalClient();
    return signalRef.value;
  }

  function disposeAgentRtc() {
    agentRtc.value?.dispose();
    agentRtc.value = null;
    if (mode.value === 'agent') webrtcPcState.value = 'new';
  }

  function disposeControllerRtc() {
    remoteControlReady.value = false;
    remoteStream.value = null;
    controllerRtc.value?.dispose();
    controllerRtc.value = null;
    if (mode.value === 'session') webrtcPcState.value = 'new';
  }

  function disposeAllRtc() {
    disposeAgentRtc();
    disposeControllerRtc();
  }

  async function refreshInviteHint() {
    let port = '8787';
    try {
      if (typeof window !== 'undefined' && window.humanos?.getDefaultSignalUrl) {
        const du = await window.humanos.getDefaultSignalUrl();
        const m = String(du || '').match(/:(\d+)(?:\/|$)/);
        if (m) port = m[1];
      }
    } catch {
      /* ignore */
    }

    const applyFallback = () => {
      inviteHint.value = {
        suggestedUrl: `ws://127.0.0.1:${port}/ws`,
        lanIpv4: '127.0.0.1',
      };
    };

    if (typeof window !== 'undefined' && window.humanos?.getInviteSignalHint) {
      try {
        const h = await window.humanos.getInviteSignalHint();
        const raw = typeof h?.suggestedUrl === 'string' ? h.suggestedUrl.trim() : '';
        const normalized = normalizeSignalUrl(raw);
        if (normalized) {
          inviteHint.value = {
            suggestedUrl: normalized,
            lanIpv4: h?.lanIpv4 ?? null,
          };
          return;
        }
      } catch (e) {
        console.warn('[HumanOS] getInviteSignalHint', e);
      }
    }
    applyFallback();
  }

  async function getAgentConnectSignalUrl() {
    if (agentSignalLocal.value) {
      await refreshInviteHint();
      const u = normalizeSignalUrl(inviteHint.value.suggestedUrl);
      if (u) return u;
      return resolveSignalUrl('');
    }
    return resolveSignalUrl(signalWsUrl.value);
  }

  /** 优先用主进程剪贴板（Electron 可靠），其次 Async Clipboard，最后 execCommand */
  async function writeToClipboard(text) {
    const t = String(text ?? '');
    if (typeof window !== 'undefined' && window.humanos?.writeClipboardText) {
      try {
        const r = await window.humanos.writeClipboardText(t);
        if (r && r.ok !== false) return true;
      } catch (e) {
        console.warn('[HumanOS] writeClipboardText', e);
      }
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(t);
        return true;
      } catch (e) {
        console.warn('[HumanOS] navigator.clipboard.writeText', e);
      }
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      console.warn('[HumanOS] execCommand copy', e);
      return false;
    }
  }

  /** 被控端：复制「信令地址 + 控制码」块，供控制端粘贴解析 */
  async function copyAgentInvite() {
    await refreshInviteHint();
    const url = await getAgentConnectSignalUrl();
    const block = formatInviteBlock(url, controlCodeDisplay.value);
    const ok = await writeToClipboard(block);
    if (ok) addLog('已复制连接信息（信令地址 + 控制码）');
    else addLog(`复制失败，请手动复制以下内容：\n${block}`);
  }

  /** @returns {boolean} 是否解析并写入了至少一项 */
  function applyInviteFromPaste(text) {
    const { signalUrl, codeRaw } = parseInviteClipboard(text);
    if (signalUrl) signalWsUrl.value = signalUrl;
    if (codeRaw) controllerCodeRaw.value = codeRaw;
    if (signalUrl || codeRaw) {
      addLog('已从剪贴板解析信令地址与控制码');
      addLog('请再点击「建立连接」开始入房（仅粘贴不会自动连接）');
      return true;
    }
    return false;
  }

  /** 控制端输入框 paste：多行邀请文本自动回填 */
  function onControllerPaste(e) {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (applyInviteFromPaste(text)) e.preventDefault();
  }

  function attachAgentSignalHandlers(s) {
    s.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === MT.ERROR) addLog(`信令: ${msg.message}`);
      if (msg.type === MT.ROOM_READY) {
        if (!agentRtc.value) {
          const session = new AgentRtcSession({
            signalClient: s,
            onLog: addLog,
            onConnectionState: (st) => {
              webrtcPcState.value = st;
            },
          });
          agentRtc.value = session;
          /** 勿 await：屏幕采集可能较久，会阻塞同一条信令上的 relay（offer/ICE），导致控制端一直卡在协商 */
          void session.start().catch((e) => {
            addLog(`屏幕采集已取消或失败: ${String(/** @type {{ message?: string }} */ (e)?.message || e)}`);
            disposeAgentRtc();
          });
        }
      }
      if (msg.type === MT.RELAY_FORWARD && msg.payload && agentRtc.value) {
        try {
          await agentRtc.value.handleRelayPayload(msg.payload);
        } catch (e) {
          addLog(`WebRTC（被控）处理失败: ${String(e?.message || e)}`);
        }
      }
      if (msg.type === MT.PEER_LEFT) {
        addLog('对端已断开，释放 WebRTC（被控端）');
        disposeAgentRtc();
      }
    });
  }

  async function toggleAgentService() {
    if (isAgentRunning.value) {
      disposeAgentRtc();
      bumpControllerJoinEpoch();
      ensureSignal().disconnect();
      signalServerConnected.value = false;
      isAgentRunning.value = false;
      webrtcPcState.value = 'new';
      controllerDialInProgress.value = false;
      return;
    }

    isAgentRunning.value = true;
    const s = ensureSignal();
    const url = await getAgentConnectSignalUrl();
    bumpControllerJoinEpoch();
    s.disconnect();

    attachAgentSignalHandlers(s);
    s.on('open', () => {
      signalServerConnected.value = true;
      addLog(`信令: 已连接 ${url}（被控端）`);
      s.registerAgent(controlCodeRaw.value.replace(/\D/g, ''), 'desktop-agent');
    });
    s.on('close', () => {
      signalServerConnected.value = false;
    });
    s.on('error', () => {
      signalServerConnected.value = false;
    });

    s.connect(url);
  }

  async function beginControllerConnection(digitsRaw) {
    const digits = String(digitsRaw || '').replace(/\D/g, '');
    if (digits.length < 4) {
      addLog('请输入有效控制码');
      return;
    }

    disposeControllerRtc();
    sessionBannerCode.value = formatControlCodeDisplay(digits);
    controllerDialInProgress.value = true;

    bumpControllerJoinEpoch();
    const joinEpoch = controllerJoinEpoch;

    const s = ensureSignal();
    const url = await resolveSignalUrl(signalWsUrl.value);
    lastControllerSignalUrl.value = url;
    s.disconnect();

    addLog(`信令: 正在打开 WebSocket → ${url}`);
    const probe = typeof window !== 'undefined' ? window.humanos?.probeSignalHealth : null;
    if (typeof probe === 'function') {
      void probe(url).then((r) => {
        if (joinEpoch !== controllerJoinEpoch) return;
        if (r && r.ok) {
          addLog(
            '信令: 本机到该地址的 HTTP /health 探测成功（端口有服务；若下方仍长时间「WebSocket 尚未打开」，多为代理/防火墙仅拦 WS，或信令版本不一致）。',
          );
          return;
        }
        const detail = r?.error ? String(r.error) : r?.statusCode != null ? `HTTP ${r.statusCode}` : 'unknown';
        addLog(
          `信令: 本机无法访问该地址的 HTTP 端口（/health 失败: ${detail}）。请在「信令地址里的主机」上运行仓库根目录的 npm run dev:signal；控制端在别的电脑时，勿填 127.0.0.1，并检查防火墙放行对应 TCP 端口。`,
        );
      });
    }

    const maxJoinAttempts = 15;
    const joinRetryDelayMs = 500;
    let controllerRoomReady = false;
    let joinAttempt = 0;

    const scheduleJoinRetry = () => {
      if (joinEpoch !== controllerJoinEpoch || controllerRoomReady) return;
      if (controllerJoinRetryTimer) {
        clearTimeout(controllerJoinRetryTimer);
        controllerJoinRetryTimer = null;
      }
      controllerJoinRetryTimer = setTimeout(() => {
        controllerJoinRetryTimer = null;
        if (joinEpoch !== controllerJoinEpoch || controllerRoomReady) return;
        tryJoinControllerRoom();
      }, joinRetryDelayMs);
    };

    function tryJoinControllerRoom() {
      if (joinEpoch !== controllerJoinEpoch || controllerRoomReady || !s.connected) return;
      joinAttempt += 1;
      if (joinAttempt > maxJoinAttempts) {
        addLog(
          '信令: 多次重试仍未加入房间。请确认：①被控端已点「启动受控服务」且信令连上；②控制码与邀请信息一致；③两台机器访问同一信令地址（运行 npm run dev:signal 的那台机器与端口）。'
        );
        disconnectSessionToController();
        return;
      }
      if (joinAttempt > 1) {
        addLog(`信令: 再次尝试加入房间 (${joinAttempt}/${maxJoinAttempts})…`);
      }
      s.joinController(digits);
    }

    controllerRtc.value = new ControllerRtcSession({
      signalClient: s,
      onLog: addLog,
      onConnectionState: (st) => {
        webrtcPcState.value = st;
        if (['failed', 'disconnected', 'closed'].includes(String(st))) {
          remoteControlReady.value = false;
        }
      },
      onRemoteStream: (stream) => {
        remoteStream.value = stream;
      },
      onControlChannelOpen: () => {
        remoteControlReady.value = true;
        queueMicrotask(() => {
          try {
            controllerRtc.value?.requestRemotePlatform?.();
          } catch {
            /* ignore */
          }
          queueMicrotask(() => {
            try {
              remoteVideoRef.value?.focus?.();
              latchRemoteKeyboard.value = true;
            } catch {
              /* ignore */
            }
          });
        });
      },
      onControlChannelClose: () => {
        remoteControlReady.value = false;
        remotePlatform.value = '';
      },
      onAgentHello: (platform) => {
        remotePlatform.value = String(platform || '');
        addLog(`被控端系统: ${remotePlatform.value || 'unknown'}`);
      },
    });

    s.on('message', async (raw) => {
      if (joinEpoch !== controllerJoinEpoch) return;
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === MT.ERROR) {
        addLog(`信令: ${msg.message}`);
        const errText = String(msg.message || '');
        if (!controllerRoomReady && errText.includes('no agent')) {
          scheduleJoinRetry();
          return;
        }
        if (!controllerRoomReady && errText.includes('already registered')) {
          addLog('信令: 加入房间状态异常，已断开。请再次点击「建立连接」。');
          disconnectSessionToController();
          return;
        }
        if (errText.includes('room full') || errText.includes('invalid control code')) {
          disconnectSessionToController();
        }
      }
      if (msg.type === MT.ROOM_READY) {
        controllerRoomReady = true;
        if (controllerJoinRetryTimer) {
          clearTimeout(controllerJoinRetryTimer);
          controllerJoinRetryTimer = null;
        }
        clearControllerDialWatchdog();
        controllerDialInProgress.value = false;
        mode.value = 'session';
        addLog('信令: 房间已就绪（ROOM_READY）');
        controllerRtc.value?.ensurePeerConnection();
      }
      if (msg.type === MT.RELAY_FORWARD) {
        const kind = msg.payload && typeof msg.payload === 'object' ? msg.payload.kind : '';
        if (kind) addLog(`信令 relay → 控制端: ${kind}`);
        if (msg.payload && controllerRtc.value) {
          try {
            await controllerRtc.value.handleRelayPayload(msg.payload);
          } catch (e) {
            addLog(`WebRTC（控制）处理失败: ${String(e?.message || e)}`);
          }
        } else if (!msg.payload) {
          addLog('信令 relay: 收到空 payload，请检查信令版本是否一致');
        }
      }
      if (msg.type === MT.PEER_LEFT) {
        addLog('对端已断开（控制端）');
        disconnectSessionToController();
      }
    });

    s.on('open', () => {
      if (joinEpoch !== controllerJoinEpoch) return;
      signalServerConnected.value = true;
      addLog(`信令: 已连接 ${url}`);
      tryJoinControllerRoom();
    });
    s.on('close', () => {
      signalServerConnected.value = false;
      if (joinEpoch === controllerJoinEpoch && mode.value !== 'session') {
        controllerDialInProgress.value = false;
        clearControllerDialWatchdog();
        addLog('信令: WebSocket 已关闭（若未进入会话，请检查地址与信令服务是否在运行）');
      }
    });
    s.on('error', () => {
      signalServerConnected.value = false;
      if (joinEpoch === controllerJoinEpoch && mode.value !== 'session') {
        controllerDialInProgress.value = false;
        clearControllerDialWatchdog();
        addLog(
          `信令: WebSocket 出错（无法连到 ${url} ？请在本机或对端运行 npm run dev:signal，并确认防火墙放行端口）。`,
        );
      }
    });

    clearControllerDialWatchdog();
    controllerDialWatchdogTimer = setTimeout(() => {
      controllerDialWatchdogTimer = null;
      if (joinEpoch !== controllerJoinEpoch) return;
      if (!controllerDialInProgress.value) return;
      if (mode.value === 'session') return;
      addLog(
        '信令: 等待房间就绪超时（约 40s）。常见原因：①控制端信令地址填错或连的不是被控端同一台信令进程；②被控端未启动服务或控制码不一致；③被控端卡在屏幕采集导致未发 offer（请看被控端实时日志）。',
      );
      disconnectSessionToController();
    }, 40000);

    s.connect(url);
  }

  async function connectController() {
    await beginControllerConnection(controllerCodeRaw.value);
  }

  async function enterSessionFromRecent(deviceId) {
    const digits = String(deviceId || '').replace(/\D/g, '').slice(0, 8);
    if (digits.length < 4) return;
    const hit = recentConnectionsRaw.value.find((r) => r.codeDigits === digits);
    const su = hit?.signalUrl?.trim();
    if (su) {
      signalWsUrl.value = su;
      if (!agentSignalLocal.value) setStoredSignalUrl(su);
    }
    controllerCodeRaw.value = digits;
    await beginControllerConnection(digits);
  }

  function disconnectSessionToController() {
    disposeControllerRtc();
    bumpControllerJoinEpoch();
    ensureSignal().disconnect();
    signalServerConnected.value = false;
    webrtcPcState.value = 'new';
    controllerDialInProgress.value = false;
    mode.value = 'controller';
  }

  function disconnectSession() {
    disposeAllRtc();
    bumpControllerJoinEpoch();
    ensureSignal().disconnect();
    signalServerConnected.value = false;
    webrtcPcState.value = 'new';
    controllerDialInProgress.value = false;
    mode.value = 'controller';
  }

  function goSelect() {
    disposeAllRtc();
    bumpControllerJoinEpoch();
    ensureSignal().disconnect();
    isAgentRunning.value = false;
    signalServerConnected.value = false;
    webrtcPcState.value = 'new';
    controllerDialInProgress.value = false;
    mode.value = 'select';
  }

  function goAgent() {
    disposeControllerRtc();
    bumpControllerJoinEpoch();
    ensureSignal().disconnect();
    controllerDialInProgress.value = false;
    mode.value = 'agent';
    void refreshInviteHint();
  }

  function goController() {
    disposeAgentRtc();
    bumpControllerJoinEpoch();
    ensureSignal().disconnect();
    isAgentRunning.value = false;
    controllerDialInProgress.value = false;
    mode.value = 'controller';
    void refreshInviteHint();
  }

  function onControllerInput(e) {
    controllerCodeRaw.value = e.target.value.replace(/\D/g, '').slice(0, 8);
  }

  async function copyCode() {
    const raw = controlCodeRaw.value.replace(/\D/g, '');
    const ok = await writeToClipboard(raw);
    if (ok) addLog('控制码已复制到剪贴板');
    else addLog(`复制失败，控制码：${raw}`);
  }

  /**
   * 将鼠标事件映射到远端视频像素坐标（与 CSS object-cover 一致：铺满容器、居中裁切）。
   * @param {MouseEvent} e
   * @param {HTMLVideoElement} el
   */
  function mapVideoCoords(e, el) {
    const r = el.getBoundingClientRect();
    const vw = el.videoWidth;
    const vh = el.videoHeight;
    const rw = r.width;
    const rh = r.height;
    if (!(vw > 0) || !(vh > 0) || !(rw > 0) || !(rh > 0)) {
      const fw = vw > 0 ? vw : rw;
      const fh = vh > 0 ? vh : rh;
      const x = ((e.clientX - r.left) / Math.max(1, rw)) * fw;
      const y = ((e.clientY - r.top) / Math.max(1, rh)) * fh;
      return { x: Math.round(x), y: Math.round(y) };
    }
    const scale = Math.max(rw / vw, rh / vh);
    const sw = vw * scale;
    const sh = vh * scale;
    const cropX = (sw - rw) / 2;
    const cropY = (sh - rh) / 2;
    const relX = e.clientX - r.left;
    const relY = e.clientY - r.top;
    let x = (cropX + relX) / scale;
    let y = (cropY + relY) / scale;
    x = Math.max(0, Math.min(vw - 1, x));
    y = Math.max(0, Math.min(vh - 1, y));
    return { x: Math.round(x), y: Math.round(y) };
  }

  /** 附带视频帧尺寸，供被控端主进程将「视频像素」映射为全局逻辑坐标（Retina 等） */
  function attachVideoFrameSize(cmd, el) {
    const fw = el.videoWidth;
    const fh = el.videoHeight;
    if (fw > 0 && fh > 0) {
      return { ...cmd, frameW: fw, frameH: fh };
    }
    return cmd;
  }

  function canForwardRemoteKeyboard() {
    if (mode.value !== 'session') return false;
    const rtc = controllerRtc.value;
    if (!rtc?.controlReady) return false;
    const v = remoteVideoRef.value;
    if (!v) return false;
    if (latchRemoteKeyboard.value) return true;
    const ae = document.activeElement;
    return ae === v || !!(ae && v.contains(ae));
  }

  /** @param {FocusEvent} e */
  function onDocumentFocusInRemoteKb(e) {
    const v = remoteVideoRef.value;
    if (!v) return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t === v || v.contains(t)) {
      latchRemoteKeyboard.value = true;
      return;
    }
    if (t.closest('input,textarea,select,button,a[href],[contenteditable="true"]')) {
      latchRemoteKeyboard.value = false;
    }
  }

  /**
   * @param {KeyboardEvent} e
   */
  function emitRemoteKeyDown(e) {
    const rtc = controllerRtc.value;
    if (!rtc?.controlReady) return;
    if (e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    rtc.sendControl({
      type: 'key',
      phase: 'down',
      key: e.key,
      code: e.code,
      repeat: !!e.repeat,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
  }

  /**
   * @param {KeyboardEvent} e
   */
  function emitRemoteKeyUp(e) {
    const rtc = controllerRtc.value;
    if (!rtc?.controlReady) return;
    if (e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    rtc.sendControl({
      type: 'key',
      phase: 'up',
      key: e.key,
      code: e.code,
      repeat: !!e.repeat,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
  }

  /**
   * @param {KeyboardEvent} e
   */
  function onWindowRemoteKeyDown(e) {
    if (!canForwardRemoteKeyboard()) return;
    emitRemoteKeyDown(e);
  }

  /**
   * @param {KeyboardEvent} e
   */
  function onWindowRemoteKeyUp(e) {
    if (!canForwardRemoteKeyboard()) return;
    emitRemoteKeyUp(e);
  }

  let lastMoveTs = 0;
  function onRemotePointerMove(e) {
    const el = remoteVideoRef.value;
    if (!el || !controllerRtc.value?.controlReady) return;
    const now = Date.now();
    if (now - lastMoveTs < 30) return;
    lastMoveTs = now;
    const { x, y } = mapVideoCoords(e, el);
    controllerRtc.value.sendControl(attachVideoFrameSize({ type: 'move', x, y }, el));
  }

  function onRemotePointerDown(e) {
    if (e.button !== 0 && e.button !== 2) return;
    const el = remoteVideoRef.value;
    if (!el) return;
    latchRemoteKeyboard.value = true;
    if (e.button === 2) {
      e.preventDefault();
    }
    try {
      el.focus?.();
    } catch {
      /* ignore */
    }
    if (!controllerRtc.value?.controlReady) return;
    const { x, y } = mapVideoCoords(e, el);
    const button = e.button === 2 ? 'right' : 'left';
    controllerRtc.value.sendControl(attachVideoFrameSize({ type: 'click', x, y, button }, el));
  }

  function onRemotePointerUp() {
    /* 预留拖拽释放 */
  }

  function onRemoteWheel(e) {
    const el = remoteVideoRef.value;
    if (!el || !controllerRtc.value?.controlReady) return;
    const { x, y } = mapVideoCoords(e, el);
    controllerRtc.value.sendControl(
      attachVideoFrameSize(
        {
          type: 'wheel',
          x,
          y,
          deltaY: e.deltaY,
          deltaX: e.deltaX,
        },
        el,
      ),
    );
  }

  /**
   * IME 上屏整段文本（避免 composition 期间重复发键）。
   * @param {CompositionEvent} e
   */
  function onRemoteCompositionEnd(e) {
    const rtc = controllerRtc.value;
    if (!rtc?.controlReady) return;
    if (!canForwardRemoteKeyboard()) return;
    const text = typeof e.data === 'string' ? e.data : '';
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    rtc.sendControl({ type: 'text', text });
  }

  /** 控制端：请求 Windows/被控端弹出共享选择并替换为真实屏幕（解决误选 OBS 等 0×0） */
  function requestRemoteSwitchCapture() {
    const rtc = controllerRtc.value;
    if (!rtc?.requestRemoteRecapture?.()) {
      addLog('切换画面: 控制通道未就绪，请等连接稳定后再试');
    }
  }

  /**
   * @param {Record<string, unknown>} cmd
   * @returns {boolean}
   */
  function sendRemoteControl(cmd) {
    const rtc = controllerRtc.value;
    if (!rtc?.controlReady) return false;
    const el = remoteVideoRef.value;
    let payload = cmd;
    if (
      el &&
      (cmd.type === 'move' || cmd.type === 'click' || cmd.type === 'wheel') &&
      typeof cmd.x === 'number' &&
      typeof cmd.y === 'number'
    ) {
      payload = attachVideoFrameSize(cmd, el);
    }
    rtc.sendControl(payload);
    return true;
  }

  function isRemoteControlReady() {
    return remoteControlReady.value;
  }

  /**
   * 经 DataChannel 读取被控端系统剪贴板文本（用于复制类任务验收）。
   * @returns {Promise<{ ok: boolean, text: string, error?: string }>}
   */
  function getRemotePlatform() {
    const rtc = controllerRtc.value;
    return String(rtc?.remotePlatform || remotePlatform.value || '');
  }

  function requestRemotePlatform() {
    const rtc = controllerRtc.value;
    return !!rtc?.requestRemotePlatform?.();
  }

  /**
   * @param {{ command: string, timeoutMs?: number }} p
   */
  async function runRemoteShellExec(p) {
    const rtc = controllerRtc.value;
    if (!rtc?.controlReady) return { ok: false, exitCode: -1, stdout: '', stderr: '', error: 'control-not-ready' };
    try {
      return await rtc.requestRemoteShellExec(
        { command: String(p?.command || ''), timeoutMs: p?.timeoutMs },
        Math.max(5000, Number(p?.timeoutMs) || 20000) + 2000,
      );
    } catch (e) {
      return { ok: false, exitCode: -1, stdout: '', stderr: '', error: String(/** @type {{ message?: string }} */ (e)?.message || e) };
    }
  }

  async function readRemoteClipboardText() {
    const rtc = controllerRtc.value;
    if (!rtc?.controlReady) return { ok: false, text: '', error: 'control-not-ready' };
    try {
      return await rtc.requestRemoteClipboardText(3500);
    } catch (e) {
      return { ok: false, text: '', error: String(/** @type {{ message?: string }} */ (e)?.message || e) };
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onWindowRemoteKeyDown, true);
    window.addEventListener('keyup', onWindowRemoteKeyUp, true);
    document.addEventListener('focusin', onDocumentFocusInRemoteKb, true);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onWindowRemoteKeyDown, true);
    window.removeEventListener('keyup', onWindowRemoteKeyUp, true);
    document.removeEventListener('focusin', onDocumentFocusInRemoteKb, true);
    stopRecentTimeTicker();
    disposeAllRtc();
    bumpControllerJoinEpoch();
    controllerDialInProgress.value = false;
    clearControllerDialWatchdog();
    signalRef.value?.disconnect();
  });

  return {
    mode,
    controlCodeRaw,
    controlCodeDisplay,
    isAgentRunning,
    controllerCodeRaw,
    controllerCodeDisplay,
    signalServerConnected,
    sessionBannerCode,
    webrtcPcState,
    controllerDialInProgress,
    remoteVideoRef,
    remoteStream,
    remoteVideoHasTrack,
    remoteControlReady,
    videoStatsLine,
    toggleAgentService,
    connectController,
    enterSessionFromRecent,
    disconnectSession,
    goSelect,
    goAgent,
    goController,
    signalWsUrl,
    inviteHint,
    agentSignalLocal,
    agentLocalSignalDisplay,
    refreshInviteHint,
    copyAgentInvite,
    applyInviteFromPaste,
    onControllerPaste,
    onControllerInput,
    copyCode,
    onRemotePointerDown,
    onRemotePointerMove,
    onRemotePointerUp,
    onRemoteWheel,
    onRemoteCompositionEnd,
    requestRemoteSwitchCapture,
    sendRemoteControl,
    readRemoteClipboardText,
    runRemoteShellExec,
    getRemotePlatform,
    requestRemotePlatform,
    isRemoteControlReady,
    recentControllerDevices,
  };
}
