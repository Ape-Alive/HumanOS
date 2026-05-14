'use strict';

const STORAGE_KEY = 'humanos_ai_control_settings';

export const AI_CONTROL_DEFAULTS = {
  provider: 'openai-compatible',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  maxRounds: 10,
};

/** Google AI Studio / Gemini API 默认根路径（不含模型） */
export const GEMINI_API_DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** @typedef {{ id: string, name: string, provider: 'openai-compatible'|'gemini', apiBaseUrl: string, apiKey: string, model: string, maxRounds: number }} AiProfile */

/** @typedef {{ activeProfileId: string, profiles: AiProfile[] }} AiControlStore */

function makeId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function clampRounds(n) {
  return Math.min(100, Math.max(1, Math.floor(Number(n)) || 10));
}

/**
 * @param {Partial<AiProfile> & { id?: string }} p
 * @returns {AiProfile}
 */
function normalizeProfile(p) {
  const provider = p.provider === 'gemini' ? 'gemini' : 'openai-compatible';
  return {
    id: typeof p.id === 'string' && p.id ? p.id : makeId(),
    provider,
    name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '未命名',
    apiBaseUrl:
      typeof p.apiBaseUrl === 'string' && p.apiBaseUrl.trim()
        ? p.apiBaseUrl.trim()
        : provider === 'gemini'
          ? GEMINI_API_DEFAULT_BASE
          : AI_CONTROL_DEFAULTS.apiBaseUrl,
    apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
    model:
      typeof p.model === 'string' && p.model.trim()
        ? p.model.trim()
        : provider === 'gemini'
          ? 'gemini-2.0-flash'
          : AI_CONTROL_DEFAULTS.model,
    maxRounds: clampRounds(p.maxRounds),
  };
}

/**
 * @returns {AiControlStore}
 */
function defaultStore() {
  const id = makeId();
  return {
    activeProfileId: id,
    profiles: [
      normalizeProfile({
        id,
        name: '默认',
        provider: AI_CONTROL_DEFAULTS.provider,
        apiBaseUrl: AI_CONTROL_DEFAULTS.apiBaseUrl,
        apiKey: '',
        model: AI_CONTROL_DEFAULTS.model,
        maxRounds: AI_CONTROL_DEFAULTS.maxRounds,
      }),
    ],
  };
}

/**
 * @returns {AiControlStore}
 */
export function loadAiControlStore() {
  try {
    if (typeof localStorage === 'undefined') return defaultStore();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStore();
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return defaultStore();

    if (Array.isArray(o.profiles) && o.profiles.length) {
      const profiles = o.profiles.map((x) => normalizeProfile(x));
      let activeProfileId =
        typeof o.activeProfileId === 'string' && profiles.some((p) => p.id === o.activeProfileId)
          ? o.activeProfileId
          : profiles[0].id;
      return { activeProfileId, profiles };
    }

    if (typeof o.apiBaseUrl === 'string' || o.apiKey != null || o.model != null) {
      const id = makeId();
      return {
        activeProfileId: id,
        profiles: [
          normalizeProfile({
            id,
            name: '默认',
            apiBaseUrl: o.apiBaseUrl,
            apiKey: o.apiKey,
            model: o.model,
            maxRounds: o.maxRounds,
          }),
        ],
      };
    }

    return defaultStore();
  } catch {
    return defaultStore();
  }
}

/**
 * @param {AiControlStore} store
 */
export function saveAiControlStore(store) {
  try {
    if (typeof localStorage === 'undefined') return;
    const profiles = (store.profiles || []).map((p) => normalizeProfile(p));
    if (!profiles.length) return;
    let activeProfileId = store.activeProfileId;
    if (!profiles.some((p) => p.id === activeProfileId)) activeProfileId = profiles[0].id;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeProfileId,
        profiles,
      })
    );
  } catch {
    /* ignore */
  }
}

/**
 * @param {AiControlStore} store
 * @returns {AiProfile}
 */
export function getActiveProfile(store) {
  const p = store.profiles.find((x) => x.id === store.activeProfileId);
  return p || store.profiles[0];
}

export { makeId as makeAiProfileId };
