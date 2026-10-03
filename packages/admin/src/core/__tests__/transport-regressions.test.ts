import { afterEach, expect, it, vi } from 'vitest';
import { AdminApiError } from '../transport/errors.js';
import { createHttpTransport, type AdminFetch } from '../transport/http.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([undefined, 1250])('bounds requests with a default or configured timeout (%s)', async (timeoutMs) => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    setTimeout(() => controller.abort(new DOMException('deadline reached', 'TimeoutError')), ms);
    return controller.signal;
  });
  const fetch: AdminFetch = async (_args, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init?.signal?.reason), { once: true });
  });
  const transport = createHttpTransport({ baseUrl: '/api', fetch }, timeoutMs === undefined ? {} : { timeoutMs });
  const outcome = transport.request({ path: '/slow' }).catch((error: unknown) => error);
  const limit = timeoutMs ?? 60_000;
  expect(timeout).toHaveBeenCalledWith(limit);
  await vi.advanceTimersByTimeAsync(limit);
  const error = await outcome;
  expect(error).toBeInstanceOf(AdminApiError);
  expect(error).toMatchObject({ status: 0, code: 'REQUEST_TIMEOUT' });
  expect((error as AdminApiError).message).toContain(`${limit / 1000}s`);
});

it('honors caller cancellation without replacing its signal or translating its error', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const controller = new AbortController();
  const cause = new DOMException('operator cancelled', 'AbortError');
  const fetch = vi.fn<AdminFetch>(async () => { throw cause; });
  const transport = createHttpTransport({ baseUrl: '/api', fetch });
  await expect(transport.request({ path: '/x' }, { signal: controller.signal })).rejects.toBe(cause);
  expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  expect(timeout).not.toHaveBeenCalled();
});

it('translates network failures into typed reachability errors and keeps the original cause', async () => {
  const transport = createHttpTransport({ baseUrl: '/api', fetch: async () => { throw new TypeError('Failed to fetch'); } });
  const error = await transport.request({ path: '/x' }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(AdminApiError);
  expect(error).toMatchObject({ status: 0, code: 'API_UNREACHABLE', body: { cause: 'Failed to fetch' } });
  expect((error as AdminApiError).message).toBe('cannot reach the API — is the server running?');
});

it('recognizes a timeout from another realm by name', async () => {
  const cause = { name: 'TimeoutError', toString: () => 'TimeoutError: deadline reached' };
  const transport = createHttpTransport({ baseUrl: '/api', fetch: async () => { throw cause; } });
  await expect(transport.request({ path: '/x' })).rejects.toMatchObject({
    status: 0, code: 'REQUEST_TIMEOUT', body: { cause: 'TimeoutError: deadline reached' },
  });
});

it('keeps unrelated fetch failures unchanged', async () => {
  const cause = new Error('adapter bug');
  const transport = createHttpTransport({ baseUrl: '/api', fetch: async () => { throw cause; } });
  await expect(transport.request({ path: '/x' })).rejects.toBe(cause);
});

it('treats a network rejection during host page unload as cancellation', async () => {
  const transport = createHttpTransport({ baseUrl: '/api', fetch: async () => { throw new TypeError('Failed to fetch'); } }, {
    isPageUnloading: () => true,
  });
  await expect(transport.request({ path: '/x' })).rejects.toMatchObject({ name: 'AbortError' });
});

it.each([500, 502, 503, 504])('classifies an unparseable %s response as API_UNREACHABLE', async (status) => {
  const transport = createHttpTransport({ baseUrl: '/api', fetch: async () => new Response('<h1>Bad gateway</h1>', { status }) });
  const error = await transport.request({ path: '/x' }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(AdminApiError);
  expect(error).toMatchObject({ status, code: 'API_UNREACHABLE', body: {} });
  expect((error as AdminApiError).message).toBe(`cannot reach the API (HTTP ${status}) — is the server running?`);
});

it.each([null, {}, { error: 'busy', code: 'BUSY' }])('preserves application error envelopes, including %s', async (body: { error?: string; code?: string } | null) => {
  const transport = createHttpTransport({ baseUrl: '/api', fetch: async () => new Response(JSON.stringify(body), { status: 503 }) });
  await expect(transport.request({ path: '/x' })).rejects.toMatchObject({
    status: 503, body, code: body?.code, message: body?.error ?? 'request failed (503)',
  });
});

it('does not classify an unparseable client error as a proxy failure', async () => {
  const transport = createHttpTransport({ baseUrl: '/api', fetch: async () => new Response('Not found', { status: 404 }) });
  await expect(transport.request({ path: '/x' })).rejects.toMatchObject({ status: 404, code: undefined, message: 'request failed (404)' });
});

it('exposes success headers for an ETag / If-Match round trip without changing returned bodies', async () => {
  const fetch = vi.fn<AdminFetch>()
    .mockResolvedValueOnce(new Response('{"contents":"first"}', { headers: { ETag: '"v1"' } }))
    .mockResolvedValueOnce(new Response('{"contents":"next"}', { headers: { ETag: '"v2"' } }));
  const transport = createHttpTransport({ baseUrl: '/api', fetch });
  let etag: string | null = null;
  const onOk = vi.fn(({ response }: { response: Response }) => { etag = response.headers.get('ETag'); });
  await expect(transport.request({ path: '/document' }, { onOk })).resolves.toEqual({ contents: 'first' });
  expect(etag).toBe('"v1"');
  expect(onOk).toHaveBeenCalledTimes(1);
  await expect(transport.request({ path: '/document' }, { method: 'PUT', headers: { 'If-Match': etag! }, onOk })).resolves.toEqual({ contents: 'next' });
  const sentHeaders = new Headers(fetch.mock.calls[1]?.[1]?.headers);
  expect(sentHeaders.get('Content-Type')).toBe('application/json');
  expect(sentHeaders.get('If-Match')).toBe('"v1"');
  expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('onOk');
  expect(etag).toBe('"v2"');
});

it('calls the success observer for a bodyless mutation and never for errors', async () => {
  const fetch = vi.fn<AdminFetch>()
    .mockResolvedValueOnce(new Response(null, { status: 204, headers: { ETag: '"v3"' } }))
    .mockResolvedValueOnce(new Response('{"error":"stale"}', { status: 412 }));
  const transport = createHttpTransport({ baseUrl: '/api', fetch });
  const onOk = vi.fn();
  await expect(transport.request({ path: '/document' }, { onOk })).resolves.toEqual({});
  expect(onOk.mock.calls[0]?.[0].response.headers.get('ETag')).toBe('"v3"');
  await expect(transport.request({ path: '/document' }, { onOk })).rejects.toBeInstanceOf(AdminApiError);
  expect(onOk).toHaveBeenCalledTimes(1);
});
