import { describe, expect, it, vi } from 'vitest';
import { callLlmProvider, DEFAULT_TIMEOUT_MS, describeFetchError, type LlmProviderConfig, type LlmProviderOptions } from '../llm-provider.js';

const config: LlmProviderConfig = { provider: 'openai', apiKey: ' key ', model: ' model ', baseUrl: 'https://api.openai.com/v1' };

function transport(_required: Record<string, never>) {
  const signal = new AbortController().signal;
  const fetchFn = vi.fn<typeof fetch>(async () => new Response('{}'));
  const timeoutSignal = vi.fn<NonNullable<LlmProviderOptions['timeoutSignal']>>(() => signal);
  return { fetchFn, timeoutSignal, signal };
}

describe('llm-provider L088 characterization', () => {
  it.each([
    [{ apiKey: ' ', model: ' ' }, 'llm-provider: apiKey is required'],
    [{ apiKey: 'key', model: ' ' }, 'llm-provider: model is required'],
    [{ provider: 'azure' as const, baseUrl: '' }, 'llm-provider: baseUrl is required for the "azure" provider'],
  ] as const)('validates credentials/model before transport: %j', async (overrides, error) => {
    const f = transport({});
    await expect(callLlmProvider({ config: { ...config, ...overrides }, systemPrompt: '', userPrompt: '' }, f)).rejects.toThrow(error);
    expect(f.fetchFn).not.toHaveBeenCalled();
    expect(f.timeoutSignal).not.toHaveBeenCalled();
  });

  it.each(['anthropic', 'openai', 'google'] as const)('rejects a blank %s endpoint instead of selecting a public host', async (provider) => {
    const f = transport({});
    await expect(callLlmProvider({ config: { ...config, provider, baseUrl: ' /// ' }, systemPrompt: '', userPrompt: '' }, f))
      .rejects.toThrow(`baseUrl is required for the "${provider}" provider`);
    expect(f.fetchFn).not.toHaveBeenCalled();
    expect(f.timeoutSignal).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, -1, NaN, Infinity, 1.5])('keeps timeout fallback versus positive finite values: %s', async (timeoutMs) => {
    const f = transport({});
    await callLlmProvider({ config, systemPrompt: '', userPrompt: '' }, { ...f, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
    expect(f.timeoutSignal).toHaveBeenCalledWith({ timeoutMs: timeoutMs === 1.5 ? 1.5 : DEFAULT_TIMEOUT_MS });
  });

  it('normalizes a custom Azure endpoint, credentials, deployment and API version, retaining transport overrides', async () => {
    const f = transport({});
    const options: LlmProviderOptions = {
      ...f, apiVersion: ' custom ', timeoutMs: 12,
      extraHeaders: { 'api-key': 'wrong', 'x-extra': 'yes' },
      requestInit: { method: 'DELETE', body: 'wrong', headers: { wrong: 'yes' }, cache: 'no-store' },
    };
    await callLlmProvider({ config: { ...config, provider: 'azure', baseUrl: ' https://tenant.example/// ' }, systemPrompt: 'system', userPrompt: 'user' }, options);
    const [url, init] = f.fetchFn.mock.calls[0]!;
    expect(url).toBe('https://tenant.example/openai/deployments/model/chat/completions?api-version=custom');
    expect(init).toEqual({ method: 'POST', body: JSON.stringify({ response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'user' }] }), headers: { 'api-key': 'key', 'x-extra': 'yes', 'content-type': 'application/json' }, cache: 'no-store', signal: f.signal });
    expect(f.timeoutSignal).toHaveBeenCalledWith({ timeoutMs: 12 });
  });

  it('echoes unredacted provider error bodies (reported, not fixed)', async () => {
    const fetchFn: typeof fetch = async () => new Response('credential=secret-value', { status: 401 });
    await expect(callLlmProvider({ config, systemPrompt: '', userPrompt: '' }, { fetchFn })).rejects.toThrow('openai 401: credential=secret-value');
  });

  it.each([
    [null, 'fetch failed'], ['primitive', 'fetch failed'], [{}, 'fetch failed'],
    [{ code: 'RESET' }, 'fetch failed (RESET)'],
    [{ message: 'fetch failed' }, 'fetch failed'],
    [{ message: 'dns failed' }, 'fetch failed (dns failed)'],
    [{ code: 'RESET', message: 'read reset' }, 'fetch failed (RESET)'],
    [{ code: 'RESET', message: 'socket closed' }, 'fetch failed (RESET: socket closed)'],
    [{ code: 0, message: false, errors: [null, undefined, {}, { code: 0 }, { message: 'inner' }, { code: 'later' }] }, 'fetch failed (inner)'],
    [{ errors: [{ code: 'INNER', message: 'ignored' }] }, 'fetch failed (INNER)'],
    [{ code: 'OUTER', errors: [{ code: 'INNER' }] }, 'fetch failed (OUTER)'],
    [{ errors: [{}, null] }, 'fetch failed'], [{ errors: 'wrong shape' }, 'fetch failed'],
    [{ code: 17, message: 42 }, 'fetch failed (17: 42)'],
  ])('preserves cause formatting for %j', (cause, expected) => {
    expect(describeFetchError({ err: new Error('fetch failed', { cause }) })).toBe(expected);
  });

  it.each([['thrown text', 'thrown text'], [null, 'null'], [9, '9']])('stringifies a non-Error throw: %j', (err, expected) => {
    expect(describeFetchError({ err })).toBe(expected);
  });
});
