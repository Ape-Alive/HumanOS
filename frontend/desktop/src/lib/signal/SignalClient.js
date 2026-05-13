import { MESSAGE_TYPES as T } from './protocol.js';

export class SignalClient {
  constructor() {
    this._ws = null;
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
    this._ws = new WebSocket(url);
    this._ws.addEventListener('open', () => this._emit('open'));
    this._ws.addEventListener('close', () => this._emit('close'));
    this._ws.addEventListener('error', () => this._emit('error'));
    this._ws.addEventListener('message', (ev) => this._emit('message', ev.data));
  }

  disconnect() {
    if (this._ws) {
      try {
        this._ws.close();
      } catch {
        /* ignore */
      }
      this._ws = null;
    }
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

  _send(obj) {
    if (!this.connected) {
      console.warn('[SignalClient] 未连接，丢弃信令消息:', obj?.type);
      return;
    }
    this._ws.send(JSON.stringify(obj));
  }
}
