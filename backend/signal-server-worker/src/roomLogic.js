import { MESSAGE_TYPES as T } from './protocol/messageTypes.js';

export function safeCode(code) {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  if (trimmed.length < 4 || trimmed.length > 32) return null;
  return /^[a-zA-Z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

/**
 * @param {WebSocket} ws
 * @param {Record<string, unknown>} obj
 */
export function sendJson(ws, obj) {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  } catch {
    /* ignore */
  }
}

/**
 * @param {WebSocket} ws
 * @param {string} message
 */
export function sendError(ws, message) {
  sendJson(ws, { type: T.ERROR, message });
}

/**
 * @param {WebSocket} ws
 * @returns {{ code: string, role: 'agent' | 'controller' } | null}
 */
export function readAttachment(ws) {
  try {
    const a = ws.deserializeAttachment();
    if (!a || typeof a !== 'object') return null;
    const code = safeCode(/** @type {{ code?: string }} */ (a).code);
    const role = /** @type {{ role?: string }} */ (a).role;
    if (!code || (role !== 'agent' && role !== 'controller')) return null;
    return { code, role };
  } catch {
    return null;
  }
}

/**
 * @param {Iterable<WebSocket>} sockets
 * @param {'agent' | 'controller'} role
 */
export function findSocketByRole(sockets, role) {
  for (const ws of sockets) {
    const a = readAttachment(ws);
    if (a?.role === role) return ws;
  }
  return null;
}

/**
 * @param {WebSocket} from
 * @param {Iterable<WebSocket>} sockets
 */
export function relay(from, sockets) {
  const meta = readAttachment(from);
  if (!meta) {
    sendError(from, 'not in a room');
    return;
  }
  const peerRole = meta.role === 'agent' ? 'controller' : 'agent';
  const peer = findSocketByRole(sockets, peerRole);
  if (!peer || peer.readyState !== WebSocket.OPEN) {
    sendError(from, 'peer not connected');
    return;
  }
  // payload parsed by caller
}
