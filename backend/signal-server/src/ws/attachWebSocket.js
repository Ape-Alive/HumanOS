'use strict';

const WebSocket = require('ws');
const { MessageRouter } = require('./messageRouter.js');

/**
 * @param {import('http').Server} httpServer
 * @param {string} path WebSocket path (e.g. /ws)
 * @param {import('../registry/RoomRegistry.js').RoomRegistry} registry
 */
function attachWebSocket(httpServer, path, registry) {
  const wss = new WebSocket.Server({ server: httpServer, path });
  const router = new MessageRouter(registry);

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => router.handle(ws, raw));
    ws.on('close', () => registry.removeSocket(ws));
    ws.on('error', () => registry.removeSocket(ws));
  });

  return wss;
}

module.exports = { attachWebSocket };
