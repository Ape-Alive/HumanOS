'use strict';

const T = require('../protocol/messageTypes.js');

class MessageRouter {
  /**
   * @param {import('../registry/RoomRegistry.js').RoomRegistry} registry
   */
  constructor(registry) {
    this._registry = registry;
  }

  /**
   * @param {import('ws').WebSocket} ws
   * @param {Buffer | ArrayBuffer | Buffer[] | import('ws').RawData} raw
   */
  handle(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      ws.send(JSON.stringify({ type: T.ERROR, message: 'invalid json' }));
      return;
    }

    if (!msg || typeof msg.type !== 'string') {
      ws.send(JSON.stringify({ type: T.ERROR, message: 'missing type' }));
      return;
    }

    switch (msg.type) {
      case T.AGENT_REGISTER:
        this._registry.registerAgent(ws, msg.code, msg.deviceId);
        break;
      case T.CONTROLLER_JOIN:
        this._registry.joinController(ws, msg.code);
        break;
      case T.RELAY:
        this._registry.relay(ws, msg.payload);
        break;
      case T.SIGNALING_COMPLETE:
        /* 仅应答；勿 close(ws)，否则 RoomRegistry 会向对端发 PEER_LEFT 拆掉已建立的 P2P。
         * 云中继由 Workers DO 处理；本地 8787 客户端在本地模式也不会发 complete。 */
        try {
          ws.send(JSON.stringify({ type: T.SIGNALING_CLOSED, reason: 'p2p-ready' }));
        } catch {
          /* ignore */
        }
        break;
      default:
        ws.send(JSON.stringify({ type: T.ERROR, message: 'unknown type' }));
    }
  }
}

module.exports = { MessageRouter };
