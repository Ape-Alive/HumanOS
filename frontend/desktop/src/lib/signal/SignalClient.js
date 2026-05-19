import { MESSAGE_TYPES as T } from './protocol.js';

export class SignalClient {
  constructor() {
    this._ws = null;
    /** @type {unknown[]} 在 WebSocket 仍为 CONNECTING 时暂存，open 后发出（避免 join/register 被静默丢弃） */
    this._pendingSend = [];
    this._handlers = {
      open: [],
      close: [],
      error: [],
      message: [],
    };
  }

  get connected() {
    return this._ws != null && this._ws.readyState === WebSocket.OPEN;
  }

  connect(url) {
    if (this._ws) {
      try {
        this._ws.close();
      } catch {
        /* ignore */
      }
      this._ws = null;
    }
    this._pendingSend = [];
    this._ws = new WebSocket(url);
    this._ws.addEventListener('open', () => {
      this._emit('open');
      this._flushPendingSend();
    });
    this._ws.addEventListener('close', () => this._emit('close'));
    this._ws.addEventListener('error', () => this._emit('error'));
    this._ws.addEventListener('message', (ev) => this._emit('message', ev.data));
  }

  _flushPendingSend() {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    const q = this._pendingSend;
    this._pendingSend = [];
    for (const obj of q) {
      try {
        this._ws.send(JSON.stringify(obj));
      } catch (e) {
        console.warn('[SignalClient] 补发信令失败', e);
      }
    }
  }

  disconnect() {
    const ws = this._ws;
    this._ws = null;
    this._pendingSend = [];
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    /** 须在清空 handlers 前触发，否则 P2P 后 completeSignaling 无法通知上层重连中继房间 */
    this._emit('close');
    for (const k of Object.keys(this._handlers)) {
      this._handlers[k] = [];
    }
  }

  on(event, fn) {
    if (this._handlers[event]) this._handlers[event].push(fn);
  }

  _emit(event, data) {
    for (const fn of this._handlers[event]) {
      try {
        fn(data);
      } catch (e) {
        console.error('[SignalClient]', e);
      }
    }
  }

  registerAgent(code, deviceId) {
    this._send({ type: T.AGENT_REGISTER, code, deviceId });
  }

  joinController(code) {
    this._send({ type: T.CONTROLLER_JOIN, code });
  }

  relay(payload) {
    this._send({ type: T.RELAY, payload });
  }

  /** WebRTC 已连通：通知服务端关闭信令（Workers DO 将休眠） */
  completeSignaling() {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      this.disconnect();
      return;
    }
    try {
      this._ws.send(JSON.stringify({ type: T.SIGNALING_COMPLETE }));
    } catch {
      /* ignore */
    }
    const ws = this._ws;
    const onMsg = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg?.type === T.SIGNALING_CLOSED) {
          cleanup();
        }
      } catch {
        /* ignore */
      }
    };
    const cleanup = () => {
      ws.removeEventListener('message', onMsg);
      clearTimeout(timer);
      this.disconnect();
    };
    ws.addEventListener('message', onMsg);
    const timer = setTimeout(cleanup, 800);
  }

  _send(obj) {
    if (!this._ws) {
      console.warn('[SignalClient] 无 WebSocket，丢弃信令消息:', obj?.type);
      return;
    }
    if (this._ws.readyState === WebSocket.OPEN) {
      try {
        this._ws.send(JSON.stringify(obj));
      } catch (e) {
        console.warn('[SignalClient] send 异常', e);
      }
      return;
    }
    if (this._ws.readyState === WebSocket.CONNECTING) {
      this._pendingSend.push(obj);
      return;
    }
    console.warn('[SignalClient] WebSocket 不可发送，丢弃:', obj?.type, 'readyState=', this._ws.readyState);
  }
}
