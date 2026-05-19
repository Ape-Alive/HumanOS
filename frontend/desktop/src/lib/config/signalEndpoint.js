import { normalizeSignalUrl } from '@/lib/inviteClipboard.js';

const DEFAULT_SIGNAL_URL = 'ws://127.0.0.1:8787/ws';

/** 被控端/控制端「中继模式」默认信令（Cloudflare Workers + DO） */
export const DEFAULT_RELAY_SIGNAL_WS_URL = 'wss://humanos-signal.qihuiliu8.workers.dev/ws';

const STORAGE_KEY = 'humanos_signal_ws_url';

export function getStoredSignalUrlSync() {
  try {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

/** 中继模式默认 URL：有 localStorage 则用已保存，否则用 Cloudflare 部署地址 */
export function getDefaultRelaySignalUrlSync() {
  const stored = normalizeSignalUrl(getStoredSignalUrlSync());
  if (stored) return stored;
  return DEFAULT_RELAY_SIGNAL_WS_URL;
}

/** @param {string} url */
export function setStoredSignalUrl(url) {
  try {
    if (typeof localStorage === 'undefined') return;
    const t = String(url || '').trim();
    if (t && (t.startsWith('ws://') || t.startsWith('wss://'))) localStorage.setItem(STORAGE_KEY, t);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function isValidSignalUrl(u) {
  return normalizeSignalUrl(u).length > 0;
}

/**
 * @param {string} [uiOverride] 页面当前输入的信令地址（优先）
 */
export async function resolveSignalUrl(uiOverride) {
  const fromUi = typeof uiOverride === 'string' ? normalizeSignalUrl(uiOverride) : '';
  if (fromUi) return fromUi;

  const stored = normalizeSignalUrl(getStoredSignalUrlSync());
  if (stored) return stored;

  if (typeof window !== 'undefined' && window.humanos && window.humanos.getDefaultSignalUrl) {
    try {
      const u = await window.humanos.getDefaultSignalUrl();
      if (typeof u === 'string' && u.length > 0) return normalizeSignalUrl(u) || u.trim();
    } catch {
      /* ignore */
    }
  }
  return DEFAULT_SIGNAL_URL;
}

/**
 * 是否已为 Workers 房间路径（/room/{code}/agent|controller）
 * @param {string} url
 */
export function isRoomSignalUrl(url) {
  try {
    const u = new URL(normalizeSignalUrl(url));
    return /\/room\/[^/]+\/(agent|controller)\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/** 桌面端内置 Node 信令默认端口（任意网卡 IP 均为 /ws，非 /room/...） */
const EMBEDDED_NODE_SIGNAL_PORT = '8787';

/**
 * 本地内置 Node 信令（8787 + /ws）不走房间路径；Cloudflare Worker / 远程中继走 /room/...
 * @param {string} baseUrl
 */
export function shouldUseRoomSignalPath(baseUrl) {
  if (isRoomSignalUrl(baseUrl)) return false;
  try {
    const u = new URL(normalizeSignalUrl(baseUrl));
    const port = u.port || (u.protocol === 'wss:' ? '443' : '80');
    // 8787 为内置信令：监听 0.0.0.0，控制端填局域网 IP 时仍须连 /ws，不能拼 /room/...
    if (String(port) === EMBEDDED_NODE_SIGNAL_PORT) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Workers DO 信令：wss://host/room/842931/agent
 * @param {string} baseUrl 中继根地址（可含 /ws）
 * @param {string} codeDigits
 * @param {'agent' | 'controller'} role
 */
export function buildRoomSignalWebSocketUrl(baseUrl, codeDigits, role) {
  const digits = String(codeDigits || '').replace(/\D/g, '');
  if (digits.length < 4) return normalizeSignalUrl(baseUrl);

  const normalized = normalizeSignalUrl(baseUrl);
  if (!normalized) return '';

  if (isRoomSignalUrl(normalized)) return normalized;

  if (!shouldUseRoomSignalPath(normalized)) return normalized;

  try {
    const u = new URL(normalized);
    u.pathname = `/room/${digits}/${role}`;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return normalized;
  }
}

export { normalizeSignalUrl };
