import { afterEach, describe, expect, it, vi } from 'vitest';
import { testProviderConnection, type ProviderConnectionTestInput } from '../connection-test.js';
import type { DnsLookupAddress } from '../connection-guard.js';

const noDns = async (): Promise<DnsLookupAddress[]> => [{ address: '8.8.8.8', family: 4 }];

const baseInput = (overrides: Partial<ProviderConnectionTestInput>): ProviderConnectionTestInput => ({
  protocol: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'sk-ant-test',
  model: 'claude-sonnet-4-5',
  dnsLookup: noDns,
  ...overrides,
});

describe('testProviderConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports an unsupported protocol without making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({ protocol: 'ollama' }));
    expect(result).toMatchObject({ ok: false, kind: 'unknown' });
    expect(result.detail).toMatch(/not supported/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid base url before making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({ baseUrl: 'not a url' }));
    expect(result).toMatchObject({ ok: false, kind: 'invalid_base_url' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Every supported protocol puts the key straight into the outbound
  // request, so an empty key must fail locally with a clear message rather
  // than reach the provider and come back as a generic "no credential"
  // error (e.g. Google's "Method doesn't allow unregistered callers").
  for (const protocol of ['anthropic', 'openai', 'azure', 'google'] as const) {
    it(`rejects an empty api key locally for ${protocol} before making any request`, async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({ protocol, apiKey: '' }));
      expect(result).toMatchObject({ ok: false, kind: 'auth_failed' });
      expect(result.detail).toMatch(/no api key/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it('rejects a whitespace-only api key locally, checked before the base-url guard', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({ apiKey: '   ', baseUrl: 'not a url' }));
    expect(result).toMatchObject({ ok: false, kind: 'auth_failed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports forbidden for an internal base url without making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({ baseUrl: 'http://10.0.0.5' }));
    expect(result).toMatchObject({ ok: false, kind: 'forbidden' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds when the Anthropic response contains the exact smoke-test reply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }),
      }),
    );
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({}));
    expect(result).toMatchObject({ ok: true, kind: 'success', status: 200 });
  });

  it('sends the Anthropic request shape (x-api-key header, /v1/messages path, model + smoke prompt body)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({}));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01' });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'Reply with only: ok' }] });
  });

  it('treats a non-"ok" assistant reply as a failed smoke test even on a 2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ content: [{ type: 'text', text: 'Hello there!' }] }),
      }),
    );
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({}));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/Hello there!/);
  });

  it('redacts the api key from the detail on a 2xx-but-wrong-smoke-reply too, not just on error statuses', async () => {
    // The gap two independent audits reproduced. The `!response.ok` branch
    // redacted; this one did not — so an endpoint that echoes the request's own
    // Authorization header back in a 200 completion put the operator's key
    // verbatim into `detail`, which the admin UI renders.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ content: [{ type: 'text', text: 'your key was: sk-ant-test' }] }),
      }),
    );
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({}));
    expect(result.ok).toBe(false);
    expect(result.detail).not.toContain('sk-ant-test');
    expect(result.detail).toContain('[REDACTED:exact_secret]');
  });

  it('redacts BEFORE truncating, so a key past the sample cutoff cannot leak as a prefix', async () => {
    // Found by an audit of the first version of this fix, which redacted the
    // ALREADY-truncated sample. Truncation cutting through the key left a
    // fragment that no longer matched the exact-secret redactor, so a prefix of
    // the key survived into the detail.
    const filler = 'x'.repeat(110);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ content: [{ type: 'text', text: `${filler} sk-ant-test` }] }),
      }),
    );
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({}));
    expect(result.detail).not.toMatch(/sk-ant/);
  });

  it('classifies a 401 as auth_failed and redacts the api key from the detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'invalid x-api-key: sk-ant-test' } }),
      }),
    );
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'auth_failed', status: 401 });
    expect(result.detail).not.toContain('sk-ant-test');
  });

  it('classifies a 429 as rate_limited', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '{}' }));
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'rate_limited', status: 429 });
  });

  it('classifies a 500 as upstream_unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '{}' }));
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'upstream_unavailable', status: 500 });
  });

  it('classifies a network failure as invalid_base_url when the cause code indicates DNS/connect failure', async () => {
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'invalid_base_url' });
  });

  it('sends the OpenAI chat-completions request shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk-ant-test' });
  });

  it('sends the Google generateContent request shape with x-goog-api-key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({ protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash' }));
    expect(result).toMatchObject({ ok: true, kind: 'success' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('gemini-2.5-flash');
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'sk-ant-test' });
  });

  // Reproduces the reported failure: a valid Gemini key whose model-discovery call listed 42
  // models, but whose "Test connection" reported 'Provider returned a 2xx response without
  // assistant text'. Both tests below FAIL against the pre-fix code (64-token budget, unfiltered
  // parts) — that is what makes them worth keeping.
  it('does not exhaust the token budget on a reasoning model before it can answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({ protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-flash-latest' }));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { generationConfig: { maxOutputTokens: number } };
    // Gemini 2.5's dynamic thinking budget alone routinely exceeds the old 64.
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(512);
  });

  it('ignores Gemini thought parts, so hidden reasoning does not corrupt the smoke reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  { text: 'The user wants a literal two-letter answer, so I will reply ok.', thought: true },
                  { text: 'ok' },
                ],
              },
            },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({ protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-flash-latest' }));
    // Unfiltered, the join produced "The user wants…ok", which the exact-match smoke check rejects.
    expect(result).toMatchObject({ ok: true, kind: 'success' });
  });

  it('names the provider stop reason when a 2xx carried no text at all', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      // Exactly the shape Gemini returns when thinking consumed the whole budget: a candidate with
      // a finish reason and no `content.parts` whatsoever.
      text: async () => JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({ protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-flash-latest' }));
    expect(result.ok).toBe(false);
    // The old message named only the symptom; an operator could not tell a too-small budget from a
    // safety block from a broken endpoint.
    expect(result.detail).toContain('MAX_TOKENS');
  });

  it('sends the Azure legacy deployment request shape with api-key header and api-version query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await (({ protocol, baseUrl, apiKey, model, ...optionalArgs }: Parameters<typeof testProviderConnection>[0] & NonNullable<Parameters<typeof testProviderConnection>[1]>) => testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs))(baseInput({ protocol: 'azure', baseUrl: 'https://my-resource.openai.azure.com', model: 'gpt-4o-deployment' }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/openai/deployments/gpt-4o-deployment/chat/completions');
    expect(url).toContain('api-version=2024-10-21');
    expect(init.headers).toMatchObject({ 'api-key': 'sk-ant-test' });
  });
});

describe('testProviderConnection through injected transport', () => {
  const KEY = ['sk', 'probe', 'secret', '42'].join('-');
  function probe(overrides: Partial<ProviderConnectionTestInput>, fetchFn: typeof fetch, extra: Partial<ProviderConnectionTestInput> = {}) {
    const { protocol, baseUrl, apiKey, model, ...optional } = baseInput({ apiKey: KEY, ...overrides });
    return testProviderConnection({ protocol, baseUrl, apiKey, model }, { ...optional, fetchFn, ...extra });
  }
  function respond(status: number, body: string): typeof fetch & { calls: Array<[string, RequestInit]> } {
    const calls: Array<[string, RequestInit]> = [];
    const fn = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push([String(url), init ?? {}]);
      return new Response(body, { status });
    };
    return Object.assign(fn, { calls });
  }

  describe('HTTP status classification', () => {
    it.each([
      { status: 400, body: { error: { message: 'Invalid API key provided' } }, kind: 'auth_failed' },
      { status: 400, body: { error: { message: 'max_tokens too large' } }, kind: 'unknown' },
      { status: 403, body: { error: 'Permission denied for this project' }, kind: 'auth_failed' },
      { status: 403, body: { message: 'Region not allowed' }, kind: 'forbidden' },
      { status: 404, body: { error: { message: 'The model `gpt-x` does not exist' } }, kind: 'not_found_model' },
      { status: 404, body: { error: { message: 'Route missing' } }, kind: 'invalid_base_url' },
      { status: 418, body: {}, kind: 'unknown' },
    ])('$status "$body" → $kind', async ({ status, body, kind }) => {
      const result = await probe({}, respond(status, JSON.stringify(body)));
      expect(result).toMatchObject({ ok: false, kind, status });
    });

    it('explains an empty 404 as a Base URL path problem and leaves other empty failures blank', async () => {
      expect((await probe({}, respond(404, ''))).detail).toBe('HTTP 404 from provider; check the Base URL path.');
      expect((await probe({}, respond(502, ''))).detail).toBe('');
    });

    it('uses the provider error text: a plain string error, a top-level message, or the raw non-JSON body', async () => {
      expect((await probe({}, respond(500, JSON.stringify({ error: 'quota exhausted' })))).detail).toBe('quota exhausted');
      expect((await probe({}, respond(500, JSON.stringify({ error: { message: '  ' }, message: 'top-level reason' })))).detail).toBe('top-level reason');
      expect((await probe({}, respond(500, JSON.stringify({ error: { code: 7 } })))).detail).toBe('{"error":{"code":7}}');
      expect((await probe({}, respond(500, 'null'))).detail).toBe('null');
      expect((await probe({}, respond(503, '<html>Service Unavailable</html>'))).detail).toBe('<html>Service Unavailable</html>');
    });

    it('redacts the key from a provider error that echoes it back', async () => {
      const result = await probe({}, respond(401, JSON.stringify({ error: { message: `bad key ${KEY}` } })));
      expect(result.detail).not.toContain(KEY);
    });
  });

  describe('2xx bodies without the smoke reply', () => {
    it('reports an OpenAI finish_reason when the choice carried no content', async () => {
      const result = await probe({ protocol: 'openai', baseUrl: 'https://api.openai.com', model: 'gpt-4o' }, respond(200, JSON.stringify({ choices: [{ message: {}, finish_reason: 'length' }] })));
      expect(result.detail).toBe('Provider returned a 2xx response without assistant text (finish reason: length)');
    });

    it('accepts a legacy completions-style choice text as the reply', async () => {
      const result = await probe({ protocol: 'openai', baseUrl: 'https://api.openai.com', model: 'gpt-4o' }, respond(200, JSON.stringify({ choices: [{ text: ' OK ' }] })));
      expect(result).toMatchObject({ ok: true, kind: 'success' });
    });

    it.each([
      { name: 'openai with no choices', protocol: 'openai', body: { choices: [] } },
      { name: 'anthropic with no content array', protocol: 'anthropic', body: { content: 'ok' } },
      { name: 'anthropic with only non-text blocks', protocol: 'anthropic', body: { content: [null, { type: 'tool_use' }, { type: 'text', text: 7 }] } },
      { name: 'google with no candidates', protocol: 'google', body: { candidates: [] } },
      { name: 'google with no parts', protocol: 'google', body: { candidates: [{ content: {} }] } },
      { name: 'an empty body', protocol: 'anthropic', body: '' },
      { name: 'a non-JSON body', protocol: 'anthropic', body: 'plain ok' },
    ] as const)('$name has no assistant text and no finish reason', async ({ protocol, body }) => {
      const baseUrl = protocol === 'google' ? 'https://generativelanguage.googleapis.com' : 'https://api.provider.test';
      const result = await probe({ protocol, baseUrl }, respond(200, typeof body === 'string' ? body : JSON.stringify(body)));
      expect(result).toMatchObject({ ok: false, kind: 'unknown', status: 200, detail: 'Provider returned a 2xx response without assistant text' });
    });

    it('treats a non-string Gemini part as empty text rather than "undefined"', async () => {
      const result = await probe({ protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com' }, respond(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: 'o' }, { inlineData: {} }, { text: 'k' }] } }] })));
      expect(result).toMatchObject({ ok: true, kind: 'success' });
    });
  });

  describe('Azure request shapes', () => {
    it('uses the caller-supplied api-version on a deployment URL', async () => {
      const fetchFn = respond(200, JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
      await probe({ protocol: 'azure', baseUrl: 'https://res.openai.azure.com', model: 'my deploy', apiVersion: ' 2099-01-01 ' }, fetchFn);
      expect(fetchFn.calls[0]![0]).toBe('https://res.openai.azure.com/openai/deployments/my%20deploy/chat/completions?api-version=2099-01-01');
    });

    it('targets the v1 chat endpoint with the model in the body and no default api-version', async () => {
      const fetchFn = respond(200, JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
      const result = await probe({ protocol: 'azure', baseUrl: 'https://res.openai.azure.com/openai/v1/', model: 'gpt-4o' }, fetchFn);
      expect(result.ok).toBe(true);
      expect(fetchFn.calls[0]![0]).toBe('https://res.openai.azure.com/openai/v1/chat/completions');
      expect(JSON.parse(String(fetchFn.calls[0]![1].body))).toMatchObject({ model: 'gpt-4o' });
    });

    it('reports a request that cannot be built (an unencodable deployment name) without sending it', async () => {
      const fetchFn = respond(200, '{}');
      const result = await probe({ protocol: 'azure', baseUrl: 'https://res.openai.azure.com', model: 'bad\uD800name' }, fetchFn);
      expect(result).toMatchObject({ ok: false, kind: 'unknown', detail: 'URI malformed' });
      expect(fetchFn.calls).toEqual([]);
    });
  });

  describe('transport failures and cancellation', () => {
    it.each([
      { name: 'an Error without a cause', error: new Error('socket closed'), kind: 'unknown', detail: 'socket closed' },
      { name: 'an Error with an unrecognised cause code', error: Object.assign(new Error('weird'), { cause: { code: 'EPROTO' } }), kind: 'unknown', detail: 'weird' },
      { name: 'a non-Error rejection', error: 'boom', kind: 'unknown', detail: 'boom' },
    ])('classifies $name', async ({ error, kind, detail }) => {
      const result = await probe({}, async () => { throw error; });
      expect(result).toMatchObject({ ok: false, kind, detail });
    });

    it('times out a provider that never answers', async () => {
      const hang: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
      const result = await probe({}, hang, { timeoutMs: 20 });
      expect(result).toMatchObject({ ok: false, kind: 'timeout' });
    });

    it('aborts immediately when the caller signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      let sawAborted = false;
      const fetchFn: typeof fetch = async (_url, init) => {
        sawAborted = init?.signal?.aborted === true;
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      };
      const result = await probe({}, fetchFn, { signal: controller.signal });
      expect(sawAborted).toBe(true);
      expect(result.kind).toBe('timeout');
    });

    it('forwards a later caller abort to the in-flight request and detaches its listener afterwards', async () => {
      const controller = new AbortController();
      const removed: string[] = [];
      const signal = controller.signal;
      const originalRemove = signal.removeEventListener.bind(signal);
      signal.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
        removed.push(type);
        originalRemove(type, listener);
      }) as typeof signal.removeEventListener;
      const fetchFn: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        controller.abort();
      });
      const result = await probe({}, fetchFn, { signal });
      expect(result.kind).toBe('timeout');
      expect(removed).toEqual(['abort']);
    });
  });

  it('skips DNS for an IP-literal base URL even with no resolver injected', async () => {
    const fetchFn = respond(200, JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }));
    const { protocol, apiKey, model } = baseInput({});
    const result = await testProviderConnection({ protocol, baseUrl: 'https://93.184.216.34', apiKey, model }, { fetchFn });
    expect(result).toMatchObject({ ok: true, kind: 'success' });
    expect(fetchFn.calls[0]![0]).toBe('https://93.184.216.34/v1/messages');
  });
});
