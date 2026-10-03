import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient } from '@jini-ai/platform/http/guarded';
import type { HttpClientPort } from '@jini-ai/core/primitives';
import { buildRenderContext } from '../context.js';
import { createMediaDispatchEngine } from '../engine.js';
import { createInMemoryAsyncOperationStore } from '../async-operation-store.js';
import { startOperation, pollDueOperations } from '../operation-runtime.js';
import { bytesFromOpenAICompatibleData } from '../openai-compatible.js';
import { fetchMediaOutbound } from '../outbound.js';
import { assertAndFetchExternalAsset, validateBaseUrlResolved } from '../ssrf-guard.js';
import { renderOpenAIImage } from '../providers/openai.js';
import { renderOpenRouterImage } from '../providers/openrouter.js';
import { dispatchVendorRequest } from '../vendor-adapter.js';
import type { PollingVendorAdapter } from '../polling-adapter.js';
import type { RenderContext } from '../types.js';
import { testNodeGuardedHttpPorts, testPinnedRequests } from './outbound-fixtures.js';

vi.mock('@jini-ai/platform/http/guarded', async (importOriginal) => {
  const original = await importOriginal<typeof import('@jini-ai/platform/http/guarded')>();
  const { testNodeGuardedHttpPorts } = await import('./outbound-fixtures.js');
  return { ...original, createNodeGuardedHttpPorts: testNodeGuardedHttpPorts };
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function context(httpClient?: HttpClientPort): RenderContext {
  return { ...buildRenderContext({ request: { surface: 'image', model: 'dall-e-3' },
    resolvedAudioKind: undefined, length: undefined, duration: undefined }),
    ...(httpClient === undefined ? {} : { httpClient }) };
}

const adapter: PollingVendorAdapter = {
  expectedLatencyClass: 'fast',
  buildSubmitRequest: () => ({ url: 'https://vendor.example/submit', init: { method: 'POST' }, meta: undefined }),
  parseSubmitResponse: async ({ resp }) => ({ kind: 'complete', result: {
    bytes: Buffer.from(await resp.arrayBuffer()), providerNote: 'complete' } }),
  buildPollRequest: () => ({ url: 'https://vendor.example/poll', init: {}, meta: undefined }),
  parsePollResponse: async ({ resp }) => ({ kind: 'complete', result: {
    bytes: Buffer.from(await resp.arrayBuffer()), providerNote: 'complete' } }),
};

type Path = { name: string; invoke(url: string, ctx: RenderContext): Promise<Buffer>; generationCalls: number };
const paths: Path[] = [
  { name: 'OpenAI asset', generationCalls: 1, invoke: async (_url, ctx) =>
    (await renderOpenAIImage({ ctx, credentials: { apiKey: 'test' } })).bytes },
  { name: 'OpenRouter asset', generationCalls: 1, invoke: async (_url, ctx) =>
    (await renderOpenRouterImage({ ctx, credentials: { apiKey: 'test' } })).bytes },
  { name: 'shared OpenAI-compatible asset', generationCalls: 0, invoke: (url, ctx) =>
    bytesFromOpenAICompatibleData({ data: { data: [{ url }] }, providerTag: 'fixture' }, ctx) },
  { name: 'vendor request', generationCalls: 0, invoke: async (url, ctx) =>
    (await dispatchVendorRequest({ ctx, credentials: {}, adapter: {
      buildRequest: () => ({ url, init: { method: 'POST' }, meta: undefined }),
      parseResponse: async ({ resp }) => ({ bytes: Buffer.from(await resp.arrayBuffer()), providerNote: 'fixture' }),
    } })).bytes },
  { name: 'operation runtime signed submit', generationCalls: 0, invoke: async (url, ctx) => {
    const store = createInMemoryAsyncOperationStore();
    const outcome = await startOperation({ store, signer: ({ request }) => ({ url, init: request.init }),
      adapter, ctx, providerId: 'fixture', routeKey: 'image', ownerRef: 'fixture' },
      { graceMs: 1000, ...(ctx.httpClient === undefined ? {} : { httpClient: ctx.httpClient }) });
    if (outcome.done) return outcome.result.bytes;
    const row = await store.get({ id: outcome.operationId });
    throw new Error(row?.error?.message ?? 'operation did not complete');
  } },
  { name: 'existing strict asset helper', generationCalls: 0, invoke: async (url, ctx) =>
    Buffer.from(await (await assertAndFetchExternalAsset({ url }, ctx)).arrayBuffer()) },
];

function wire(url: string, redirect = false) {
  const fetchMock = vi.fn(async (requestUrl: string) => {
    if (requestUrl.includes('/images/generations')) return new Response(JSON.stringify({ data: [{ url }] }));
    if (requestUrl.includes('/chat/completions')) return new Response(JSON.stringify({ choices: [
      { message: { images: [{ image_url: { url } }] } },
    ] }));
    if (redirect) return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
    return new Response(Buffer.from([0xff, 0x00, 0x80, 0x42]));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

for (const path of paths) describe(path.name, () => {
  // REGRESSION: fails if this path's fetchMediaOutbound/assertAndFetchExternalAsset call is replaced with raw fetchWithTimeout.
  it.each(['http://10.0.0.1/secret', 'http://127.0.0.1/secret', 'http://169.254.169.254/secret', 'http://[::ffff:7f00:1]/secret'])('refuses %s without an injected guard', async (url) => {
    const raw = wire(url);
    await expect(path.invoke(url, context())).rejects.toThrow(/blocked|rejected/);
    expect(raw).toHaveBeenCalledTimes(path.generationCalls);
  });
  // REGRESSION: fails if this path omits redirect:error when forwarding to the guarded client.
  it('refuses a public redirect to loopback before a second connection', async () => {
    const url = 'https://cdn.example/asset';
    const raw = wire(url, true);
    await expect(path.invoke(url, context())).rejects.toThrow(/redirect/);
    expect(raw).toHaveBeenCalledTimes(path.generationCalls + 1);
    expect(raw.mock.calls.some(([target]) => target.includes('127.0.0.1'))).toBe(false);
  });
  // REGRESSION: fails if this path ignores its injected guarded HttpClientPort and uses raw fetchWithTimeout.
  it('allows public binary bytes through the injected guard', async () => {
    const url = 'https://cdn.example/asset';
    wire(url);
    const ports = testNodeGuardedHttpPorts();
    const transport = vi.fn(ports.transport.requestPinned);
    const client = createHttpClient({ ...ports, transport: { requestPinned: transport }, userAgent: 'fixture', policy: {
      allowedSchemes: ['https', 'http'], denyPrivateAddresses: true, devHostAllowlist: [], maxRedirects: 5,
      connectTimeoutMs: 600_000, maxResponseBytes: 1024, maxDecompressedBytes: 1024,
    } });
    expect(await path.invoke(url, context(client))).toEqual(Buffer.from([0xff, 0x00, 0x80, 0x42]));
    expect(transport).toHaveBeenCalledTimes(path.generationCalls + 1);
    expect(transport.mock.calls.at(-1)?.[0].peer.ip).toBe('93.184.216.34');
  });
});

describe('DNS, development and timeout policy', () => {
  // REGRESSION: fails if fetchMediaOutbound removes the init.dispatcher rejection.
  it('refuses a raw dispatcher override before contacting the transport', async () => {
    const raw = wire('https://cdn.example/a');
    const init: RequestInit = {};
    Object.defineProperty(init, 'dispatcher', { value: {}, enumerable: true });
    await expect(fetchMediaOutbound({ url: 'https://cdn.example/a', timeoutMs: 1000 }, { init }))
      .rejects.toThrow(/guarded HTTP client/);
    expect(raw).not.toHaveBeenCalled();
  });
  // REGRESSION: fails if fetchMediaOutbound accepts an unsupported body/method.
  it('refuses transport overrides and unsupported wire requests before I/O', async () => {
    const raw = wire('https://cdn.example/a');
    await expect(fetchMediaOutbound({ url: 'https://cdn.example/a', timeoutMs: 1000 },
      { init: { method: 'CONNECT' } })).rejects.toThrow(/method/);
    await expect(fetchMediaOutbound({ url: 'https://cdn.example/a', timeoutMs: 1000 },
      { init: { body: new Blob(['binary']), method: 'POST' } })).rejects.toThrow(/body/);
    expect(raw).not.toHaveBeenCalled();
  });
  // REGRESSION: fails if fetchMediaOutbound returns a truncated guarded response as successful media bytes.
  it('refuses clipped bytes instead of returning a corrupt artifact', async () => {
    const client: HttpClientPort = { send: async () => ({ status: 200, headers: {},
      bodyText: 'partial', bodyBytes: new Uint8Array([0xff]), bodyBytesTruncated: true }) };
    await expect(fetchMediaOutbound({ url: 'https://cdn.example/a', timeoutMs: 1000 },
      { httpClient: client })).rejects.toThrow(/truncated/);
  });
  // REGRESSION: fails if fetchMediaOutbound omits its default maxResponseBytes policy or totalDeadlineMs.
  it('bounds default media buffering and preserves caller cancellation', async () => {
    testPinnedRequests.length = 0;
    wire('https://cdn.example/a');
    const abort = new AbortController();
    await fetchMediaOutbound({ url: 'https://cdn.example/a', timeoutMs: 1000 }, { init: { signal: abort.signal } });
    expect(testPinnedRequests[0]?.maxResponseBytes).toBe(96 * 1024 * 1024);
    expect(testPinnedRequests[0]?.totalDeadlineMs).toBe(1000);
    abort.abort(new Error('caller stopped'));
    await expect(fetchMediaOutbound({ url: 'https://cdn.example/a', timeoutMs: 1000 },
      { init: { signal: abort.signal } })).rejects.toThrow('caller stopped');
    expect(testPinnedRequests).toHaveLength(1);
  });
  // REGRESSION: fails if validateBaseUrlResolved skips loopback answers or returns ok:true on lookup failure.
  it('fails closed on loopback, mixed answers, empty answers and DNS errors', async () => {
    for (const addresses of [[], [{ address: '127.0.0.1', family: 4 }],
      [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]]) {
      expect((await validateBaseUrlResolved({ baseUrl: 'https://cdn.example/a' }, { lookup: async () => addresses })).ok).toBe(false);
    }
    expect((await validateBaseUrlResolved({ baseUrl: 'https://cdn.example/a' }, { lookup: async () => { throw new Error('DNS unavailable'); } })).ok).toBe(false);
  });
  // REGRESSION: fails if assertAndFetchExternalAsset restores its precheck followed by unpinned fetchWithTimeout.
  it('refuses a provider asset DNS name resolving to private or mixed peers', async () => {
    const raw = wire('https://cdn.example/a');
    for (const address of ['10.0.0.1', '::1', '169.254.169.254']) {
      await expect(assertAndFetchExternalAsset({ url: 'https://cdn.example/a' }, {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address, family: 4 }],
      })).rejects.toThrow(/rejected/);
    }
    expect(raw).not.toHaveBeenCalled();
  });
  // REGRESSION: fails if fetchMediaOutbound ignores allowPrivateNetwork:true or forwards init.redirect.
  it('requires explicit development opt-in and still refuses redirects', async () => {
    const url = 'http://127.0.0.1/asset';
    wire(url);
    await expect(fetchMediaOutbound({ url, timeoutMs: 1000 })).rejects.toThrow(/rejected/);
    expect((await fetchMediaOutbound({ url, timeoutMs: 1000 }, { allowPrivateNetwork: true })).status).toBe(200);
    wire(url, true);
    await expect(fetchMediaOutbound({ url, timeoutMs: 1000 }, { allowPrivateNetwork: true, init: { redirect: 'follow' } })).rejects.toThrow(/redirect/);
  });
  // REGRESSION: fails if the engine drops options.httpClient when constructing RenderContext.
  it('threads the host guard through engine generation and provider asset parsing', async () => {
    wire('https://cdn.example/a');
    const ports = testNodeGuardedHttpPorts();
    const send = vi.fn(createHttpClient({ ...ports, userAgent: 'fixture', policy: {
      allowedSchemes: ['https'], denyPrivateAddresses: true, devHostAllowlist: [], maxRedirects: 0,
      connectTimeoutMs: 600_000, maxResponseBytes: 1024, maxDecompressedBytes: 1024,
    } }).send);
    const engine = createMediaDispatchEngine({}, { httpClient: { send }, credentials: { openai: { apiKey: 'test' } } });
    const result = await engine.generate({ surface: 'image', model: 'dall-e-3' });
    expect(result.bytes).toEqual(Buffer.from([0xff, 0x00, 0x80, 0x42]));
    expect(send.mock.calls.map(([{ request }]) => request.totalDeadlineMs)).toEqual([600_000, 120_000]);
    expect(send.mock.calls.every(([, options]) => options?.redirect === 'error')).toBe(true);
  });
  // REGRESSION: fails if submitAndParse passes the original ctx instead of withRuntimeOutbound({ ctx: params.ctx, deps }).
  it('threads the runtime guard into follow-up parser downloads without exposing persistence ports', async () => {
    wire('https://cdn.example/a');
    const ports = testNodeGuardedHttpPorts();
    const send = vi.fn(createHttpClient({ ...ports, userAgent: 'fixture', policy: {
      allowedSchemes: ['https'], denyPrivateAddresses: true, devHostAllowlist: [], maxRedirects: 0,
      connectTimeoutMs: 600_000, maxResponseBytes: 1024, maxDecompressedBytes: 1024,
    } }).send);
    const outcome = await startOperation({ store: createInMemoryAsyncOperationStore(),
      signer: ({ request }) => ({ url: request.url, init: request.init }),
      adapter: { ...adapter, parseSubmitResponse: async ({ ctx }) => {
        expect(ctx).not.toHaveProperty('store');
        expect(ctx).not.toHaveProperty('signer');
        return { kind: 'complete', result: { providerNote: 'asset', bytes:
          await bytesFromOpenAICompatibleData({ data: { data: [{ url: 'https://cdn.example/a' }] }, providerTag: 'fixture' }, ctx) } };
      } }, ctx: context(), providerId: 'fixture', routeKey: 'image', ownerRef: 'fixture' },
      { httpClient: { send }, graceMs: 1000 });
    expect(outcome.done).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].request.url).toBe('https://cdn.example/a');
  });
  // REGRESSION: fails if performSigned restores deps.fetchImpl or raw fetchWithTimeout for poll calls.
  it('guards signed polling requests as well as submits', async () => {
    const store = createInMemoryAsyncOperationStore();
    await store.create({ id: 'poll', providerId: 'fixture', routeKey: 'image', ownerRef: 'fixture', maxAttempts: 3, deadlineAt: 10_000 }, { nextPollAt: 0 });
    await store.update({ id: 'poll', patch: { status: 'polling', state: { jobId: 'job' } } });
    const raw = wire('http://10.0.0.1/poll');
    const stats = await pollDueOperations({ store, signer: ({ request }) => ({ url: 'http://10.0.0.1/poll', init: request.init }),
      adapters: () => adapter, resolveContext: () => context(), leaseOwner: 'worker', leaseMs: 1000 }, { clock: () => 1 });
    expect(stats.pending).toBe(1);
    expect((await store.get({ id: 'poll' }))?.error?.message).toMatch(/rejected/);
    expect(raw).not.toHaveBeenCalled();
  });
});
