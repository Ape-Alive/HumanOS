import { promptManager } from '../prompts/promptManager.js';
import { createVisionProviderFromAdapter } from '../plugins/visionProviderAdapter.js';

/**
 * @param {ReturnType<typeof import('../plugins/openAiVisionChat.js').createOpenAiCompatibleAdapter>} adapter
 * @param {{ userGoal: string, capture: { base64: string, mime: string }, signal?: AbortSignal }} ctx
 */
export async function runVisionScreenUnderstanding(adapter, ctx) {
  const vision = createVisionProviderFromAdapter(adapter);
  const text = await vision.describeScreen({
    system: promptManager.visionScreenUnderstanding(),
    userPrompt: `用户目标：${ctx.userGoal}\n请描述当前截图界面。`,
    imageBase64: ctx.capture.base64,
    mime: ctx.capture.mime,
    signal: ctx.signal,
  });
  return String(text || '').trim();
}
