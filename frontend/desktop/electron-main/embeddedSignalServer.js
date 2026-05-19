'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');

const DEFAULT_PORT = 8787;
const WS_PATH = '/ws';

/** @type {import('http').Server | null} */
let httpServer = null;
/** @type {boolean} */
let startedByEmbed = false;
let listenPort = DEFAULT_PORT;

/**
 * @param {string} dir
 */
function dirHasSignalSrc(dir) {
  return fs.existsSync(path.join(dir, 'config.js'));
}

/**
 * 开发：monorepo backend/signal-server/src；打包：resources/signal-server/src
 * @param {boolean} isPackaged
 */
function resolveSignalServerSrcDir(isPackaged) {
  /** @type {string[]} */
  const candidates = [];
  if (isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'signal-server', 'src'));
  }
  candidates.push(path.join(__dirname, '..', '..', '..', 'backend', 'signal-server', 'src'));
  candidates.push(path.join(__dirname, '..', 'resources', 'signal-server', 'src'));
  for (const d of candidates) {
    if (dirHasSignalSrc(d)) return d;
  }
  return null;
}

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function probeHealth(port) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/health',
        method: 'GET',
        timeout: 2500,
      },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * @param {number} port
 * @param {number} [timeoutMs]
 */
async function waitForHealth(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeHealth(port)) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

function shouldSkipEmbedded() {
  const v = String(process.env.HUMANOS_SKIP_EMBEDDED_SIGNAL || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * @param {{ isPackaged?: boolean, port?: number }} [opts]
 * @returns {Promise<{ ok: boolean, port: number, embedded?: boolean, external?: boolean, error?: string }>}
 */
async function startEmbeddedSignalServer(opts = {}) {
  const port = Math.max(1, Math.floor(Number(opts.port || process.env.SIGNAL_PORT || DEFAULT_PORT)));

  if (shouldSkipEmbedded()) {
    listenPort = port;
    const up = await probeHealth(port);
    return { ok: up, port, embedded: false, external: up, skipped: true };
  }

  if (httpServer && startedByEmbed) {
    listenPort = port;
    return { ok: true, port: listenPort, embedded: true };
  }

  if (await probeHealth(port)) {
    listenPort = port;
    return { ok: true, port, embedded: false, external: true };
  }

  const srcDir = resolveSignalServerSrcDir(!!opts.isPackaged);
  if (!srcDir) {
    return { ok: false, port, error: 'signal-server-src-not-found' };
  }

  const { handleRequest } = require(path.join(srcDir, 'http', 'healthServer.js'));
  const { RoomRegistry } = require(path.join(srcDir, 'registry', 'RoomRegistry.js'));
  const { attachWebSocket } = require(path.join(srcDir, 'ws', 'attachWebSocket.js'));

  const registry = new RoomRegistry();
  httpServer = http.createServer(handleRequest);
  attachWebSocket(httpServer, WS_PATH, registry);

  try {
    await new Promise((resolve, reject) => {
      const onError = (err) => {
        httpServer?.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        httpServer?.removeListener('error', onError);
        resolve();
      };
      httpServer.once('error', onError);
      httpServer.listen(port, '0.0.0.0', onListening);
    });
  } catch (e) {
    const code = /** @type {NodeJS.ErrnoException} */ (e)?.code;
    httpServer = null;
    startedByEmbed = false;
    if (code === 'EADDRINUSE') {
      const up = await probeHealth(port);
      if (up) {
        listenPort = port;
        return { ok: true, port, embedded: false, external: true };
      }
    }
    return { ok: false, port, error: String(/** @type {{ message?: string }} */ (e)?.message || e) };
  }

  const ready = await waitForHealth(port);
  if (!ready) {
    await stopEmbeddedSignalServer();
    return { ok: false, port, error: 'health-timeout' };
  }

  listenPort = port;
  startedByEmbed = true;
  console.log(
    `[HumanOS] embedded signal-server on 0.0.0.0:${port} ws ${WS_PATH} (health ok)`,
  );
  return { ok: true, port, embedded: true };
}

/**
 * @returns {Promise<void>}
 */
function stopEmbeddedSignalServer() {
  if (!httpServer || !startedByEmbed) {
    httpServer = null;
    startedByEmbed = false;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const s = httpServer;
    httpServer = null;
    startedByEmbed = false;
    s.close(() => {
      console.log('[HumanOS] embedded signal-server stopped');
      resolve();
    });
  });
}

function getEmbeddedSignalPort() {
  return listenPort;
}

function getDefaultSignalWsUrl() {
  const explicit = process.env.HUMANOS_SIGNAL_WS_URL;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  return `ws://127.0.0.1:${getEmbeddedSignalPort()}/ws`;
}

module.exports = {
  startEmbeddedSignalServer,
  stopEmbeddedSignalServer,
  getEmbeddedSignalPort,
  getDefaultSignalWsUrl,
  probeHealth,
  DEFAULT_PORT,
  WS_PATH,
};
