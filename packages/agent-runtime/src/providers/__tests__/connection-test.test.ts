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
    const result = await testProviderConnection(baseInput({ protocol: 'ollama' }));
    expect(result).toMatchObject({ ok: false, kind: 'unknown' });
    expect(result.detail).toMatch(/not supported/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid base url before making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await testProviderConnection(baseInput({ baseUrl: 'not a url' }));
    expect(result).toMatchObject({ ok: false, kind: 'invalid_base_url' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports forbidden for an internal base url without making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await testProviderConnection(baseInput({ baseUrl: 'http://10.0.0.5' }));
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
    const result = await testProviderConnection(baseInput({}));
    expect(result).toMatchObject({ ok: true, kind: 'success', status: 200 });
  });

  it('sends the Anthropic request shape (x-api-key header, /v1/messages path, model + smoke prompt body)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await testProviderConnection(baseInput({}));
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
    const result = await testProviderConnection(baseInput({}));
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
    const result = await testProviderConnection(baseInput({}));
    expect(result.ok).toBe(false);
    expect(result.detail).not.toContain('sk-ant-test');
    expect(result.detail).toContain('[REDACTED]');
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
    const result = await testProviderConnection(baseInput({}));
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
    const result = await testProviderConnection(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'auth_failed', status: 401 });
    expect(result.detail).not.toContain('sk-ant-test');
  });

  it('classifies a 429 as rate_limited', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '{}' }));
    const result = await testProviderConnection(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'rate_limited', status: 429 });
  });

  it('classifies a 500 as upstream_unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '{}' }));
    const result = await testProviderConnection(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'upstream_unavailable', status: 500 });
  });

  it('classifies a network failure as invalid_base_url when the cause code indicates DNS/connect failure', async () => {
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const result = await testProviderConnection(baseInput({}));
    expect(result).toMatchObject({ ok: false, kind: 'invalid_base_url' });
  });

  it('sends the OpenAI chat-completions request shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await testProviderConnection(baseInput({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' }));
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
    const result = await testProviderConnection(
      baseInput({ protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash' }),
    );
    expect(result).toMatchObject({ ok: true, kind: 'success' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('gemini-2.5-flash');
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'sk-ant-test' });
  });

  it('sends the Azure legacy deployment request shape with api-key header and api-version query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await testProviderConnection(
      baseInput({ protocol: 'azure', baseUrl: 'https://my-resource.openai.azure.com', model: 'gpt-4o-deployment' }),
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/openai/deployments/gpt-4o-deployment/chat/completions');
    expect(url).toContain('api-version=2024-10-21');
    expect(init.headers).toMatchObject({ 'api-key': 'sk-ant-test' });
  });
});
