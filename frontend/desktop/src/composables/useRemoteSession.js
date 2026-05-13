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

  const remoteStream = shallowRef(null);
  const remoteVideoRef = ref(null);
  const webrtcPcState = ref('new');

  const remoteVideoHasTrack = computed(
    () => !!remoteStream.value && remoteStream.value.getVideoTracks().length > 0
  );

  const videoStatsLine = computed(() => {
    const el = remoteVideoRef.value;
    const st = webrtcPcState.value;
    if (!remoteVideoHasTrack.value) return `WebRTC: ${st}`;
    const w = el?.videoWidth || 0;
    const h = el?.videoHeight || 0;
    return `${w}x${h} · ${st}`;
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
      ensureSignal().disconnect();
      signalServerConnected.value = false;
      isAgentRunning.value = false;
      webrtcPcState.value = 'new';
      return;
    }

    isAgentRunning.value = true;
    const s = ensureSignal();
    const url = await getAgentConnectSignalUrl();
    s.disconnect();

    attachAgentSignalHandlers(s);
    s.on('open', () => {
      signalServerConnected.value = true;
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

    const s = ensureSignal();
    const url = await resolveSignalUrl(signalWsUrl.value);
    s.disconnect();

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
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === MT.ERROR) {
        addLog(`信令: ${msg.message}`);
        if (String(msg.message || '').includes('no agent')) {
          disconnectSessionToController();
        }
      }
      if (msg.type === MT.ROOM_READY) {
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
      signalServerConnected.value = true;
      addLog(`信令: 已连接 ${url}`);
      s.joinController(digits);
    });
    s.on('close', () => {
      signalServerConnected.value = false;
    });
    s.on('error', () => {
      signalServerConnected.value = false;
    });

    s.connect(url);

    mode.value = 'session';
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
    ensureSignal().disconnect();
    signalServerConnected.value = false;
    webrtcPcState.value = 'new';
    mode.value = 'controller';
  }

  function disconnectSession() {
    disposeAllRtc();
    ensureSignal().disconnect();
    signalServerConnected.value = false;
    webrtcPcState.value = 'new';
    mode.value = 'controller';
  }

  function goSelect() {
    disposeAllRtc();
    ensureSignal().disconnect();
    isAgentRunning.value = false;
    signalServerConnected.value = false;
    webrtcPcState.value = 'new';
    mode.value = 'select';
  }

  function goAgent() {
    disposeControllerRtc();
    ensureSignal().disconnect();
    mode.value = 'agent';
    void refreshInviteHint();
  }

  function goController() {
    disposeAgentRtc();
    ensureSignal().disconnect();
    isAgentRunning.value = false;
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
