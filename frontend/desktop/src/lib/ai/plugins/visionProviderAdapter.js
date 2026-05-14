/**
 * Vision Provider：与 OpenAI 兼容多模态共用同一适配器（可替换为独立 Gemini Vision 等）。
 * @param {{ complete: (req: { system: string, userText: string, imageBase64?: string | null, mime?: string, signal?: AbortSignal }) => Promise<string>, kind?: string }} adapter
 */
export function createVisionProviderFromAdapter(adapter) {
  return {
    kind: adapter.kind,
    /**
     * @param {{ system: string, userPrompt: string, imageBase64: string, mime: string, signal?: AbortSignal }} args
     */
    async describeScreen(args) {
      return adapter.complete({
        system: args.system,
        userText: args.userPrompt,
        imageBase64: args.imageBase64,
        mime: args.mime || 'image/jpeg',
        signal: args.signal,
      });
    },
  };
}
