import { normalizeSignalUrl } from '@/lib/inviteClipboard.js';

const DEFAULT_SIGNAL_URL = 'ws://127.0.0.1:8787/ws';

const STORAGE_KEY = 'humanos_signal_ws_url';

export function getStoredSignalUrlSync() {
  try {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
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

export { normalizeSignalUrl };
