import { createGeminiAdapter } from './geminiVisionChat.js';
import { doHttpRequest } from '../doHttpRequest.js';

/**
 * OpenAI 兼容 Chat Completions（可选 vision 多模态消息）。
 * @param {{
 *   apiBaseUrl: string,
 *   apiKey: string,
 *   model: string,
 *   messages: unknown[],
 *   signal?: AbortSignal,
 *   maxTokens?: number,
 *   temperature?: number,
 * }} p
 * @returns {Promise<string>}
 */
export async function openAiChatCompletions(p) {
  const base = String(p.apiBaseUrl || '').replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const res = await doHttpRequest(url, {
    method: 'POST',
    signal: p.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify({
      model: p.model,
      messages: p.messages,
      max_tokens: Math.min(8192, Math.max(256, Number(p.maxTokens) || 4096)),
      temperature: typeof p.temperature === 'number' ? p.temperature : 0.2,
    }),
  });
  const raw = res.text;
  if (!res.ok) {
    throw new Error(`Chat API ${res.status}: ${raw.slice(0, 800)}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Chat API 非 JSON 响应: ${raw.slice(0, 200)}`);
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('Chat API 无 choices[0].message.content');
  return text;
}

/**
 * @param {{ apiBaseUrl: string, apiKey: string, model: string }} profile
 */
export function createOpenAiCompatibleAdapter(profile) {
  return {
    kind: 'openai-compatible',
    profile,
    /**
     * @param {{ system: string, userText: string, imageBase64?: string | null, mime?: string, signal?: AbortSignal }} req
     */
    async complete(req) {
      const userContent =
        req.imageBase64 && req.mime
          ? [
              { type: 'text', text: req.userText },
              {
                type: 'image_url',
                image_url: { url: `data:${req.mime};base64,${req.imageBase64}` },
              },
            ]
          : req.userText;
      const messages = [
        { role: 'system', content: req.system },
        { role: 'user', content: userContent },
      ];
      return openAiChatCompletions({
        apiBaseUrl: profile.apiBaseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
        messages,
        signal: req.signal,
      });
    },
  };
}

/**
 * @param {string} providerId
 * @param {{ apiBaseUrl: string, apiKey: string, model: string }} profile
 */
export function createAiProviderAdapter(providerId, profile) {
  const id = String(providerId || 'openai-compatible').toLowerCase();
  if (id === 'openai-compatible' || id === 'openai' || id === 'custom') {
    return createOpenAiCompatibleAdapter(profile);
  }
  if (id === 'gemini') {
    return createGeminiAdapter(profile);
  }
  if (id === 'claude' || id === 'anthropic') {
    throw new Error('Claude Provider 尚未接入：请扩展 aiProviderAdapter / Messages API');
  }
  return createOpenAiCompatibleAdapter(profile);
}
