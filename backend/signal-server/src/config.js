'use strict';

const DEFAULT_PORT = 8787;
const WS_PATH = '/ws';

function readPort() {
  const p = process.env.PORT || process.env.SIGNAL_PORT;
  if (p == null || p === '') return DEFAULT_PORT;
  const n = Number(p, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}

module.exports = {
  readPort,
  WS_PATH,
  DEFAULT_PORT,
};
