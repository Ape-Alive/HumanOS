import { ref, computed, shallowRef, watch, onBeforeUnmount } from 'vue';
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

  /** 信令 WebSocket 完整地址（与 localStorage 同步） */
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

  function bumpControllerJoinEpoch() {
    controllerJoinEpoch += 1;
    if (controllerJoinRetryTimer) {
      clearTimeout(controllerJoinRetryTimer);
      controllerJoinRetryTimer = null;
    }
  }

  const remoteStream = shallowRef(null);
  const remoteVideoRef = ref(null);
  const webrtcPcState = ref('new');
  /** 控制端已点「建立连接」、尚未收到 ROOM_READY（仍在远程控制中心页） */
  const controllerDialInProgress = ref(false);

  const remoteVideoHasTrack = computed(
    () => !!remoteStream.value && remoteStream.value.getVideoTracks().length > 0
  );

  const videoStatsLine = computed(() => {
    const el = remoteVideoRef.value;
    if (remoteVideoHasTrack.value) {
      const st = webrtcPcState.value;
      const w = el?.videoWidth || 0;
      const h = el?.videoHeight || 0;
      return `${w}x${h} · ${st}`;
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
          try {
            await session.start();
          } catch (e) {
            addLog(`屏幕采集已取消或失败: ${String(e?.message || e)}`);
            disposeAgentRtc();
          }
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
    s.disconnect();

    const maxJoinAttempts = 15;
    const joinRetryDelayMs = 500;
    let controllerRoomReady = false;
    let joinAttempt = 0;

    const scheduleJoinRetry = () => {
      if (joinEpoch !== controllerJoinEpoch || controllerRoomReady || !s.connected) return;
      if (controllerJoinRetryTimer) {
        clearTimeout(controllerJoinRetryTimer);
        controllerJoinRetryTimer = null;
      }
      controllerJoinRetryTimer = setTimeout(() => {
        controllerJoinRetryTimer = null;
        if (joinEpoch !== controllerJoinEpoch || controllerRoomReady || !s.connected) return;
        tryJoinControllerRoom();
      }, joinRetryDelayMs);
    };

    function tryJoinControllerRoom() {
      if (joinEpoch !== controllerJoinEpoch || controllerRoomReady || !s.connected) return;
      joinAttempt += 1;
      if (joinAttempt > maxJoinAttempts) {
        addLog(
          '信令: 多次重试仍未加入房间。请确认：①被控端已点「开始被控」且信令连上；②控制码与邀请信息一致；③两台机器访问同一信令地址（同一台机器上的信令进程）。'
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
      },
      onRemoteStream: (stream) => {
        remoteStream.value = stream;
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
      }
    });
    s.on('error', () => {
      signalServerConnected.value = false;
      if (joinEpoch === controllerJoinEpoch && mode.value !== 'session') {
        controllerDialInProgress.value = false;
      }
    });

    s.connect(url);
  }

  async function connectController() {
    await beginControllerConnection(controllerCodeRaw.value);
  }

  async function enterSessionFromRecent(deviceId) {
    controllerCodeRaw.value = deviceId;
    await beginControllerConnection(deviceId);
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

  function mapVideoCoords(e, el) {
    const r = el.getBoundingClientRect();
    const vw = el.videoWidth || r.width;
    const vh = el.videoHeight || r.height;
    const x = ((e.clientX - r.left) / r.width) * vw;
    const y = ((e.clientY - r.top) / r.height) * vh;
    return { x: Math.round(x), y: Math.round(y) };
  }

  let lastMoveTs = 0;
  function onRemotePointerMove(e) {
    const el = remoteVideoRef.value;
    if (!el || !controllerRtc.value?.controlReady) return;
    const now = Date.now();
    if (now - lastMoveTs < 30) return;
    lastMoveTs = now;
    const { x, y } = mapVideoCoords(e, el);
    controllerRtc.value.sendControl({ type: 'move', x, y });
  }

  function onRemotePointerDown(e) {
    if (e.button !== 0) return;
    const el = remoteVideoRef.value;
    if (!el || !controllerRtc.value?.controlReady) return;
    const { x, y } = mapVideoCoords(e, el);
    controllerRtc.value.sendControl({ type: 'click', x, y, button: 'left' });
  }

  function onRemotePointerUp() {
    /* 预留拖拽释放 */
  }

  function onRemoteWheel(e) {
    const el = remoteVideoRef.value;
    if (!el || !controllerRtc.value?.controlReady) return;
    const { x, y } = mapVideoCoords(e, el);
    controllerRtc.value.sendControl({
      type: 'wheel',
      x,
      y,
      deltaY: e.deltaY,
      deltaX: e.deltaX,
    });
  }

  onBeforeUnmount(() => {
    disposeAllRtc();
    bumpControllerJoinEpoch();
    controllerDialInProgress.value = false;
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
  };
}
