import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { callLlmProvider, DEFAULT_TIMEOUT_MS, type LlmProviderId } from '../llm-provider.js';

// Host composition owns the catalog. Importing memory must never resolve it.
vi.mock('@jini-ai/integrations/media-providers/catalog', () => {
  throw new Error('memory must not import integrations');
});

const messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'question' }];
const cases = [
  {
    provider: 'anthropic', baseUrl: 'https://api.anthropic.com',
    url: 'https://api.anthropic.com/v1/messages', proxyBaseUrl: 'https://host.example/gateway/v1',
    proxyUrl: 'https://host.example/gateway/v1/messages',
    headers: { 'content-type': 'application/json', 'x-api-key': 'fixture-key', 'anthropic-version': '2023-06-01' },
    body: { model: 'model', max_tokens: 1024, system: 'system', messages: [{ role: 'user', content: 'question' }] },
    response: { content: [{ type: 'text', text: 'answer' }] },
  },
  {
    provider: 'openai', baseUrl: 'https://api.openai.com/v1',
    url: 'https://api.openai.com/v1/chat/completions', proxyBaseUrl: 'https://host.example/gateway/v1',
    proxyUrl: 'https://host.example/gateway/v1/chat/completions',
    headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-key' },
    body: { model: 'model', response_format: { type: 'json_object' }, messages },
    response: { choices: [{ message: { content: 'answer' } }] },
  },
  {
    provider: 'azure', baseUrl: 'https://tenant.openai.azure.com',
    url: 'https://tenant.openai.azure.com/openai/deployments/model/chat/completions?api-version=2024-10-21',
    proxyBaseUrl: 'https://host.example/gateway',
    proxyUrl: 'https://host.example/gateway/openai/deployments/model/chat/completions?api-version=2024-10-21',
    headers: { 'content-type': 'application/json', 'api-key': 'fixture-key' },
    body: { response_format: { type: 'json_object' }, messages },
    response: { choices: [{ message: { content: 'answer' } }] },
  },
  {
    provider: 'google', baseUrl: 'https://generativelanguage.googleapis.com',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/model:generateContent?key=fixture-key',
    proxyBaseUrl: 'https://host.example/gateway',
    proxyUrl: 'https://host.example/gateway/v1beta/models/model:generateContent?key=fixture-key',
    headers: { 'content-type': 'application/json' },
    body: {
      systemInstruction: { role: 'system', parts: [{ text: 'system' }] },
      contents: [{ role: 'user', parts: [{ text: 'question' }] }],
      generationConfig: { responseMimeType: 'application/json' },
    },
    response: { candidates: [{ content: { parts: [{ text: 'answer' }] } }] },
  },
] satisfies { provider: LlmProviderId; baseUrl: string; url: string; proxyBaseUrl: string; proxyUrl: string; headers: Record<string, string>; body: unknown; response: unknown }[];

describe('host-owned LLM endpoints', () => {
  it.each(cases)('preserves $provider wire requests for explicit, legacy-option and gateway endpoints', async fixture => {
    const signal = new AbortController().signal;
    const timeoutSignal = vi.fn(() => signal);
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(fixture.response)));
    const config = { provider: fixture.provider, apiKey: 'fixture-key', model: 'model', baseUrl: fixture.baseUrl };
    const prompts = { systemPrompt: 'system', userPrompt: 'question' };
    expect(await callLlmProvider({ config, ...prompts }, { fetchFn, timeoutSignal })).toBe('answer');
    const { baseUrl, ...legacyConfig } = config;
    expect(await callLlmProvider({ config: legacyConfig, ...prompts }, { fetchFn, timeoutSignal, baseUrl })).toBe('answer');
    expect(await callLlmProvider({ config: { ...config, baseUrl: fixture.proxyBaseUrl }, ...prompts }, { fetchFn, timeoutSignal })).toBe('answer');
    expect(fetchFn.mock.calls).toEqual([fixture.url, fixture.url, fixture.proxyUrl].map(url => [url, {
      method: 'POST', headers: fixture.headers, body: JSON.stringify(fixture.body), signal,
    }]));
    expect(timeoutSignal.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ timeoutMs: DEFAULT_TIMEOUT_MS }]));
  });

  it('loads the public memory entry without importing integrations or declaring it as a dependency', async () => {
    const memory = await import('../index.js');
    expect(memory.callLlmProvider).toBe(callLlmProvider);
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
      expect(manifest[section] ?? {}).not.toHaveProperty('@jini-ai/integrations');
    }
  });
});
