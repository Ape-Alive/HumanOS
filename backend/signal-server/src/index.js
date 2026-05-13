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

server.listen(port, () => {
  console.log(`[signal-server] http://127.0.0.1:${port}/health  ws path ${WS_PATH}`);
});
