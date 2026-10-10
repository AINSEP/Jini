import { expect, it } from 'vitest';
import { callLlmProvider } from '../llm-provider.js';
import { VENDOR_API_BASE_URLS } from '@jini-ai/integrations/media-providers/catalog';

// hwb #13: endpoint consolidation preserves the actual OpenAI wire URL (no duplicate /v1).
it('uses the shared endpoint default while retaining the host transport and endpoint overrides', async () => {
  const calls: string[] = [];
  const fetchFn: typeof fetch = async url => { calls.push(String(url)); return new Response(JSON.stringify({ choices: [{ message: { content: 'answer' } }] })); };
  const input = { config: { provider: 'openai' as const, apiKey: 'fixture-key', model: 'model' }, systemPrompt: 'system', userPrompt: 'question' };
  expect(await callLlmProvider(input, { fetchFn })).toBe('answer');
  expect(await callLlmProvider(input, { fetchFn, baseUrl: 'https://host.example/v1' })).toBe('answer');
  expect(calls).toEqual([`${VENDOR_API_BASE_URLS.openai}/chat/completions`, 'https://host.example/v1/chat/completions']);
});
