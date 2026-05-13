import { getRtcConfiguration } from './rtcConfig.js';
import { parseControlMessage } from './controlChannel.js';

/**
 * 被控端：屏幕采集 + offer + DataChannel（接收控制指令 → preload IPC）
 */
export class AgentRtcSession {
  /**
   * @param {{
   *   signalClient: import('../signal/SignalClient.js').SignalClient,
   *   onLog?: (s: string) => void,
   *   onConnectionState?: (s: RTCPeerConnectionState) => void,
   * }} opts
   */
  constructor(opts) {
    this.signal = opts.signalClient;
    this.onLog = opts.onLog;
    this.onConnectionState = opts.onConnectionState;
    /** @type {RTCPeerConnection | null} */
    this.pc = null;
    /** @type {RTCDataChannel | null} */
    this.dc = null;
    /** @type {MediaStream | null} */
    this.stream = null;
    /** @type {RTCIceCandidateInit[]} */
    this._pendingRemoteIce = [];
    this._remoteDescriptionSet = false;
  }

  log(m) {
    this.onLog?.(m);
  }

  /**
   * Electron：优先用 desktopCapturer 的 sourceId + getUserMedia，避免部分环境 getDisplayMedia 无轨/黑屏。
   * 失败再退回系统选择器的 getDisplayMedia。
   */
  async _acquireDisplayStream() {
    const humanos = typeof window !== 'undefined' ? window.humanos : null;
    if (humanos?.getPrimaryScreenSourceId) {
      try {
        const sourceId = await humanos.getPrimaryScreenSourceId();
        if (sourceId) {
          const modern = {
            audio: false,
            video: {
              // Electron 扩展约束（非标准 Web API）
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
            },
          };
          try {
            const s = await navigator.mediaDevices.getUserMedia(modern);
            if (s.getVideoTracks().length) {
              this.log('屏幕采集: desktopCapturer + getUserMedia（主屏）');
              return s;
            }
            s.getTracks().forEach((t) => t.stop());
          } catch (e1) {
            this.log(`屏幕采集: 扩展约束失败，尝试 legacy — ${String(e1?.message || e1)}`);
          }
          try {
            const legacy = {
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId,
                },
              },
            };
            const s2 = await navigator.mediaDevices.getUserMedia(legacy);
            if (s2.getVideoTracks().length) {
              this.log('屏幕采集: desktopCapturer + getUserMedia（legacy）');
              return s2;
            }
            s2.getTracks().forEach((t) => t.stop());
          } catch (e2) {
            this.log(`屏幕采集: legacy 失败 — ${String(e2?.message || e2)}`);
          }
        }
      } catch (e) {
        this.log(`屏幕采集: 无法取得 sourceId — ${String(e?.message || e)}`);
      }
    }
    this.log('屏幕采集: getDisplayMedia（请选择要共享的屏幕）');
    return navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });
  }

  async start() {
    this.dispose();
    this.stream = await this._acquireDisplayStream();

    this.pc = new RTCPeerConnection(getRtcConfiguration());
    this.pc.onconnectionstatechange = () => {
      const s = this.pc?.connectionState;
      if (s) this.onConnectionState?.(s);
    };

    this.pc.oniceconnectionstatechange = () => {
      this.log(`WebRTC ICE: ${this.pc?.iceConnectionState}`);
    };
    this.pc.onsignalingstatechange = () => {
      this.log(`WebRTC signaling: ${this.pc?.signalingState}`);
    };
    this.stream.getTracks().forEach((t) => {
      this.pc.addTrack(t, this.stream);
    });

    this.dc = this.pc.createDataChannel('humanos-control', { ordered: true });
    this.dc.onopen = () => this.log('DataChannel: 控制通道已建立（被控端）');
    this.dc.onclose = () => this.log('DataChannel: 控制通道已关闭');
    this.dc.onmessage = async (ev) => {
      const cmd = parseControlMessage(String(ev.data));
      if (!cmd) return;
      if (window.humanos?.inputDispatch) {
        try {
          await window.humanos.inputDispatch(cmd);
        } catch (e) {
          console.error('[AgentRtc] inputDispatch', e);
        }
      }
    };

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.signal.relay({ kind: 'ice', candidate: e.candidate.toJSON() });
      }
    };

    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.signal.relay({
        kind: 'offer',
        type: this.pc.localDescription.type,
        sdp: this.pc.localDescription.sdp,
      });
      this.log('WebRTC: 已发送 offer');
    } catch (e) {
      this.log(`WebRTC: offer 失败 — ${String(e?.message || e)}`);
      throw e;
    }
  }

  /**
   * @param {unknown} payload
   */
  async handleRelayPayload(payload) {
    if (!this.pc || !payload || typeof payload !== 'object') return;
    const p = /** @type {{ kind?: string, type?: string, sdp?: string, candidate?: RTCIceCandidateInit }} */ (payload);
    if (p.kind === 'answer' && p.sdp && p.type) {
      try {
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: p.type, sdp: p.sdp }));
        this._remoteDescriptionSet = true;
        await this._flushPendingIce();
        this.log('WebRTC: 已设置远端 answer');
      } catch (e) {
        this.log(`WebRTC: setRemoteDescription(answer) 失败 — ${String(e?.message || e)}`);
        throw e;
      }
    }
    if (p.kind === 'ice' && p.candidate) {
      if (!this._remoteDescriptionSet) {
        this._pendingRemoteIce.push(p.candidate);
      } else {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(p.candidate));
        } catch (e) {
          console.warn('[AgentRtc] addIceCandidate', e);
        }
      }
    }
  }

  async _flushPendingIce() {
    if (!this.pc) return;
    for (const c of this._pendingRemoteIce) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        console.warn('[AgentRtc] flush ice', e);
      }
    }
    this._pendingRemoteIce = [];
  }

  dispose() {
    try {
      this.dc?.close();
    } catch {
      /* ignore */
    }
    this.dc = null;
    try {
      this.pc?.getSenders().forEach((s) => s.track?.stop());
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.pc = null;
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    this.stream = null;
    this._pendingRemoteIce = [];
    this._remoteDescriptionSet = false;
  }
}
