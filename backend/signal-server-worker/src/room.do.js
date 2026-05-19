import { MESSAGE_TYPES as T } from './protocol/messageTypes.js';
import {
  safeCode,
  sendJson,
  sendError,
  readAttachment,
  findSocketByRole,
} from './roomLogic.js';

/**
 * 每个控制码一个 Durable Object 实例（idFromName(code)）。
 * WebSocket 全部关闭后 DO 可休眠/回收。
 */
export class Room {
  /**
   * @param {DurableObjectState} ctx
   * @param {Record<string, unknown>} env
   */
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  /**
   * @param {Request} request
   */
  async fetch(request) {
    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    const code = safeCode(request.headers.get('X-Room-Code') || '');
    const roleRaw = (request.headers.get('X-Room-Role') || '').toLowerCase();
    if (!code || (roleRaw !== 'agent' && roleRaw !== 'controller')) {
      return new Response('invalid room route', { status: 400 });
    }
    const role = /** @type {'agent' | 'controller'} */ (roleRaw);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ code, role });

    const sockets = this.ctx.getWebSockets();

    if (role === 'agent') {
      const existing = findSocketByRole(sockets, 'agent');
      if (existing && existing !== server && existing.readyState === WebSocket.OPEN) {
        sendError(server, 'control code already in use');
        server.close(1011, 'agent-exists');
        return new Response(null, { status: 101, webSocket: client });
      }
      sendJson(server, { type: T.AGENT_REGISTERED, code, deviceId: null });
      console.log(`[room] agent registered code=${code}`);
    } else {
      const agent = findSocketByRole(sockets, 'agent');
      if (!agent || agent.readyState !== WebSocket.OPEN) {
        sendError(server, 'no agent for this code');
        server.close(1011, 'no-agent');
        return new Response(null, { status: 101, webSocket: client });
      }
      const existingCtrl = findSocketByRole(sockets, 'controller');
      if (existingCtrl && existingCtrl !== server && existingCtrl.readyState === WebSocket.OPEN) {
        sendError(server, 'room full');
        server.close(1011, 'room-full');
        return new Response(null, { status: 101, webSocket: client });
      }
      const readyPayload = { type: T.ROOM_READY, code };
      sendJson(agent, readyPayload);
      sendJson(server, readyPayload);
      console.log(`[room] room ready code=${code}`);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * @param {WebSocket} ws
   * @param {string | ArrayBuffer} message
   */
  async webSocketMessage(ws, message) {
    const sockets = this.ctx.getWebSockets();
    let msg;
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      sendError(ws, 'invalid json');
      return;
    }

    if (!msg || typeof msg.type !== 'string') {
      sendError(ws, 'missing type');
      return;
    }

    switch (msg.type) {
      case T.RELAY: {
        const meta = readAttachment(ws);
        if (!meta) {
          sendError(ws, 'not in a room');
          return;
        }
        const peerRole = meta.role === 'agent' ? 'controller' : 'agent';
        const peer = findSocketByRole(sockets, peerRole);
        if (!peer || peer.readyState !== WebSocket.OPEN) {
          sendError(ws, 'peer not connected');
          return;
        }
        sendJson(peer, {
          type: T.RELAY_FORWARD,
          fromRole: meta.role,
          payload: msg.payload,
        });
        break;
      }
      case T.SIGNALING_COMPLETE:
        sendJson(ws, { type: T.SIGNALING_CLOSED, reason: 'p2p-ready' });
        try {
          ws.close(1000, 'p2p-ready');
        } catch {
          /* ignore */
        }
        console.log(`[room] signaling complete role=${readAttachment(ws)?.role}`);
        break;
      case T.AGENT_REGISTER:
      case T.CONTROLLER_JOIN:
        /* 已通过 URL /room/:code/:role 注册，忽略冗余消息 */
        break;
      default:
        sendError(ws, 'unknown type');
    }
  }

  /**
   * @param {WebSocket} ws
   */
  async webSocketClose(ws) {
    const meta = readAttachment(ws);
    if (!meta) return;

    const sockets = this.ctx.getWebSockets();
    const peerRole = meta.role === 'agent' ? 'controller' : 'agent';
    const peer = findSocketByRole(sockets, peerRole);
    if (peer && peer !== ws && peer.readyState === WebSocket.OPEN) {
      sendJson(peer, { type: T.PEER_LEFT, role: meta.role });
    }
    console.log(`[room] peer left code=${meta.code} role=${meta.role}`);
  }

  async webSocketError(ws) {
    try {
      ws.close(1011, 'error');
    } catch {
      /* ignore */
    }
  }
}
