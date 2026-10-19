import { afterEach, describe, expect, it, vi } from 'vitest';
import { testProviderConnection, type ProviderConnectionTestInput } from '../connection-test.js';
import type { DnsLookupAddress } from '../connection-guard.js';

// Exercise defaultDnsLookup without relying on the machine's network.
vi.mock('node:dns', () => ({
  promises: { lookup: async () => [{ address: '8.8.8.8', family: 4 }] },
}));

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

describe('testProviderConnection boundaries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const run = (overrides: Partial<ProviderConnectionTestInput>) => {
    const { protocol, baseUrl, apiKey, model, ...optionalArgs } = baseInput(overrides);
    return testProviderConnection({ protocol, baseUrl, apiKey, model }, optionalArgs);
  };
  const respond = (status: number, body: string) => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(body, { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const respondJson = (status: number, body: unknown) => respond(status, JSON.stringify(body));
  const reject = (err: unknown) => vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw err; }));

  it('classifies a 400 naming the api key as auth_failed', async () => {
    respondJson(400, { error: { message: 'API key not valid' } });
    expect(await run({})).toMatchObject({ kind: 'auth_failed', status: 400, detail: 'API key not valid' });
  });

  it('classifies a 400 without auth wording as unknown', async () => {
    respondJson(400, { error: 'bad request' });
    expect(await run({})).toMatchObject({ kind: 'unknown', status: 400, detail: 'bad request' });
  });

  it('classifies a 403 naming permission denied as auth_failed', async () => {
    respondJson(403, { message: 'permission denied' });
    expect(await run({})).toMatchObject({ kind: 'auth_failed', status: 403, detail: 'permission denied' });
  });

  it('classifies a plain 403 as forbidden', async () => {
    respondJson(403, { message: 'region blocked' });
    expect(await run({})).toMatchObject({ kind: 'forbidden', detail: 'region blocked' });
  });

  it('classifies a 404 naming the model as not_found_model', async () => {
    respondJson(404, { error: { message: 'model does not exist' } });
    expect(await run({})).toMatchObject({ kind: 'not_found_model', detail: 'model does not exist' });
  });

  it('explains an empty 404 as a base url path problem', async () => {
    respond(404, '');
    expect(await run({})).toMatchObject({ kind: 'invalid_base_url', detail: 'HTTP 404 from provider; check the Base URL path.' });
  });

  it('leaves an empty non-404 error detail empty', async () => {
    respond(500, '');
    expect(await run({})).toMatchObject({ kind: 'upstream_unavailable', detail: '' });
  });

  it('falls back to the top-level message when error.message is blank', async () => {
    respondJson(418, { error: { message: '  ' }, message: 'teapot' });
    expect(await run({})).toMatchObject({ kind: 'unknown', detail: 'teapot' });
  });

  it('uses the raw body when the error response is not JSON', async () => {
    respond(502, '  upstream exploded  ');
    expect(await run({})).toMatchObject({ kind: 'upstream_unavailable', detail: 'upstream exploded' });
  });

  it('uses the raw body when a JSON error carries no message', async () => {
    respondJson(418, { error: { code: 1 } });
    expect(await run({})).toMatchObject({ detail: '{"error":{"code":1}}' });
  });

  it('uses the raw body when the error response is JSON null', async () => {
    respond(500, 'null');
    expect(await run({})).toMatchObject({ detail: 'null' });
  });

  it('treats an unreadable body as empty', async () => {
    const response = new Response('ok', { status: 200 });
    vi.spyOn(response, 'text').mockRejectedValue(new Error('stream broke'));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => response));
    expect(await run({})).toMatchObject({ ok: false, detail: 'Provider returned a 2xx response without assistant text' });
  });

  it('classifies an AbortError as timeout', async () => {
    reject(new DOMException('aborted', 'AbortError'));
    expect(await run({})).toMatchObject({ kind: 'timeout', detail: 'aborted' });
  });

  it('classifies an Error without a cause code as unknown', async () => {
    reject(new Error('boom'));
    expect(await run({})).toMatchObject({ kind: 'unknown', detail: 'boom' });
  });

  it('classifies an Error with an unrecognised cause code as unknown', async () => {
    reject(Object.assign(new Error('odd'), { cause: { code: 'EWHATEVER' } }));
    expect(await run({})).toMatchObject({ kind: 'unknown', detail: 'odd' });
  });

  it('stringifies a non-Error rejection', async () => {
    reject('plain string');
    expect(await run({})).toMatchObject({ kind: 'unknown', detail: 'plain string' });
  });

  it('aborts the request when the caller signal is already aborted', async () => {
    const fetchMock = respondJson(200, { content: [{ type: 'text', text: 'ok' }] });
    const parent = new AbortController();
    parent.abort();
    await run({ signal: parent.signal });
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it('forwards a later caller abort and detaches afterwards', async () => {
    const parent = new AbortController();
    let seen: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_url, init) => {
      seen = init!.signal!;
      parent.abort();
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }));
    }));
    const removeSpy = vi.spyOn(parent.signal, 'removeEventListener');
    await run({ signal: parent.signal });
    expect(seen!.aborted).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('resolves the base url with the default DNS lookup when none is injected', async () => {
    respondJson(200, { content: [{ type: 'text', text: 'ok' }] });
    expect(await testProviderConnection({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test', model: 'claude-sonnet-4-5' })).toMatchObject({ ok: true, kind: 'success' });
  });

  // BUG (pinned, not fixed): validateBaseUrl trims NBSP before parsing, but the
  // request builder re-parses the raw string, which `new URL` rejects.
  it('reports an NBSP-padded base url that passes the guard as unknown Invalid URL', async () => {
    const fetchMock = respond(200, '{}');
    expect(await run({ baseUrl: '\u00a0https://api.anthropic.com' })).toMatchObject({ kind: 'unknown', detail: 'Invalid URL' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips non-text Anthropic blocks and reads the first text block', async () => {
    respondJson(200, { content: [null, { type: 'tool_use' }, { type: 'text', text: 7 }, { type: 'text', text: 'ok' }] });
    expect(await run({})).toMatchObject({ ok: true });
  });

  it('reports no text when the Anthropic content has no text block', async () => {
    respondJson(200, { content: [{ type: 'tool_use' }], stop_reason: 'tool_use' });
    expect(await run({})).toMatchObject({ detail: 'Provider returned a 2xx response without assistant text (finish reason: tool_use)' });
  });

  it('reports no text when the Anthropic content is not an array', async () => {
    respondJson(200, {});
    expect(await run({})).toMatchObject({ detail: 'Provider returned a 2xx response without assistant text' });
  });

  it('ignores a blank finish reason', async () => {
    respondJson(200, { stop_reason: '  ' });
    expect(await run({})).toMatchObject({ detail: 'Provider returned a 2xx response without assistant text' });
  });

  it('reads an OpenAI legacy completion text field', async () => {
    respondJson(200, { choices: [{ text: 'ok' }] });
    expect(await run({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' })).toMatchObject({ ok: true });
  });

  it('names the OpenAI finish_reason when a choice carries no text', async () => {
    respondJson(200, { choices: [{ finish_reason: 'content_filter' }] });
    expect(await run({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' })).toMatchObject({
      detail: 'Provider returned a 2xx response without assistant text (finish reason: content_filter)',
    });
  });

  it('reports no text for an empty OpenAI choices array', async () => {
    respondJson(200, { choices: [] });
    expect(await run({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' })).toMatchObject({
      detail: 'Provider returned a 2xx response without assistant text',
    });
  });

  it('sends an Azure v1 path with the model in the body and no default api-version', async () => {
    const fetchMock = respondJson(200, { choices: [{ message: { content: 'ok' } }] });
    await run({ protocol: 'azure', baseUrl: 'https://r.openai.azure.com/openai/v1/', model: 'gpt-4o' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://r.openai.azure.com/openai/v1/chat/completions');
    expect(JSON.parse(String(init!.body))).toMatchObject({ model: 'gpt-4o', max_tokens: 512 });
  });

  it('uses an explicit Azure api-version', async () => {
    const fetchMock = respondJson(200, { choices: [{ message: { content: 'ok' } }] });
    await run({ protocol: 'azure', baseUrl: 'https://r.openai.azure.com/openai/v1', model: 'gpt-4o', apiVersion: ' preview ' });
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('api-version')).toBe('preview');
  });

  it('reports no text when Google returns no candidates', async () => {
    respondJson(200, { candidates: [] });
    expect(await run({ protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini' })).toMatchObject({
      detail: 'Provider returned a 2xx response without assistant text',
    });
  });

  it('treats non-string Google parts as empty text', async () => {
    respondJson(200, { candidates: [{ content: { parts: [null, { text: 5 }, { text: 'ok' }] } }] });
    expect(await run({ protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini' })).toMatchObject({ ok: true });
  });

  it('trims surrounding whitespace and case from the smoke reply', async () => {
    respondJson(200, { content: [{ type: 'text', text: ' OK\n' }] });
    expect(await run({})).toMatchObject({ ok: true, detail: 'valid completion', model: 'claude-sonnet-4-5' });
  });

  it('truncates a long wrong reply to 120 characters with an ellipsis', async () => {
    respondJson(200, { content: [{ type: 'text', text: 'y'.repeat(200) }] });
    expect((await run({})).detail).toBe(`Expected smoke test reply "ok"; got "${'y'.repeat(119)}…"`);
  });

  it('trims the model before probing', async () => {
    const fetchMock = respondJson(200, { content: [{ type: 'text', text: 'ok' }] });
    expect(await run({ model: ' claude-x ' })).toMatchObject({ model: 'claude-x' });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({ model: 'claude-x' });
  });

  it('names the unsupported protocol', async () => {
    expect(await run({ protocol: 'bedrock' })).toMatchObject({ detail: 'Connection test is not supported for protocol "bedrock".' });
  });

  it('names the base-url guard error', async () => {
    expect(await run({ baseUrl: 'ftp://x.example' })).toMatchObject({ kind: 'invalid_base_url', detail: 'Only http/https allowed' });
  });
});
