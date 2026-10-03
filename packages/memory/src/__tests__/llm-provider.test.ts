import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AZURE_DEFAULT_API_VERSION,
  DEFAULT_TIMEOUT_MS,
  appendVersionedApiPath,
  callLlmProvider,
  callLlmProviderForJson,
  describeFetchError,
  parseStrictJson,
  type LlmProviderConfig,
  type LlmProviderOptions,
} from '../llm-provider.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function anthropicConfig(overrides: Partial<LlmProviderConfig> & LlmProviderOptions = {}): { config: LlmProviderConfig; options: LlmProviderOptions } {
  const { provider, apiKey, model, ...options } = { provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-test', ...overrides };
  return { config: { provider: provider as LlmProviderConfig['provider'], apiKey, model }, options };
}
function openaiConfig(overrides: Partial<LlmProviderConfig> & LlmProviderOptions = {}): { config: LlmProviderConfig; options: LlmProviderOptions } {
  const { provider, apiKey, model, ...options } = { provider: 'openai', apiKey: 'sk-openai-test', model: 'gpt-test', ...overrides };
  return { config: { provider: provider as LlmProviderConfig['provider'], apiKey, model }, options };
}
function azureConfig(overrides: Partial<LlmProviderConfig> & LlmProviderOptions = {}): { config: LlmProviderConfig; options: LlmProviderOptions } {
  const { provider, apiKey, model, ...options } = { provider: 'azure', apiKey: 'azure-key', model: 'my-deployment', baseUrl: 'https://my-resource.openai.azure.com', ...overrides };
  return { config: { provider: provider as LlmProviderConfig['provider'], apiKey, model }, options };
}
function googleConfig(overrides: Partial<LlmProviderConfig> & LlmProviderOptions = {}): { config: LlmProviderConfig; options: LlmProviderOptions } {
  const { provider, apiKey, model, ...options } = { provider: 'google', apiKey: 'google-key', model: 'gemini-test', ...overrides };
  return { config: { provider: provider as LlmProviderConfig['provider'], apiKey, model }, options };
}

describe('appendVersionedApiPath', () => {
  it('appends /v1<suffix> when the base URL has no version segment', () => {
    expect(appendVersionedApiPath({ baseUrl: 'https://api.anthropic.com', suffix: '/messages' })).toBe('https://api.anthropic.com/v1/messages');
  });

  it('strips a trailing slash on the base URL before appending', () => {
    expect(appendVersionedApiPath({ baseUrl: 'https://api.anthropic.com/', suffix: '/messages' })).toBe('https://api.anthropic.com/v1/messages');
  });

  it('appends the suffix directly when the path already ends in a /vN segment', () => {
    expect(appendVersionedApiPath({ baseUrl: 'https://proxy.example.com/v1', suffix: '/messages' })).toBe('https://proxy.example.com/v1/messages');
  });

  it('appends the suffix directly when the path contains a /vN segment mid-path', () => {
    expect(appendVersionedApiPath({ baseUrl: 'https://proxy.example.com/v2/upstream', suffix: '/chat/completions' })).toBe(
      'https://proxy.example.com/v2/upstream/chat/completions',
    );
  });
});

describe('describeFetchError', () => {
  it('returns the message unchanged for a plain Error with no cause', () => {
    expect(describeFetchError({ err: new Error('boom') })).toBe('boom');
  });

  it('stringifies a non-Error thrown value', () => {
    expect(describeFetchError({ err: 'just a string throw' })).toBe('just a string throw');
  });

  it('returns the message unchanged when cause is null', () => {
    expect(describeFetchError({ err: new Error('boom', { cause: null }) })).toBe('boom');
  });

  it('returns the message unchanged when cause is a non-object primitive', () => {
    expect(describeFetchError({ err: new Error('boom', { cause: 'not-an-object' }) })).toBe('boom');
  });

  it('returns the message unchanged when cause has neither code, message, nor errors', () => {
    expect(describeFetchError({ err: new Error('boom', { cause: {} }) })).toBe('boom');
  });

  it('appends the code alone when cause has only a code', () => {
    expect(describeFetchError({ err: new Error('fetch failed', { cause: { code: 'ECONNRESET' } }) })).toBe('fetch failed (ECONNRESET)');
  });

  it('appends the message alone when cause has only a message different from the head', () => {
    expect(describeFetchError({ err: new Error('fetch failed', { cause: { message: 'DNS lookup failed' } }) })).toBe('fetch failed (DNS lookup failed)');
  });

  it('returns the message unchanged when cause.message duplicates the head message', () => {
    expect(describeFetchError({ err: new Error('fetch failed', { cause: { message: 'fetch failed' } }) })).toBe('fetch failed');
  });

  it('collapses to just the code when the cause message already contains it', () => {
    expect(describeFetchError({ err: new Error('fetch failed', { cause: { code: 'ECONNRESET', message: 'read ECONNRESET' } }) })).toBe(
      'fetch failed (ECONNRESET)',
    );
  });

  it('shows "code: message" when the cause message does not contain the code', () => {
    expect(
      describeFetchError({ err: new Error('fetch failed', {
          cause: { code: 'CERT_MISMATCH', message: "Hostname/IP does not match certificate's altnames" },
        }) }),
    ).toBe("fetch failed (CERT_MISMATCH: Hostname/IP does not match certificate's altnames)");
  });

  it('falls back to the first AggregateError-style inner entry that yields a code, skipping ones that yield nothing', () => {
    expect(describeFetchError({ err: new Error('fetch failed', { cause: { errors: [{}, { code: 'ENOTFOUND' }] } }) })).toBe('fetch failed (ENOTFOUND)');
  });

  it('falls back to an inner entry message when no inner entry has a code', () => {
    expect(describeFetchError({ err: new Error('fetch failed', { cause: { errors: [{ message: 'inner failure' }] } }) })).toBe(
      'fetch failed (inner failure)',
    );
  });

  it('returns the message unchanged when every inner errors entry yields neither code nor message', () => {
    expect(describeFetchError({ err: new Error('fetch failed', { cause: { errors: [{}, {}] } }) })).toBe('fetch failed');
  });

  it('returns the message unchanged when cause.errors is present but not an array', () => {
    expect(describeFetchError({ err: new Error('fetch failed', { cause: { errors: 'not-an-array' } }) })).toBe('fetch failed');
  });
});

describe('parseStrictJson', () => {
  it('parses a plain JSON object with no fence', () => {
    expect(parseStrictJson({ rawText: '{"a":1}' })).toEqual({ a: 1 });
  });

  it('parses a non-object JSON value (array) directly', () => {
    expect(parseStrictJson({ rawText: '[1,2,3]' })).toEqual([1, 2, 3]);
  });

  it('strips a ```json fence before parsing', () => {
    expect(parseStrictJson({ rawText: '```json\n{"a":1}\n```' })).toEqual({ a: 1 });
  });

  it('strips a plain ``` fence (no language tag) before parsing', () => {
    expect(parseStrictJson({ rawText: '```\n{"a":1}\n```' })).toEqual({ a: 1 });
  });

  it('falls back to extracting the first {...} block when direct parse fails', () => {
    expect(parseStrictJson({ rawText: 'Sure, here you go: {"a":1} — hope that helps!' })).toEqual({ a: 1 });
  });

  it('throws when a {...} block is found but is not itself valid JSON', () => {
    expect(() => parseStrictJson({ rawText: 'noise {not: valid json here} trailing' })).toThrow(/response was not valid JSON/);
  });

  it('throws when no {...} block exists at all', () => {
    expect(() => parseStrictJson({ rawText: 'just plain text, no json here' })).toThrow(/response was not valid JSON/);
  });

  it('truncates a long invalid preview in the thrown error message', () => {
    const long = `x${'y'.repeat(250)}`;
    expect(() => parseStrictJson({ rawText: long })).toThrow('…');
  });

  it('does not truncate a short invalid preview', () => {
    let caught: Error | null = null;
    try {
      parseStrictJson({ rawText: 'short invalid' });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toContain('short invalid');
    expect(caught?.message).not.toContain('…');
  });
});

describe('callLlmProvider — config validation', () => {
  it('throws when apiKey is empty (including whitespace-only)', async () => {
    await expect(callLlmProvider({ config: anthropicConfig({ apiKey: '   ' }).config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig({ apiKey: '   ' }).options)).rejects.toThrow(/apiKey is required/);
  });

  it('throws when model is empty', async () => {
    await expect(callLlmProvider({ config: anthropicConfig({ model: '' }).config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig({ model: '' }).options)).rejects.toThrow(/model is required/);
  });

  it('throws when the azure provider has no baseUrl', async () => {
    await expect(callLlmProvider({ config: { provider: 'azure', apiKey: 'k', model: 'deployment' }, systemPrompt: 's', userPrompt: 'u' }, {})).rejects.toThrow(
      /baseUrl is required for the "azure" provider/,
    );
  });

  it('throws a clear error for an unrecognized provider id (defensive runtime guard for non-TS callers)', async () => {
    const config = { provider: 'mistral', apiKey: 'k', model: 'm', baseUrl: 'https://example.com' } as unknown as LlmProviderConfig;
    await expect(callLlmProvider({ config, systemPrompt: 's', userPrompt: 'u' }, {})).rejects.toThrow(/unsupported provider "mistral"/);
  });
});

describe('callLlmProvider — anthropic', () => {
  it('posts to the default host with the correct headers and body, and extracts the text block', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-ant-test');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['content-type']).toBe('application/json');
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        model: 'claude-test',
        max_tokens: 1024,
        system: 'sys prompt',
        messages: [{ role: 'user', content: 'user prompt' }],
      });
      return jsonResponse({ content: [{ type: 'text', text: 'hello from claude' }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callLlmProvider({ config: anthropicConfig().config, systemPrompt: 'sys prompt', userPrompt: 'user prompt' }, anthropicConfig().options);
    expect(result).toBe('hello from claude');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty string when no content block has type "text"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ content: [{ type: 'image', text: 'ignored' }] })));
    expect(await callLlmProvider({ config: anthropicConfig().config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig().options)).toBe('');
  });

  it('returns an empty string when the response has no content field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
    expect(await callLlmProvider({ config: anthropicConfig().config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig().options)).toBe('');
  });

  it('treats an empty 200 response body as an empty object rather than crashing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    expect(await callLlmProvider({ config: anthropicConfig().config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig().options)).toBe('');
  });

  it('throws a clear error on a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid api key', { status: 401 })));
    await expect(callLlmProvider({ config: anthropicConfig().config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig().options)).rejects.toThrow('anthropic 401: invalid api key');
  });

  it('throws a clear error on a non-JSON response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>not json</html>', { status: 200 })));
    await expect(callLlmProvider({ config: anthropicConfig().config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig().options)).rejects.toThrow(/anthropic non-JSON response/);
  });

  it('wraps a network-level fetch failure via describeFetchError', async () => {
    const networkError = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));
    await expect(callLlmProvider({ config: anthropicConfig().config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig().options)).rejects.toThrow('fetch failed (ECONNRESET)');
  });

  it('merges extraHeaders under the required headers, without letting them override auth', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers['x-attribution']).toBe('my-gateway');
      expect(headers['x-api-key']).toBe('sk-real');
      return jsonResponse({ content: [{ type: 'text', text: 'ok' }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    await callLlmProvider({ config: anthropicConfig({ apiKey: 'sk-real', extraHeaders: { 'x-attribution': 'my-gateway', 'x-api-key': 'sk-fake' } }).config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig({ apiKey: 'sk-real', extraHeaders: { 'x-attribution': 'my-gateway', 'x-api-key': 'sk-fake' } }).options);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('merges a caller requestInit under this module\'s own method/headers/body/signal (explicit fields always win)', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe('POST');
      expect((init as RequestInit & { cache?: string }).cache).toBe('no-store');
      return jsonResponse({ content: [{ type: 'text', text: 'ok' }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    await callLlmProvider({ config: anthropicConfig({ requestInit: { method: 'GET', cache: 'no-store' } }).config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig({ requestInit: { method: 'GET', cache: 'no-store' } }).options);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses DEFAULT_TIMEOUT_MS when timeoutMs is omitted', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ content: [{ type: 'text', text: 'ok' }] })));
    await callLlmProvider({ config: anthropicConfig().config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig().options);
    expect(timeoutSpy).toHaveBeenCalledWith(DEFAULT_TIMEOUT_MS);
  });

  it('uses a valid custom timeoutMs when supplied', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ content: [{ type: 'text', text: 'ok' }] })));
    await callLlmProvider({ config: anthropicConfig({ timeoutMs: 5_000 }).config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig({ timeoutMs: 5_000 }).options);
    expect(timeoutSpy).toHaveBeenCalledWith(5_000);
  });

  it('falls back to the default timeout for a non-finite timeoutMs', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ content: [{ type: 'text', text: 'ok' }] })));
    await callLlmProvider({ config: anthropicConfig({ timeoutMs: Number.NaN }).config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig({ timeoutMs: Number.NaN }).options);
    expect(timeoutSpy).toHaveBeenCalledWith(DEFAULT_TIMEOUT_MS);
  });

  it('falls back to the default timeout for a non-positive timeoutMs', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ content: [{ type: 'text', text: 'ok' }] })));
    await callLlmProvider({ config: anthropicConfig({ timeoutMs: -5 }).config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig({ timeoutMs: -5 }).options);
    expect(timeoutSpy).toHaveBeenCalledWith(DEFAULT_TIMEOUT_MS);
  });

  it('accepts a custom baseUrl with an existing /v1 segment without doubling it', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://proxy.example.com/v1/messages');
      return jsonResponse({ content: [{ type: 'text', text: 'ok' }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    await callLlmProvider({ config: anthropicConfig({ baseUrl: 'https://proxy.example.com/v1' }).config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig({ baseUrl: 'https://proxy.example.com/v1' }).options);
  });
});

describe('callLlmProvider — openai', () => {
  it('posts to the default host and extracts choices[0].message.content', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer sk-openai-test');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('gpt-test');
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages).toEqual([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ]);
      return jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callLlmProvider({ config: openaiConfig().config, systemPrompt: 'sys', userPrompt: 'usr' }, openaiConfig().options);
    expect(result).toBe('{"ok":true}');
  });

  it('returns an empty string when the response has no choices', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
    expect(await callLlmProvider({ config: openaiConfig().config, systemPrompt: 's', userPrompt: 'u' }, openaiConfig().options)).toBe('');
  });

  it('returns an empty string when choices[0].message has no content field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ choices: [{ message: {} }] })));
    expect(await callLlmProvider({ config: openaiConfig().config, systemPrompt: 's', userPrompt: 'u' }, openaiConfig().options)).toBe('');
  });
});

describe('callLlmProvider — azure', () => {
  it('builds the deployment URL with the default api-version and omits model from the body', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`https://my-resource.openai.azure.com/openai/deployments/my-deployment/chat/completions?api-version=${AZURE_DEFAULT_API_VERSION}`);
      const headers = init.headers as Record<string, string>;
      expect(headers['api-key']).toBe('azure-key');
      const body = JSON.parse(init.body as string);
      expect(body).not.toHaveProperty('model');
      expect(body.response_format).toEqual({ type: 'json_object' });
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callLlmProvider({ config: azureConfig().config, systemPrompt: 'sys', userPrompt: 'usr' }, azureConfig().options);
    expect(result).toBe('ok');
  });

  it('uses a caller-supplied apiVersion instead of the default', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('api-version=2024-01-01');
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    await callLlmProvider({ config: azureConfig({ apiVersion: '2024-01-01' }).config, systemPrompt: 's', userPrompt: 'u' }, azureConfig({ apiVersion: '2024-01-01' }).options);
  });
});

describe('callLlmProvider — google', () => {
  it('posts to the default host with the key as a query param and joins response parts', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent?key=google-key');
      const body = JSON.parse(init.body as string);
      expect(body.systemInstruction).toEqual({ role: 'system', parts: [{ text: 'sys' }] });
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'usr' }] }]);
      expect(body.generationConfig).toEqual({ responseMimeType: 'application/json' });
      return jsonResponse({ candidates: [{ content: { parts: [{ text: 'Hello, ' }, { text: 'world.' }] } }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callLlmProvider({ config: googleConfig().config, systemPrompt: 'sys', userPrompt: 'usr' }, googleConfig().options);
    expect(result).toBe('Hello, world.');
  });

  it('returns an empty string when the response has no candidates field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
    expect(await callLlmProvider({ config: googleConfig().config, systemPrompt: 's', userPrompt: 'u' }, googleConfig().options)).toBe('');
  });

  it('returns an empty string when the candidates array is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ candidates: [] })));
    expect(await callLlmProvider({ config: googleConfig().config, systemPrompt: 's', userPrompt: 'u' }, googleConfig().options)).toBe('');
  });

  it('returns an empty string when content.parts is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ candidates: [{ content: {} }] })));
    expect(await callLlmProvider({ config: googleConfig().config, systemPrompt: 's', userPrompt: 'u' }, googleConfig().options)).toBe('');
  });
});

describe('callLlmProviderForJson', () => {
  it('parses the raw model text as JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ content: [{ type: 'text', text: '{"ok":true}' }] })));
    const result = await callLlmProviderForJson<{ ok: boolean }>({ config: anthropicConfig().config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig().options);
    expect(result).toEqual({ ok: true });
  });

  it('propagates a parseStrictJson failure when the model output is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ content: [{ type: 'text', text: 'not json at all' }] })));
    await expect(callLlmProviderForJson({ config: anthropicConfig().config, systemPrompt: 's', userPrompt: 'u' }, anthropicConfig().options)).rejects.toThrow(/response was not valid JSON/);
  });
});

it('uses the supplied HTTP and deadline ports with optional endpoint settings', async () => {
  const controller = new AbortController();
  const timeoutSignal = vi.fn(() => controller.signal);
  const fetchFn = vi.fn(async () => jsonResponse({ content: [{ type: 'text', text: '{"ok":true}' }] }));
  const result = await callLlmProviderForJson<{ ok: boolean }>(
    { config: { provider: 'anthropic', apiKey: 'key', model: 'model' }, systemPrompt: 'system', userPrompt: 'user' },
    { baseUrl: 'https://gateway.example/v1', fetchFn, timeoutSignal, timeoutMs: 123 },
  );
  expect(result).toEqual({ ok: true });
  expect(timeoutSignal).toHaveBeenCalledWith({ timeoutMs: 123 });
  expect(fetchFn.mock.calls[0]).toEqual(['https://gateway.example/v1/messages', expect.objectContaining({
    method: 'POST', signal: controller.signal,
    headers: expect.objectContaining({ 'x-api-key': 'key' }),
  })]);
});
