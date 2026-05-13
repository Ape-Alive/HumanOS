'use strict';

const http = require('http');
const { readPort, WS_PATH } = require('./config.js');
const { handleRequest } = require('./http/healthServer.js');
const { RoomRegistry } = require('./registry/RoomRegistry.js');
const { attachWebSocket } = require('./ws/attachWebSocket.js');

const port = readPort();
const registry = new RoomRegistry();
const server = http.createServer(handleRequest);

attachWebSocket(server, WS_PATH, registry);

/** 显式监听 IPv4 全网卡，避免仅绑定回环导致局域网其它机器连不上 8787 */
server.listen(port, '0.0.0.0', () => {
  console.log(
    `[signal-server] listening on 0.0.0.0:${port}  ws ${WS_PATH}  (health: http://127.0.0.1:${port}/health)`
  );
});
