'use strict';

const T = require('../protocol/messageTypes.js');

function safeCode(code) {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  if (trimmed.length < 4 || trimmed.length > 32) return null;
  return /^[a-zA-Z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

/**
 * One room = one control code, at most one agent WS and one controller WS.
 */
class RoomRegistry {
  constructor() {
    /** @type {Map<string, { code: string, agent: import('ws').WebSocket | null, controller: import('ws').WebSocket | null }>} */
    this._rooms = new Map();
    /** @type {WeakMap<import('ws').WebSocket, { code: string, role: 'agent' | 'controller' }>} */
    this._socketMeta = new WeakMap();
  }

  _send(ws, obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  _error(ws, message) {
    this._send(ws, { type: T.ERROR, message });
  }

  /**
   * @param {import('ws').WebSocket} ws
   * @param {string} code
   * @param {string} [deviceId]
   */
  registerAgent(ws, code, deviceId) {
    const c = safeCode(code);
    if (!c) {
      this._error(ws, 'invalid control code');
      return;
    }

    const existing = this._socketMeta.get(ws);
    if (existing) {
      this._error(ws, 'already registered');
      return;
    }

    const room = this._rooms.get(c);
    if (room && room.agent && room.agent !== ws && room.agent.readyState === 1) {
      this._error(ws, 'control code already in use');
      return;
    }

    const r = room || { code: c, agent: null, controller: null };
    r.agent = ws;
    this._rooms.set(c, r);
    this._socketMeta.set(ws, { code: c, role: 'agent' });

    this._send(ws, {
      type: T.AGENT_REGISTERED,
      code: c,
      deviceId: deviceId || null,
    });
  }

  /**
   * @param {import('ws').WebSocket} ws
   * @param {string} code
   */
  joinController(ws, code) {
    const c = safeCode(code);
    if (!c) {
      this._error(ws, 'invalid control code');
      return;
    }

    const existing = this._socketMeta.get(ws);
    if (existing) {
      this._error(ws, 'already registered');
      return;
    }

    const room = this._rooms.get(c);
    if (!room || !room.agent || room.agent.readyState !== 1) {
      this._error(ws, 'no agent for this code');
      return;
    }

    if (room.controller && room.controller !== ws && room.controller.readyState === 1) {
      this._error(ws, 'room full');
      return;
    }

    room.controller = ws;
    this._socketMeta.set(ws, { code: c, role: 'controller' });

    const readyPayload = { type: T.ROOM_READY, code: c };
    this._send(room.agent, readyPayload);
    this._send(room.controller, readyPayload);
  }

  /**
   * @param {import('ws').WebSocket} from
   * @param {unknown} payload opaque relay body (offer / answer / ice)
   */
  relay(from, payload) {
    const meta = this._socketMeta.get(from);
    if (!meta) {
      this._error(from, 'not in a room');
      return;
    }
    const room = this._rooms.get(meta.code);
    if (!room) {
      this._error(from, 'room gone');
      return;
    }

    const peer =
      meta.role === 'agent' ? room.controller : room.agent;
    if (!peer || peer.readyState !== 1) {
      this._error(from, 'peer not connected');
      return;
    }

    this._send(peer, {
      type: T.RELAY_FORWARD,
      fromRole: meta.role,
      payload,
    });
  }

  /** @param {import('ws').WebSocket} ws */
  removeSocket(ws) {
    const meta = this._socketMeta.get(ws);
    if (!meta) return;

    this._socketMeta.delete(ws);
    const room = this._rooms.get(meta.code);
    if (!room) return;

    const notify = (other) => {
      this._send(other, { type: T.PEER_LEFT, role: meta.role });
    };

    if (meta.role === 'agent') {
      if (room.controller && room.controller.readyState === 1) notify(room.controller);
      room.agent = null;
    } else {
      if (room.agent && room.agent.readyState === 1) notify(room.agent);
      room.controller = null;
    }

    if (!room.agent && !room.controller) {
      this._rooms.delete(meta.code);
    }
  }
}

module.exports = { RoomRegistry };
