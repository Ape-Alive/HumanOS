import { getRtcConfiguration } from './rtcConfig.js';
import { stringifyControl } from './controlChannel.js';
import { parseClipboardResult, stringifyClipboardGet } from './remoteClipboardChannel.js';
import {
  parseAgentHello,
  parseShellResult,
  stringifyPlatformRequest,
  stringifyShellExec,
} from './remoteShellChannel.js';

/**
 * 控制端：接收视频 + DataChannel 发送控制
 */
export class ControllerRtcSession {
  /**
   * @param {{
   *   signalClient: import('../signal/SignalClient.js').SignalClient,
   *   onLog?: (s: string) => void,
   *   onConnectionState?: (s: RTCPeerConnectionState) => void,
   *   onRemoteStream?: (s: MediaStream) => void,
   *   onControlChannelOpen?: () => void,
   *   onControlChannelClose?: () => void,
   *   onAgentHello?: (platform: string) => void,
   * }} opts
   */
  constructor(opts) {
    this.signal = opts.signalClient;
    this.onLog = opts.onLog;
    this.onConnectionState = opts.onConnectionState;
    this.onRemoteStream = opts.onRemoteStream;
    this.onControlChannelOpen = opts.onControlChannelOpen;
    this.onControlChannelClose = opts.onControlChannelClose;
    this.onAgentHello = opts.onAgentHello;
    /** @type {string} */
    this.remotePlatform = '';
    /** @type {RTCPeerConnection | null} */
    this.pc = null;
    /** @type {RTCDataChannel | null} */
    this.dc = null;
    /** @type {RTCIceCandidateInit[]} */
    this._pendingRemoteIce = [];
    /** @type {Map<string, { resolve: (r: { ok: boolean, text: string, error?: string }) => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
    this._clipboardPending = new Map();
    /** @type {Map<string, { resolve: (r: { ok: boolean, exitCode: number, stdout: string, stderr: string, error?: string }) => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
    this._shellPending = new Map();
  }

  log(m) {
    this.onLog?.(m);
  }

  /** 控制端作为 answerer：远端 ICE 需在 remote+local 描述都就绪后再 add，否则易丢候选 */
  _canApplyRemoteIce() {
    if (!this.pc) return false;
    return !!(this.pc.currentRemoteDescription && this.pc.currentLocalDescription);
  }

  get controlReady() {
    return this.dc != null && this.dc.readyState === 'open';
  }

  ensurePeerConnection() {
    if (this.pc) return;
    this.pc = new RTCPeerConnection(getRtcConfiguration());
    this.pc.onconnectionstatechange = () => {
      const s = this.pc?.connectionState;
      if (s) this.onConnectionState?.(s);
    };
    this.pc.oniceconnectionstatechange = () => {
      const ice = this.pc?.iceConnectionState;
      if (ice) this.log(`WebRTC ICE: ${ice}`);
      if (ice === 'failed') {
        this.log('WebRTC ICE: failed（NAT/防火墙/网络问题，需重新连接）');
      }
    };
    this.pc.onicecandidateerror = (ev) => {
      const code = /** @type {{ errorCode?: number }} */ (ev).errorCode;
      const text = /** @type {{ errorText?: string }} */ (ev).errorText;
      const url = /** @type {{ url?: string }} */ (ev).url;
      this.log(`ICE 收集异常: code=${code ?? '?'} ${text || ''} ${url ? `stun=${url}` : ''}`);
    };
    this.pc.onsignalingstatechange = () => {
      this.log(`WebRTC signaling: ${this.pc?.signalingState}`);
    };
    this.pc.ontrack = (e) => {
      let stream = e.streams && e.streams[0];
      if (!stream && e.track) {
        stream = new MediaStream([e.track]);
      }
      if (stream) {
        this.log('WebRTC: 收到远端视频轨');
        this.onRemoteStream?.(stream);
      }
    };
    this.pc.ondatachannel = (e) => {
      this.dc = e.channel;
      this.dc.onopen = () => {
        this.log('DataChannel: 控制通道已建立（控制端）');
        try {
          this.onControlChannelOpen?.();
        } catch (err) {
          console.warn('[ControllerRtc] onControlChannelOpen', err);
        }
      };
      this.dc.onclose = () => {
        this.log('DataChannel: 控制通道已关闭');
        this._rejectAllClipboardPending('channel-closed');
        this._rejectAllShellPending('channel-closed');
        try {
          this.onControlChannelClose?.();
        } catch (err) {
          console.warn('[ControllerRtc] onControlChannelClose', err);
        }
      };
      this.dc.onmessage = (ev) => {
        const raw = String(ev.data);
        const hello = parseAgentHello(raw);
        if (hello) {
          this.remotePlatform = String(hello.platform || '');
          this.log(`被控端系统: ${this.remotePlatform || 'unknown'}`);
          try {
            this.onAgentHello?.(this.remotePlatform);
          } catch (e) {
            console.warn('[ControllerRtc] onAgentHello', e);
          }
          return;
        }
        const shellMsg = parseShellResult(raw);
        if (shellMsg) {
          const pending = this._shellPending.get(shellMsg.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this._shellPending.delete(shellMsg.id);
          pending.resolve({
            ok: !!shellMsg.ok,
            exitCode: typeof shellMsg.exitCode === 'number' ? shellMsg.exitCode : shellMsg.ok ? 0 : -1,
            stdout: typeof shellMsg.stdout === 'string' ? shellMsg.stdout : '',
            stderr: typeof shellMsg.stderr === 'string' ? shellMsg.stderr : '',
            error: typeof shellMsg.error === 'string' ? shellMsg.error : undefined,
          });
          return;
        }
        const msg = parseClipboardResult(raw);
        if (!msg) return;
        const pending = this._clipboardPending.get(msg.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this._clipboardPending.delete(msg.id);
        pending.resolve({
          ok: !!msg.ok,
          text: typeof msg.text === 'string' ? msg.text : '',
          error: typeof msg.error === 'string' ? msg.error : undefined,
        });
      };
    };
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.signal.relay({ kind: 'ice', candidate: ev.candidate.toJSON() });
      }
    };
    this.log('WebRTC: PeerConnection 已创建（控制端）');
  }

  /**
   * @param {unknown} payload
   */
  async handleRelayPayload(payload) {
    if (!payload || typeof payload !== 'object') return;
    const p = /** @type {{ kind?: string, type?: string, sdp?: string, candidate?: RTCIceCandidateInit }} */ (payload);

    if (p.kind === 'offer' && p.sdp && p.type) {
      this.ensurePeerConnection();
      if (!this.pc) return;
      try {
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: p.type, sdp: p.sdp }));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this._flushPendingIce();
        this.signal.relay({
          kind: 'answer',
          type: this.pc.localDescription.type,
          sdp: this.pc.localDescription.sdp,
        });
        this.log('WebRTC: 已发送 answer');
      } catch (e) {
        this.log(`WebRTC: offer/answer 处理失败 — ${String(e?.message || e)}`);
        throw e;
      }
    }

    if (p.kind === 'ice' && p.candidate) {
      if (!this.pc) {
        this._pendingRemoteIce.push(p.candidate);
        return;
      }
      if (!this._canApplyRemoteIce()) {
        this._pendingRemoteIce.push(p.candidate);
        return;
      }
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(p.candidate));
      } catch (e) {
        console.warn('[ControllerRtc] addIceCandidate', e);
      }
    }
  }

  async _flushPendingIce() {
    if (!this.pc) return;
    for (const c of this._pendingRemoteIce) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        console.warn('[ControllerRtc] flush ice', e);
      }
    }
    this._pendingRemoteIce = [];
  }

  /**
   * @param {Record<string, unknown>} cmd
   */
  sendControl(cmd) {
    if (!this.controlReady || !this.dc) return;
    this.dc.send(stringifyControl(cmd));
  }

  _rejectAllClipboardPending(reason) {
    for (const [, p] of this._clipboardPending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this._clipboardPending.clear();
  }

  _rejectAllShellPending(reason) {
    for (const [, p] of this._shellPending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this._shellPending.clear();
  }

  /**
   * @param {{ command: string, timeoutMs?: number }} p
   * @returns {Promise<{ ok: boolean, exitCode: number, stdout: string, stderr: string, error?: string }>}
   */
  requestRemoteShellExec(p, timeoutMs = 20000) {
    if (!this.controlReady || !this.dc) {
      return Promise.resolve({ ok: false, exitCode: -1, stdout: '', stderr: '', error: 'control-not-ready' });
    }
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sh-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const command = String(p.command || '');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this._shellPending.has(id)) return;
        this._shellPending.delete(id);
        reject(new Error('shell-exec-timeout'));
      }, Math.max(1000, timeoutMs));
      this._shellPending.set(id, { resolve, reject, timer });
      try {
        this.dc.send(stringifyShellExec({ type: 'shell_exec', id, command, timeoutMs }));
      } catch (e) {
        clearTimeout(timer);
        this._shellPending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /**
   * 请求被控端读取系统剪贴板文本。
   * @param {number} [timeoutMs]
   * @returns {Promise<{ ok: boolean, text: string, error?: string }>}
   */
  requestRemoteClipboardText(timeoutMs = 3500) {
    if (!this.controlReady || !this.dc) {
      return Promise.resolve({ ok: false, text: '', error: 'control-not-ready' });
    }
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `cb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this._clipboardPending.has(id)) return;
        this._clipboardPending.delete(id);
        reject(new Error('clipboard-read-timeout'));
      }, Math.max(500, timeoutMs));
      this._clipboardPending.set(id, { resolve, reject, timer });
      try {
        this.dc.send(stringifyClipboardGet(id));
      } catch (e) {
        clearTimeout(timer);
        this._clipboardPending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** 请求被控端重发 agent_hello（控制端晚于 DC open 订阅时补平台信息） */
  requestRemotePlatform() {
    if (!this.controlReady || !this.dc) return false;
    try {
      this.dc.send(stringifyPlatformRequest());
      return true;
    } catch (e) {
      console.warn('[ControllerRtc] platform_request', e);
      return false;
    }
  }

  /** 请求被控端弹出系统共享选择框并替换视频轨（解决误选 OBS 虚拟相机等） */
  requestRemoteRecapture() {
    if (!this.controlReady || !this.dc) {
      this.log('切换画面: 控制通道未就绪，请等待 DataChannel 打开后再试');
      return false;
    }
    this.dc.send(stringifyControl({ type: 'recapture' }));
    this.log('已请求被控端重新选择共享画面（请在对话框中选「整个屏幕」或真实显示器）');
    return true;
  }

  dispose() {
    try {
      if (this.dc) {
        this.dc.onclose = null;
        this.dc.onopen = null;
        this.dc.onerror = null;
        this.dc.close();
      }
    } catch {
      /* ignore */
    }
    this._rejectAllClipboardPending('disposed');
    this._rejectAllShellPending('disposed');
    this.dc = null;
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.pc = null;
    this._pendingRemoteIce = [];
  }
}
