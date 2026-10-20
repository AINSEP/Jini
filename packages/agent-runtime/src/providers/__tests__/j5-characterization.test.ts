import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { parseAIHubMixCatalog, aihubmixCatalogUrl } from '../aihubmix.js';
import { pinnedFetch, type PinnedFetch } from '../connection-guard.js';
import { testProviderConnection, type SupportedConnectionTestProtocol } from '../connection-test.js';
import { createElevenLabsVoiceClient } from '../elevenlabs.js';
import { runGoogleToolTurn, type GoogleTurnEvent } from '../google-messages.js';

const probe = { protocol: 'openai' as const, baseUrl: 'https://provider.example/v1', apiKey: 'fixture-key', model: ' fixture-model ' };
const dnsLookup = async () => [{ address: '8.8.8.8', family: 4 }];
afterEach(() => vi.unstubAllGlobals());

describe('J5 behavior pins before cleanup', () => {
  it('keeps the first eligible catalog row, with raw IDs and fallback labels', () => {
    const data = { data: [null, {}, { model_id: 1 }, { model_id: '' },
      { model_id: 'a', types: ' IMAGE_GENERATION, LLM ' }, { model_id: 'a', model_name: 'Chat' },
      { model_id: 'a', model_name: 'Duplicate' }, { model_id: ' b ', model_name: 2 },
      { model_id: 'c', types: null, model_name: '' }] };
    expect(parseAIHubMixCatalog({ data }, { chatOnly: true })).toEqual([
      { id: 'a', label: 'Chat' }, { id: ' b ', label: ' b ' }, { id: 'c', label: 'c' },
    ]);
    expect(parseAIHubMixCatalog({ data })[0]).toEqual({ id: 'a', label: 'a' });
    expect(parseAIHubMixCatalog({ data: { data: null } })).toEqual([]);
    expect(aihubmixCatalogUrl({ baseUrl: 'invalid', type: 'llm' })).toBe('https://aihubmix.com/api/v1/models?type=llm');
  });

  it.each([301, 302, 303, 307, 308, 304, 200])('preserves pinned transport status handling for %i', async status => {
    const server = createServer((_req, res) => { res.writeHead(status, { location: 'http://10.0.0.1' }); res.end(); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing fixture address');
      const pending = pinnedFetch({ url: `http://127.0.0.1:${address.port}`, init: { method: 'POST', headers: {}, body: '' }, pinnedAddress: undefined });
      if ([301, 302, 303, 307, 308].includes(status)) await expect(pending).rejects.toThrow(`refused to follow a ${status} redirect`);
      else { const response = await pending; expect(response.status).toBe(status); expect(await response.text()).toBe(''); }
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it.each([
    [401, {}, 'auth_failed', '{}'], [400, { error: 'invalid api key' }, 'auth_failed', 'invalid api key'],
    [400, { error: 'bad request' }, 'unknown', 'bad request'],
    [403, { error: { message: 'permission denied' } }, 'auth_failed', 'permission denied'],
    [403, { message: 'policy' }, 'forbidden', 'policy'],
    [404, { error: { message: 'model not found' } }, 'not_found_model', 'model not found'],
    [404, { error: { message: ' ' }, message: ' ' }, 'invalid_base_url', '{"error":{"message":" "},"message":" "}'],
    [429, {}, 'rate_limited', '{}'], [503, {}, 'upstream_unavailable', '{}'], [418, null, 'unknown', 'null'],
  ])('classifies HTTP %s and preserves detail precedence', async (status, data, kind, detail) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: Number(status) })));
    const result = await testProviderConnection(probe, { dnsLookup });
    expect(result).toMatchObject({ ok: false, kind, model: 'fixture-model', status });
    expect(result.detail).toBe(detail);
  });

  it.each(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'other'])('classifies network cause %s', async code => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('transport failed', { cause: { code } })));
    expect(await testProviderConnection(probe, { dnsLookup })).toMatchObject({ ok: false, kind: code === 'other' ? 'unknown' : 'invalid_base_url', detail: 'transport failed' });
  });

  it.each([
    [{ candidates: [{ finishReason: ' MAX_TOKENS ' }], choices: [{ finish_reason: 'ignored' }], stop_reason: 'ignored' }, ' (finish reason: MAX_TOKENS)'],
    [{ choices: [{ finish_reason: ' filtered ' }] }, ' (finish reason: filtered)'],
    [{ stop_reason: ' stopped ' }, ' (finish reason: stopped)'],
    [{ candidates: [{ finishReason: 1 }], stop_reason: 'ignored' }, ''],
    [{ stop_reason: ' ' }, ''], [{}, ''],
  ])('preserves finish-reason precedence for %j', async (data, suffix) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    expect((await testProviderConnection(probe, { dnsLookup })).detail).toBe(`Provider returned a 2xx response without assistant text${suffix}`);
  });

  it.each(['anthropic', 'openai', 'azure', 'google'] as const)('accepts the existing %s wire response', async (protocol: SupportedConnectionTestProtocol) => {
    const data = { content: [null, { type: 'image' }, { type: 'text', text: ' OK ' }], choices: [{ text: 'ok' }], candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, null, { text: 'o' }, { text: 'k' }] } }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    expect(await testProviderConnection({ ...probe, protocol }, { dnsLookup })).toMatchObject({ ok: true, kind: 'success', detail: 'valid completion' });
  });

  it.each(['', 'not-json'])('preserves unreadable/non-JSON response behavior for %j', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    expect((await testProviderConnection(probe, { dnsLookup })).detail).toBe('Provider returned a 2xx response without assistant text');
  });

  it('keeps DNS pinning and redirect policy absent from the smoke fetch (reported, not fixed)', async () => {
    const fetchFake = vi.fn().mockResolvedValue(new Response('{"choices":[{"text":"ok"}]}'));
    vi.stubGlobal('fetch', fetchFake);
    await testProviderConnection(probe, { dnsLookup });
    expect(fetchFake.mock.calls[0]![1].redirect).toBeUndefined();
    expect(fetchFake.mock.calls[0]![1].dispatcher).toBeUndefined();
  });

  it.each([
    { payload: null, expected: [] }, { payload: {}, expected: [] },
    { payload: { voices: null }, expected: [] }, { payload: { voices: [] }, expected: [] },
    { payload: { voices: [null, {}, { voice_id: ' a ' }] }, expected: [{ voiceId: 'a', name: 'a' }] },
  ])('normalizes ElevenLabs catalog envelopes %j', async ({ payload, expected }) => {
    const client = createElevenLabsVoiceClient({ clock: { nowMs: () => 0 }, http: { send: async () => ({ status: 200, headers: {}, bodyText: JSON.stringify(payload) }) } });
    const result = await client.listVoiceOptions({ workspaceKey: 'workspace', resolveCredentials: async () => ({ apiKey: 'fixture-key' }) });
    expect(result).toEqual(expected);
  });

  it.each([
    { parts: [{ text: 'answer' }], finishReason: 'STOP', end: 'stop' },
    { parts: [{ text: '  ' }], finishReason: 'STOP', end: 'error' },
    { parts: [], finishReason: 'MAX_TOKENS', end: 'error' },
    { parts: [{ functionCall: { name: 'tool', args: {}, id: 'call' } }], finishReason: 'STOP', end: 'stop' },
  ])('preserves Google initial turn completion for %j', async ({ parts, finishReason, end }) => {
    const events: GoogleTurnEvent[] = [];
    const fetchImpl: PinnedFetch = async () => ({ ok: true, status: 200, text: async () => '', body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(`data: ${JSON.stringify({ candidates: [{ content: { parts }, finishReason }] })}\n\n`); } } });
    expect(await runGoogleToolTurn({ apiKey: 'fixture-key', model: 'gemini', contents: [], onEvent: event => events.push(event) }, { baseUrl: 'http://127.0.0.1', fetchImpl })).toEqual({ finishReason, toolTurns: 0 });
    expect(events.filter(event => event.type === 'end')).toEqual([{ type: 'end', reason: end }]);
  });
});

it.each([new DOMException('aborted', 'AbortError'), new Error('ordinary failure'), 'plain failure'])('preserves thrown failure %s', async error => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
  expect(await testProviderConnection(probe, { dnsLookup })).toMatchObject({ ok: false, kind: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unknown', detail: error instanceof Error ? error.message : error });
});

it.each([true, false])('propagates a parent abort (already aborted: %s) and removes the listener', async alreadyAborted => {
  const controller = new AbortController();
  if (alreadyAborted) controller.abort();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    if (!alreadyAborted) controller.abort();
    expect(init.signal?.aborted).toBe(true);
    throw new DOMException('aborted', 'AbortError');
  }));
  expect(await testProviderConnection(probe, { dnsLookup, signal: controller.signal })).toMatchObject({ kind: 'timeout' });
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

it('retains a provider finish reason containing the configured credential (reported, not fixed)', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ stop_reason: probe.apiKey }))));
  expect((await testProviderConnection(probe, { dnsLookup })).detail).toBe(`Provider returned a 2xx response without assistant text (finish reason: ${probe.apiKey})`);
});

it.each([
  { baseUrl: 'https://azure.example', apiVersion: undefined, path: '/openai/deployments/fixture-model/chat/completions', version: '2024-10-21', versioned: false },
  { baseUrl: 'https://azure.example/openai/v1/', apiVersion: undefined, path: '/openai/v1/chat/completions', version: null, versioned: true },
  { baseUrl: 'https://azure.example/openai/v1', apiVersion: ' custom ', path: '/openai/v1/chat/completions', version: 'custom', versioned: true },
])('preserves Azure endpoint/version contract %j', async ({ baseUrl, apiVersion, path, version, versioned }) => {
  const fetchFake = vi.fn().mockResolvedValue(new Response('{"choices":[{"message":{"content":"ok"}}]}'));
  vi.stubGlobal('fetch', fetchFake);
  expect(await testProviderConnection({ ...probe, protocol: 'azure', baseUrl }, { dnsLookup, ...(apiVersion === undefined ? {} : { apiVersion }) })).toMatchObject({ ok: true });
  const [url, init] = fetchFake.mock.calls[0]!;
  expect(new URL(url).pathname).toBe(path);
  expect(new URL(url).searchParams.get('api-version')).toBe(version);
  expect(JSON.parse(init.body)).toEqual({ ...(versioned ? { model: 'fixture-model' } : {}), max_tokens: 512, messages: [{ role: 'user', content: 'Reply with only: ok' }], stream: false });
});

it.each([
  { protocol: 'ollama' as const, baseUrl: 'invalid', apiKey: '', kind: 'unknown' },
  { protocol: 'openai' as const, baseUrl: 'invalid', apiKey: ' ', kind: 'auth_failed' },
  { protocol: 'openai' as const, baseUrl: 'invalid', apiKey: 'fixture-key', kind: 'invalid_base_url' },
  { protocol: 'openai' as const, baseUrl: 'http://10.0.0.1', apiKey: 'fixture-key', kind: 'forbidden' },
])('preserves validation precedence %j', async ({ kind, ...input }) => {
  const fetchFake = vi.fn();
  vi.stubGlobal('fetch', fetchFake);
  expect(await testProviderConnection({ ...probe, ...input }, { dnsLookup })).toMatchObject({ ok: false, kind, model: 'fixture-model' });
  expect(fetchFake).not.toHaveBeenCalled();
});

it.each([400, 404])('retains empty error detail fallback for HTTP %s', async status => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":""}', { status })));
  expect((await testProviderConnection(probe, { dnsLookup })).detail).toBe(status === 404 ? 'HTTP 404 from provider; check the Base URL path.' : '');
});

it('falls back to empty data when reading the response body fails', async () => {
  const response = new Response('ignored');
  vi.spyOn(response, 'text').mockRejectedValue(new Error('body failed'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  expect((await testProviderConnection(probe, { dnsLookup })).detail).toBe('Provider returned a 2xx response without assistant text');
});

it('retains an ElevenLabs credential echoed by an error body (reported, not fixed)', async () => {
  const apiKey = 'fixture-voice-key';
  const client = createElevenLabsVoiceClient({ clock: { nowMs: () => 0 }, http: { send: async () => ({ status: 401, headers: {}, bodyText: `invalid credential ${apiKey}` }) } });
  await expect(client.listVoiceOptions({ workspaceKey: 'workspace', resolveCredentials: async () => ({ apiKey }) })).rejects.toThrow(`elevenlabs voices 401: invalid credential ${apiKey}`);
});
