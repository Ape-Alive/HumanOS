import { getRtcConfiguration } from './rtcConfig.js';
import { parseControlMessage } from './controlChannel.js';

/** 屏幕共享目标帧率：偏低时单帧可分得更多码率，利于保分辨率、减卡顿 */
const SCREEN_SHARE_TARGET_FPS = 15;

/** 按当前显示器推算采集分辨率上限，减少 Chromium 默认「低分辨率省带宽」 */
function getScreenShareSizeHints() {
  if (typeof window === 'undefined') {
    return { maxW: 1920, maxH: 1080, idealW: 1920, idealH: 1080 };
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const rw = Math.floor((window.screen.width || 1920) * dpr);
  const rh = Math.floor((window.screen.height || 1080) * dpr);
  const maxW = Math.min(Math.max(rw, 1920), 5120);
  const maxH = Math.min(Math.max(rh, 1080), 2880);
  return { maxW, maxH, idealW: rw, idealH: rh };
}

function sortVideoCodecsForScreenShare(all) {
  const rank = (c) => {
    const m = String(c.mimeType || '').toLowerCase();
    if (m === 'video/av1') return 0;
    if (m === 'video/vp9') return 1;
    if (m === 'video/h264') return 2;
    if (m === 'video/vp8') return 3;
    return 4;
  };
  return [...all].sort((a, b) => rank(a) - rank(b) || String(a.mimeType).localeCompare(String(b.mimeType)));
}

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
    this._recaptureBusy = false;
  }

  log(m) {
    this.onLog?.(m);
  }

  /**
   * 提高屏幕共享主观清晰度：提高码率上限、尽量不先降分辨率。
   * @param {RTCRtpSender} sender
   * @param {{ silent?: boolean }} [opts]
   */
  async _tuneVideoSenderForScreenShare(sender, opts = {}) {
    if (!sender?.track || sender.track.kind !== 'video') return;
    const silent = opts.silent === true;
    try {
      const settings = sender.track.getSettings?.() || {};
      const w = Number(settings.width) || 1920;
      const h = Number(settings.height) || 1080;
      const pixels = w * h;
      let maxBitrate = 6_500_000;
      if (pixels > 1920 * 1080) maxBitrate = 12_000_000;
      if (pixels > 2560 * 1440) maxBitrate = 18_000_000;
      if (pixels > 3840 * 2160) maxBitrate = 28_000_000;

      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      const enc = params.encodings[0];
      enc.maxBitrate = maxBitrate;
      enc.maxFramerate = SCREEN_SHARE_TARGET_FPS;
      enc.scaleResolutionDownBy = 1;
      if ('degradationPreference' in params) {
        params.degradationPreference = 'maintain-resolution';
      }
      await sender.setParameters(params);
      if (!silent && w >= 640 && h >= 480) {
        this.log(
          `WebRTC: 发送画质已优化（${w}×${h}，约 ${SCREEN_SHARE_TARGET_FPS}fps，码率上限约 ${Math.round(maxBitrate / 1e6)} Mbps，优先保分辨率）`
        );
      }
    } catch (e) {
      if (!silent) this.log(`WebRTC: 发送端画质参数调整跳过 — ${String(e?.message || e)}`);
    }
  }

  /**
   * 使用 Electron 扩展约束从指定 desktopCapturer sourceId 取视频轨。
   * @param {string} sourceId
   * @param {number} maxW
   * @param {number} maxH
   * @returns {Promise<MediaStream | null>}
   */
  async _getUserMediaWithDesktopSourceId(sourceId, maxW, maxH) {
    const modern = {
      audio: false,
      video: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: maxW,
        maxHeight: maxH,
        maxFrameRate: SCREEN_SHARE_TARGET_FPS,
        minFrameRate: 8,
        minWidth: 640,
        minHeight: 360,
      },
    };
    try {
      const s = await navigator.mediaDevices.getUserMedia(modern);
      if (s.getVideoTracks().length) return s;
      s.getTracks().forEach((t) => t.stop());
    } catch (e1) {
      this.log(`屏幕采集: 扩展约束失败，尝试 legacy — ${String(/** @type {{ message?: string }} */ (e1)?.message || e1)}`);
    }
    try {
      const legacy = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth: maxW,
            maxHeight: maxH,
            maxFrameRate: SCREEN_SHARE_TARGET_FPS,
            minFrameRate: 8,
            minWidth: 640,
            minHeight: 360,
          },
        },
      };
      const s2 = await navigator.mediaDevices.getUserMedia(legacy);
      if (s2.getVideoTracks().length) return s2;
      s2.getTracks().forEach((t) => t.stop());
    } catch (e2) {
      this.log(`屏幕采集: legacy 失败 — ${String(/** @type {{ message?: string }} */ (e2)?.message || e2)}`);
    }
    return null;
  }

  /**
   * Electron：仅用 desktopCapturer + getUserMedia(desktop)，自动模式不再走 getDisplayMedia，避免误选摄像头。
   * @param {{ forceUserPicker?: boolean }} [opts] forceUserPicker=true 时走系统选择器（切换画面）
   */
  async _acquireDisplayStream(opts = {}) {
    const forceUserPicker = opts.forceUserPicker === true;
    const { maxW, maxH, idealW, idealH } = getScreenShareSizeHints();
    const humanos = typeof window !== 'undefined' ? window.humanos : null;

    if (!forceUserPicker && typeof humanos?.getDesktopScreenCaptureSourceIds === 'function') {
      /** @type {string[]} */
      let ids = [];
      try {
        const pack = await humanos.getDesktopScreenCaptureSourceIds();
        ids = Array.isArray(pack?.ids) ? pack.ids.filter((x) => typeof x === 'string' && x) : [];
      } catch (e) {
        this.log(`屏幕采集: 枚举桌面源失败 — ${String(/** @type {{ message?: string }} */ (e)?.message || e)}`);
      }
      for (let i = 0; i < ids.length; i++) {
        const sourceId = ids[i];
        const stream = await this._getUserMediaWithDesktopSourceId(sourceId, maxW, maxH);
        if (stream) {
          this.log(
            `屏幕采集: desktopCapturer + getUserMedia（候选 ${i + 1}/${ids.length}，≤${maxW}×${maxH}，约 ${SCREEN_SHARE_TARGET_FPS}fps）`,
          );
          return stream;
        }
      }
      const hint =
        '无法自动采集屏幕：请在 macOS「系统设置 → 隐私与安全性 → 屏幕录制」中勾选本应用（Electron），完全退出后重开；Windows 请在「设置 → 隐私 → 屏幕截图」允许桌面应用访问。';
      this.log(`屏幕采集: ${hint}`);
      throw new Error(hint);
    }

    if (forceUserPicker) {
      this.log(
        '屏幕采集: 请在系统对话框中选择「整个屏幕」或物理显示器缩略图；勿选摄像头、虚拟摄像机、窗口。',
      );
      const video = {
        displaySurface: 'monitor',
        width: { max: maxW, ideal: idealW },
        height: { max: maxH, ideal: idealH },
        frameRate: { ideal: SCREEN_SHARE_TARGET_FPS, max: SCREEN_SHARE_TARGET_FPS },
      };
      const base = { video, audio: false };
      try {
        return await navigator.mediaDevices.getDisplayMedia({
          ...base,
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'exclude',
        });
      } catch {
        return navigator.mediaDevices.getDisplayMedia(base);
      }
    }

    this.log('屏幕采集: 未检测到 Electron 桌面枚举 API，回退 getDisplayMedia（仅建议用于浏览器调试）');
    const video = {
      displaySurface: 'monitor',
      width: { max: maxW, ideal: idealW },
      height: { max: maxH, ideal: idealH },
      frameRate: { ideal: SCREEN_SHARE_TARGET_FPS, max: SCREEN_SHARE_TARGET_FPS },
    };
    const base = { video, audio: false };
    try {
      return await navigator.mediaDevices.getDisplayMedia({
        ...base,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
      });
    } catch {
      return navigator.mediaDevices.getDisplayMedia(base);
    }
  }

  /**
   * 由控制端 DataChannel 触发：不重建 PeerConnection，仅替换视频轨。
   */
  async switchCaptureFromRemote() {
    if (this._recaptureBusy) {
      this.log('切换画面: 正在处理上一请求，请稍候');
      return;
    }
    if (!this.pc || this.pc.connectionState === 'closed') {
      this.log('切换画面: WebRTC 未连接');
      return;
    }
    const sender = this.pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) {
      this.log('切换画面: 未找到视频发送端');
      return;
    }
    this._recaptureBusy = true;
    try {
      const newStream = await this._acquireDisplayStream({ forceUserPicker: true });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) {
        this.log('切换画面: 未取得新视频轨');
        newStream.getTracks().forEach((t) => t.stop());
        return;
      }
      const old = this.stream;
      if (old) {
        for (const t of old.getTracks()) {
          if (t.kind === 'video') {
            try {
              t.stop();
            } catch {
              /* ignore */
            }
          }
        }
      }
      await sender.replaceTrack(newTrack);
      this.stream = newStream;
      await this._tuneVideoSenderForScreenShare(sender, { silent: false });
      this.log('切换画面: 已应用新采集源');
    } catch (e) {
      this.log(`切换画面: 失败 — ${String(e?.message || e)}`);
    } finally {
      this._recaptureBusy = false;
    }
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
    this.pc.onicecandidateerror = (ev) => {
      const code = /** @type {{ errorCode?: number }} */ (ev).errorCode;
      const text = /** @type {{ errorText?: string }} */ (ev).errorText;
      const url = /** @type {{ url?: string }} */ (ev).url;
      this.log(`ICE 收集异常: code=${code ?? '?'} ${text || ''} ${url ? `stun=${url}` : ''}`);
    };
    this.pc.onsignalingstatechange = () => {
      this.log(`WebRTC signaling: ${this.pc?.signalingState}`);
    };
    this.stream.getTracks().forEach((t) => {
      this.pc.addTrack(t, this.stream);
    });

    try {
      const tr = this.pc.getTransceivers().find((x) => x.sender?.track?.kind === 'video');
      if (tr && typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities) {
        const caps = RTCRtpSender.getCapabilities('video');
        const all = caps?.codecs || [];
        const ordered = sortVideoCodecsForScreenShare(all);
        if (ordered.length) tr.setCodecPreferences(ordered);
      }
    } catch (e) {
      this.log(`WebRTC: 编解码偏好跳过 — ${String(e?.message || e)}`);
    }

    this.dc = this.pc.createDataChannel('humanos-control', { ordered: true });
    this.dc.onopen = () => this.log('DataChannel: 控制通道已建立（被控端）');
    this.dc.onclose = () => this.log('DataChannel: 控制通道已关闭');
    this.dc.onmessage = async (ev) => {
      const cmd = parseControlMessage(String(ev.data));
      if (!cmd) return;
      if (cmd.type === 'recapture') {
        try {
          await this.switchCaptureFromRemote();
        } catch (e) {
          this.log(`切换画面: ${String(e?.message || e)}`);
        }
        return;
      }
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
      const vSender = this.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (vSender) await this._tuneVideoSenderForScreenShare(vSender, { silent: true });

      const onConn = () => {
        if (this.pc?.connectionState !== 'connected') return;
        const vs = this.pc.getSenders().find((s) => s.track?.kind === 'video');
        if (vs) void this._tuneVideoSenderForScreenShare(vs, { silent: false });
        this.pc?.removeEventListener('connectionstatechange', onConn);
      };
      this.pc.addEventListener('connectionstatechange', onConn);

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
    this._recaptureBusy = false;
  }
}
