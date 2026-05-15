/**
 * Google Gemini（Generative Language API）generateContent，支持多模态（inline image）。
 * 文档：https://ai.google.dev/api/rest/v1beta/models.generateContent
 */

import { GEMINI_API_DEFAULT_BASE } from '@/lib/config/aiControlSettings.js';
import { doHttpRequest } from '../doHttpRequest.js';

/**
 * @param {unknown} data
 * @returns {string}
 */
function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
}

/**
 * @param {{
 *   apiBaseUrl: string,
 *   apiKey: string,
 *   model: string,
 *   system?: string,
 *   userText: string,
 *   imageBase64?: string | null,
 *   mime?: string | null,
 *   attachments?: { mimeType: string, data: string, fileName?: string }[],
 *   signal?: AbortSignal,
 *   temperature?: number,
 *   maxOutputTokens?: number,
 * }} p
 * @returns {Promise<string>}
 */
export async function geminiGenerateContent(p) {
  const base = (String(p.apiBaseUrl || '').trim().replace(/\/$/, '') || GEMINI_API_DEFAULT_BASE).replace(/\/$/, '');
  const modelRaw = String(p.model || '').trim() || 'gemini-2.0-flash';
  const model = encodeURIComponent(modelRaw);
  const url = `${base}/models/${model}:generateContent`;

  /** @type {({ text: string } | { inlineData: { mimeType: string, data: string } })[]} */
  const parts = [{ text: String(p.userText || '') }];
  if (p.imageBase64 && p.mime) {
    let b64 = String(p.imageBase64).replace(/\s/g, '');
    const m = /^data:([^;]+);base64,(.+)$/i.exec(b64);
    if (m) b64 = m[2];
    if (b64) {
      parts.push({
        inlineData: {
          mimeType: String(p.mime),
          data: b64,
        },
      });
    }
  }
  if (Array.isArray(p.attachments)) {
    for (const a of p.attachments) {
      let d = String(a?.data || '').replace(/\s/g, '');
      const mt = String(a?.mimeType || '').trim();
      if (!d || !mt) continue;
      const m = /^data:([^;]+);base64,(.+)$/i.exec(d);
      if (m) d = m[2];
      parts.push({ inlineData: { mimeType: mt, data: d } });
    }
  }

  /** @type {Record<string, unknown>} */
  const body = {
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    generationConfig: {
      temperature: typeof p.temperature === 'number' ? p.temperature : 0.2,
      maxOutputTokens: Math.min(8192, Math.max(256, Number(p.maxOutputTokens) || 8192)),
    },
  };

  if (p.system && String(p.system).trim()) {
    body.systemInstruction = { parts: [{ text: String(p.system) }] };
  }

  const res = await doHttpRequest(url, {
    method: 'POST',
    signal: p.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': String(p.apiKey || ''),
    },
    body: JSON.stringify(body),
  });

  const raw = res.text;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini 非 JSON 响应: ${raw.slice(0, 300)}`);
  }

  if (!res.ok) {
    const errMsg = data?.error?.message || data?.error?.status || raw.slice(0, 600);
    throw new Error(`Gemini API ${res.status}: ${errMsg}`);
  }

  const text = extractGeminiText(data);
  if (!text && data?.candidates?.[0]?.finishReason) {
    const fr = data.candidates[0].finishReason;
    throw new Error(`Gemini 无文本输出 (finishReason=${fr})`);
  }
  return text;
}

/**
 * @param {{ apiBaseUrl: string, apiKey: string, model: string }} profile
 */
export function createGeminiAdapter(profile) {
  return {
    kind: 'gemini',
    profile,
    /**
     * @param {{ system: string, userText: string, imageBase64?: string | null, mime?: string, signal?: AbortSignal, attachments?: { mimeType: string, data: string, fileName?: string }[], temperature?: number }} req
     */
    async complete(req) {
      return geminiGenerateContent({
        apiBaseUrl: profile.apiBaseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
        system: req.system,
        userText: req.userText,
        imageBase64: req.imageBase64,
        mime: req.mime,
        attachments: req.attachments,
        signal: req.signal,
        temperature: typeof req.temperature === 'number' ? req.temperature : undefined,
      });
    },
  };
}
