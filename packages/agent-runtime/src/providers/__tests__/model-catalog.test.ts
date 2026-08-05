import { afterEach, describe, expect, it, vi } from 'vitest';
import { listProviderModels, type ProviderModelsInput } from '../model-catalog.js';
import type { DnsLookupAddress } from '../connection-guard.js';

const noDns = async (): Promise<DnsLookupAddress[]> => [{ address: '8.8.8.8', family: 4 }];

const baseInput = (overrides: Partial<ProviderModelsInput>): ProviderModelsInput => ({
  protocol: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  dnsLookup: noDns,
  ...overrides,
});

describe('listProviderModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports azure as unsupported without making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await listProviderModels(baseInput({ protocol: 'azure' }));
    expect(result).toMatchObject({ ok: false, kind: 'unsupported_protocol' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid base url before making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await listProviderModels(baseInput({ baseUrl: 'not a url' }));
    expect(result).toMatchObject({ ok: false, kind: 'invalid_base_url' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports forbidden for an internal base url', async () => {
    const result = await listProviderModels(baseInput({ baseUrl: 'http://10.0.0.5/v1' }));
    expect(result).toMatchObject({ ok: false, kind: 'forbidden' });
  });

  it('returns the static bedrock seed without making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await listProviderModels(baseInput({ protocol: 'bedrock' }));
    expect(result.ok).toBe(true);
    expect(result.models?.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unsupported_protocol for a protocol providerModelsUrl cannot handle (ollama)', async () => {
    const result = await listProviderModels(baseInput({ protocol: 'ollama', baseUrl: 'https://ollama.example.com' }));
    expect(result).toMatchObject({ ok: false, kind: 'unsupported_protocol' });
  });

  // An empty key sent to the provider produces a generic, provider-specific
  // "no credential" error (e.g. Google's "Method doesn't allow unregistered
  // callers") that reads as a broken integration rather than a missing key.
  // These four protocols all put the key straight into the request the same
  // way Anthropic/OpenAI/Google do — the guard below has to reject before
  // any network access, not translate the provider's own response.
  for (const protocol of ['openai', 'senseaudio', 'anthropic', 'google'] as const) {
    it(`rejects an empty api key locally for ${protocol} before making any request`, async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await listProviderModels(baseInput({ protocol, apiKey: '' }));
      expect(result).toMatchObject({ ok: false, kind: 'auth_failed' });
      expect(result.detail).toMatch(/no api key/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it(`rejects a whitespace-only api key locally for ${protocol}`, async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await listProviderModels(baseInput({ protocol, apiKey: '   ' }));
      expect(result).toMatchObject({ ok: false, kind: 'auth_failed' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  // AIHubMix's catalogue is public — `providerModelsHeaders` already omits
  // auth for a blank key, so the guard must not block it (a real regression
  // here would be silently converting "public catalog, no key needed" into
  // "always fails without a key").
  it('does not require an api key for aihubmix, whose catalogue is public', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ models: [] }) }),
    );
    const result = await listProviderModels(
      baseInput({ protocol: 'aihubmix', apiKey: '', baseUrl: 'https://aihubmix.com' }),
    );
    expect(result.kind).not.toBe('auth_failed');
  });

  it('fetches and normalizes an OpenAI model list, sorted and de-duplicated, excluding non-chat ids', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [
              { id: 'gpt-4o' },
              { id: 'gpt-4o' },
              { id: 'text-embedding-3-small' },
              { id: 'whisper-1' },
              { id: 'gpt-3.5-turbo' },
            ],
          }),
      }),
    );
    const result = await listProviderModels(baseInput({}));
    expect(result.ok).toBe(true);
    expect(result.models).toEqual([
      { id: 'gpt-3.5-turbo', label: 'gpt-3.5-turbo' },
      { id: 'gpt-4o', label: 'gpt-4o' },
    ]);
  });

  it('falls back to the raw id as the label when a model entry has a blank label, and drops empty/duplicate ids', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: '  ' }, { id: 'gpt-4o' }] }),
      }),
    );
    const result = await listProviderModels(baseInput({}));
    expect(result.models).toEqual([{ id: 'gpt-4o', label: 'gpt-4o' }]);
  });

  it('excludes a wan* video model id (t2v/i2v/v2v suffix) but keeps a non-suffixed wan id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ data: [{ id: 'wan-2.1-t2v' }, { id: 'wan-2.1-chat' }] }),
      }),
    );
    const result = await listProviderModels(baseInput({}));
    expect(result.models).toEqual([{ id: 'wan-2.1-chat', label: 'wan-2.1-chat' }]);
  });

  it('excludes ids matching the trailing media-suffix regex (t2i/i2i/v2v/etc.) even without the named substrings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ data: [{ id: 'some-model-t2i' }] }) }),
    );
    const result = await listProviderModels(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'no_models' });
  });

  it('drops a whitespace-only or non-string model id from the OpenAI extractor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ data: [{ id: 42 }, { id: null }] }) }),
    );
    const result = await listProviderModels(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'no_models' });
  });

  it('sends bearer auth for openai/senseaudio', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ data: [{ id: 'x' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    await listProviderModels(baseInput({ protocol: 'senseaudio', baseUrl: 'https://senseaudio.example.com/v1' }));
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.authorization).toBe('Bearer sk-test');
  });

  it('fetches anthropic models with a limit query param and x-api-key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          data: [
            { id: 'claude-3-5-sonnet', display_name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3-haiku', displayName: 'Claude 3 Haiku (camel)' },
            { id: 'no-name-field' },
            { notAnId: true },
            'not-an-object',
            42,
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listProviderModels(baseInput({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' }));
    expect(result.ok).toBe(true);
    expect(result.models).toEqual([
      { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-haiku', label: 'Claude 3 Haiku (camel)' },
      { id: 'no-name-field', label: 'no-name-field' },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('limit=1000');
    expect(init.headers['x-api-key']).toBe('sk-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('returns no_models when the anthropic response has no data array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({}) }));
    const result = await listProviderModels(baseInput({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' }));
    expect(result).toMatchObject({ ok: false, kind: 'no_models' });
  });

  it('falls back to the id as the label when display_name is present but whitespace-only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ data: [{ id: 'claude-3-5-sonnet', display_name: '   ' }] }),
      }),
    );
    const result = await listProviderModels(baseInput({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' }));
    expect(result.models).toEqual([{ id: 'claude-3-5-sonnet', label: 'claude-3-5-sonnet' }]);
  });

  it('fetches google models, filtering unsupported generation methods and preferring baseModelId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          models: [
            { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-embedding', baseModelId: 'gemini-embedding', supported_actions: ['embedContent'] },
            { baseModelId: 'gemini-pro', supported_actions: ['generateContent'] },
            { name: 123, supportedGenerationMethods: ['generateContent'] },
            'not-an-object',
            42,
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listProviderModels(baseInput({ protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'gkey' }));
    expect(result.ok).toBe(true);
    expect(result.models).toEqual([
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-pro', label: 'gemini-pro' },
    ]);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('key=gkey');
  });

  it('returns no_models when the google response has no models array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({}) }));
    const result = await listProviderModels(baseInput({ protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com' }));
    expect(result).toMatchObject({ ok: false, kind: 'no_models' });
  });

  it('fetches the aihubmix catalogue via its dedicated endpoint, chat-only filtered, with no auth header when apiKey is blank', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          data: [
            { model_id: 'gpt-4o', model_name: 'GPT-4o', types: 'llm' },
            { model_id: 'gpt-image-2', model_name: 'skip', types: 'image_generation,llm' },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listProviderModels(baseInput({ protocol: 'aihubmix', baseUrl: 'https://aihubmix.com/v1', apiKey: '' }));
    expect(result.models).toEqual([{ id: 'gpt-4o', label: 'GPT-4o' }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://aihubmix.com/api/v1/models?type=llm');
    expect(init.headers).toEqual({});
  });

  it('sends aihubmix headers with attribution when apiKey is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ data: [{ model_id: 'a', model_name: 'A' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    await listProviderModels(baseInput({ protocol: 'aihubmix', baseUrl: 'https://aihubmix.com/v1', apiKey: 'k' }));
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.authorization).toBe('Bearer k');
    expect(init.headers['APP-Code']).toBeDefined();
  });

  it('returns no_models when the extracted list is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ data: [] }) }));
    const result = await listProviderModels(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'no_models' });
  });

  it('maps HTTP failure statuses to the right kind and redacts the api key from the detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'bad key sk-test' } }),
      }),
    );
    const result = await listProviderModels(baseInput({}));
    expect(result.kind).toBe('auth_failed');
    expect(result.detail).not.toContain('sk-test');
  });

  it('maps 403/404/429/5xx/other statuses', async () => {
    const statuses: Array<[number, string]> = [
      [403, 'forbidden'],
      [404, 'invalid_base_url'],
      [429, 'rate_limited'],
      [500, 'upstream_unavailable'],
      [418, 'unknown'],
    ];
    for (const [status, kind] of statuses) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, text: async () => 'oops' }));
      const result = await listProviderModels(baseInput({}));
      expect(result.kind).toBe(kind);
    }
  });

  it('falls back to raw text when the error body is unparseable JSON on a failure response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'not json {{' }));
    const result = await listProviderModels(baseInput({}));
    expect(result.detail).toBe('not json {{');
  });

  it('extracts a string error, an object error.message, and a top-level message field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify({ error: 'plain string error' }) }));
    let result = await listProviderModels(baseInput({}));
    expect(result.detail).toBe('plain string error');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify({ message: 'top level message' }) }));
    result = await listProviderModels(baseInput({}));
    expect(result.detail).toBe('top level message');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify({}) }));
    result = await listProviderModels(baseInput({}));
    expect(result.detail).toBe('{}');
  });

  it('extracts a nested error.message object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'nested message' } }) }),
    );
    const result = await listProviderModels(baseInput({}));
    expect(result.detail).toBe('nested message');
  });

  it('falls through a nested error object with no usable message to the top-level message, then to raw text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify({ error: { code: 'x' } }) }),
    );
    let result = await listProviderModels(baseInput({}));
    expect(result.detail).toBe('{"error":{"code":"x"}}');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: '   ' } }) }),
    );
    result = await listProviderModels(baseInput({}));
    expect(result.detail).toBe(JSON.stringify({ error: { message: '   ' } }));
  });

  it('falls back to raw text when data itself is not an object (e.g. a bare JSON string)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify('hello') }));
    const result = await listProviderModels(baseInput({}));
    expect(result.detail).toBe('"hello"');
  });

  it('falls back from an unparseable-but-whitespace-only body to the parse error text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '   ' }));
    const result = await listProviderModels(baseInput({}));
    expect(result.detail).toBeTruthy();
  });

  it('reports unknown with a redacted parse error when the success body is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'not json {{' }));
    const result = await listProviderModels(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'unknown' });
  });

  it('treats an empty response body as {}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));
    const result = await listProviderModels(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'no_models' });
  });

  it('classifies a network AbortError as timeout', async () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const result = await listProviderModels(baseInput({}));
    expect(result.kind).toBe('timeout');
  });

  it('classifies a DNS/connect-failure cause code as invalid_base_url', async () => {
    const err = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const result = await listProviderModels(baseInput({}));
    expect(result.kind).toBe('invalid_base_url');
  });

  it('classifies every documented connect-failure cause code as invalid_base_url', async () => {
    const codes = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'];
    for (const code of codes) {
      const err = Object.assign(new Error('fetch failed'), { cause: { code } });
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
      const result = await listProviderModels(baseInput({}));
      expect(result.kind).toBe('invalid_base_url');
    }
  });

  it('classifies an unrecognized error as unknown, including a non-Error throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('mystery failure')));
    let result = await listProviderModels(baseInput({}));
    expect(result.kind).toBe('unknown');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('a string throw'));
    result = await listProviderModels(baseInput({}));
    expect(result.kind).toBe('unknown');
    expect(result.detail).toContain('a string throw');
  });

  it('classifies an Error with a cause but no code as unknown', async () => {
    const err = Object.assign(new Error('fetch failed'), { cause: {} });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const result = await listProviderModels(baseInput({}));
    expect(result.kind).toBe('unknown');
  });

  it('aborts the request when the caller signal fires mid-flight (after the internal listener attaches)', async () => {
    let capturedSignal: AbortSignal | undefined;
    let fetchCalled = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedSignal = init.signal as AbortSignal;
        fetchCalled = true;
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        });
      }),
    );
    const controller = new AbortController();
    const pending = listProviderModels(baseInput({ signal: controller.signal }));
    // Wait until fetch() has actually been invoked — i.e. until
    // listProviderModels has reached its `input.signal.addEventListener(...)`
    // line — before aborting, so this exercises that listener path (not the
    // already-aborted-at-call-time branch covered by the test above).
    for (let i = 0; i < 100 && !fetchCalled; i += 1) {
      await Promise.resolve();
    }
    expect(fetchCalled).toBe(true);
    controller.abort();
    const result = await pending;
    expect(result.kind).toBe('timeout');
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('propagates an already-aborted signal at call time', async () => {
    const already = new AbortController();
    already.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        if (init.signal?.aborted) {
          return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }
        return Promise.reject(new Error('signal was not already aborted'));
      }),
    );
    const result = await listProviderModels(baseInput({ signal: already.signal }));
    expect(result.kind).toBe('timeout');
  });

  it('propagates a thrown error from providerModelsUrl as unsupported_protocol', async () => {
    const result = await listProviderModels(baseInput({ protocol: 'not-a-real-protocol' as never }));
    expect(result).toMatchObject({ ok: false, kind: 'unsupported_protocol' });
  });

  it('passes through a custom requestInit (e.g. a proxy dispatcher)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ data: [{ id: 'a' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const dispatcher = {} as never;
    await listProviderModels(baseInput({ requestInit: { dispatcher } }));
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.dispatcher).toBe(dispatcher);
  });

  it('uses the default DNS lookup when none is supplied', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ data: [{ id: 'a' }] }) }));
    const input: ProviderModelsInput = { protocol: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'k' };
    const result = await listProviderModels(input);
    expect(result.ok).toBe(true);
  });
});
