import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from 'openid-client';
import { createDnsPinnedOAuthTransport } from '../src/dns-pinned-transport.js';
import { createOAuthUrlGuard } from '../src/endpoint-safety.js';
import { OAuthError } from '../src/errors.js';
import { createOAuthCustomFetch } from '../src/guarded-transport.js';
import type { OAuthFetch } from '../src/ports.js';
import { createOAuthDispatcherStub } from './dispatcher-stub.js';

const endpoint = 'https://auth.example.com/token';
const responseMessages = {
  overflowMessage: 'response too large', overflowOperatorAction: 'Reduce response size.',
};
const guard = createOAuthUrlGuard({ assertAllowed: () => {} });
const request = (body: client.FetchBody = undefined): client.CustomFetchOptions => ({
  method: body == null ? 'GET' : 'POST', headers: { accept: 'application/json' },
  body, redirect: 'manual',
});
function fixture(fetchFn = vi.fn<OAuthFetch>(async () => Response.json({ scope: 'read' })), maxResponseBytes?: number) {
  const customFetch = createOAuthCustomFetch({
    fetchFn, guard, responseMessages, endpointLabel: 'token endpoint', timeoutMs: 15_000,
  }, maxResponseBytes === undefined ? {} : { maxResponseBytes });
  return { customFetch, fetchFn };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Characterize the existing guard before moving its implementation to the shared response gate.
it('keeps the DNS-pinned redirect error and cancels the body even when cleanup rejects', async () => {
  const cancel = vi.fn(() => { throw new Error('cleanup failed'); });
  const response = new Response(new ReadableStream({ cancel }), { status: 302 });
  const fetchFn = vi.fn<OAuthFetch>(async () => response);
  const transport = createDnsPinnedOAuthTransport({
    guard, fetchFn, dns: { resolve: async () => [] }, addressPolicy: { assertAllowed: () => {} },
    dispatcherFactory: { create: () => ({ dispatcher: createOAuthDispatcherStub({}), close: async () => {} }) },
  });
  try {
    await expect(transport.fetchFn({ url: endpoint })).rejects.toMatchObject({
      code: 'OAUTH_UNSAFE_ENDPOINT', message: 'refusing to follow an OAuth endpoint redirect',
      operatorAction: 'Configure the final HTTPS endpoint directly.', retryable: false,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  } finally { await transport.close({}); }
});

describe('guarded upstream fetch contract', () => {
  it('serializes form bodies without changing repeated resources, headers or the caller options', async () => {
    const { customFetch, fetchFn } = fixture();
    const body = new URLSearchParams({ scope: 'read write', code: randomBytes(16).toString('hex') });
    body.append('resource', 'https://api.example.com/a');
    body.append('resource', 'https://api.example.com/b');
    const options = request(body);
    options.headers['content-type'] = 'application/x-www-form-urlencoded';
    const serialized = body.toString();
    const result = await customFetch(endpoint, options);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]![0]).toEqual({ url: endpoint });
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({
      method: 'POST', headers: options.headers, body: serialized, redirect: 'error',
    });
    expect(new URLSearchParams(String(fetchFn.mock.calls[0]![1]!.body)).getAll('resource'))
      .toEqual(['https://api.example.com/a', 'https://api.example.com/b']);
    expect(options.body).toBe(body);
    expect(body.toString()).toBe(serialized);
    expect(options.redirect).toBe('manual');
    expect(await result.json()).toEqual({ scope: 'read' });
  });

  it.each([undefined, null])('omits an absent body (%s) for string-only host ports', async body => {
    const { customFetch, fetchFn } = fixture();
    await customFetch(endpoint, request(body));
    expect(fetchFn.mock.calls[0]![1]).not.toHaveProperty('body');
  });

  it('retains JSON registration bodies and HTTP error status, headers and body for upstream processing', async () => {
    const response = new Response('{"error":"invalid_client_metadata"}', {
      status: 400, statusText: 'Bad Request', headers: { 'content-type': 'application/json', 'retry-after': '5' },
    });
    const { customFetch, fetchFn } = fixture(vi.fn<OAuthFetch>(async () => response));
    const body = JSON.stringify({ client_name: 'Example Client' });
    const result = await customFetch(endpoint, request(body));
    expect(fetchFn.mock.calls[0]![1]!.body).toBe(body);
    expect(result.status).toBe(400);
    expect(result.statusText).toBe('Bad Request');
    expect(result.headers.get('content-type')).toBe('application/json');
    expect(result.headers.get('retry-after')).toBe('5');
    expect(await result.json()).toEqual({ error: 'invalid_client_metadata' });
  });

  it.each([204, 205])('preserves a bodyless HTTP %s revocation response', async status => {
    const { customFetch } = fixture(vi.fn<OAuthFetch>(async () => new Response(null, { status })));
    const result = await customFetch(endpoint, request());
    expect(result.status).toBe(status);
    expect(result.body).toBeNull();
    expect(await result.text()).toBe('');
  });

  it('rejects an unsafe derived endpoint before HTTP and retains the endpoint label', async () => {
    const { customFetch, fetchFn } = fixture();
    await expect(customFetch('http://auth.example.com/jwks', request())).rejects.toMatchObject({
      code: 'OAUTH_UNSAFE_ENDPOINT',
      message: 'token endpoint: provider endpoint must use https (http is permitted only for loopback)',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses the exact URL returned by the guard and preserves host policy errors', async () => {
    const fetchFn = vi.fn<OAuthFetch>(async () => Response.json({}));
    const failure = new OAuthError({ code: 'OAUTH_UNSAFE_ENDPOINT', message: 'blocked', operatorAction: 'Check policy.' });
    const assertSafeUrl = vi.fn(() => new URL('https://auth.example.com/checked'));
    const customFetch = createOAuthCustomFetch({
      fetchFn, guard: { assertSafeUrl }, responseMessages, endpointLabel: 'JWKS endpoint', timeoutMs: 10_000,
    });
    await customFetch(endpoint, request());
    expect(assertSafeUrl).toHaveBeenCalledWith({ raw: endpoint, label: 'JWKS endpoint' });
    expect(fetchFn.mock.calls[0]![0]).toEqual({ url: 'https://auth.example.com/checked' });
    assertSafeUrl.mockImplementation(() => { throw failure; });
    await expect(customFetch(endpoint, request())).rejects.toBe(failure);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([300, 301, 302, 303, 304, 307, 308])('refuses HTTP %s even if an injected port ignores redirect refusal', async status => {
    const { customFetch, fetchFn } = fixture(vi.fn<OAuthFetch>(async () => new Response(null, { status })));
    await expect(customFetch(endpoint, request())).rejects.toMatchObject({ code: 'OAUTH_UNSAFE_ENDPOINT' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]![1]!.redirect).toBe('error');
  });

  it('refuses and cancels an opaque redirect response', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
    const { customFetch } = fixture(vi.fn<OAuthFetch>(async () => response));
    await expect(customFetch(endpoint, request())).rejects.toMatchObject({ code: 'OAUTH_UNSAFE_ENDPOINT' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('accepts exactly 64 KiB and refuses one extra byte before handing the body to upstream', async () => {
    const { customFetch } = fixture(vi.fn<OAuthFetch>(async () => new Response('x'.repeat(65_536))));
    expect(await (await customFetch(endpoint, request())).text()).toBe('x'.repeat(65_536));
    const oversized = fixture(vi.fn<OAuthFetch>(async () => new Response('x'.repeat(65_537))));
    await expect(oversized.customFetch(endpoint, request())).rejects.toMatchObject({
      code: 'OAUTH_MALFORMED_RESPONSE', message: responseMessages.overflowMessage,
      operatorAction: responseMessages.overflowOperatorAction,
    });
  });

  it('counts streamed UTF-8 bytes with the operation cap and preserves overflow on failed cleanup', async () => {
    const cancel = vi.fn(() => { throw new Error('cleanup failed'); });
    let pulls = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(Buffer.from('éé')); }, cancel,
    }, { highWaterMark: 0 }));
    const { customFetch } = fixture(vi.fn<OAuthFetch>(async () => response), 3);
    await expect(customFetch(endpoint, request())).rejects.toMatchObject({
      code: 'OAUTH_MALFORMED_RESPONSE', message: responseMessages.overflowMessage,
    });
    expect(pulls).toBe(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('retains the caller abort and the configured deadline signal', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const caller = new AbortController();
    const { customFetch, fetchFn } = fixture();
    await customFetch(endpoint, { ...request(), signal: caller.signal });
    const signal = fetchFn.mock.calls[0]![1]!.signal!;
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(signal.aborted).toBe(false);
    caller.abort();
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(caller.signal.reason);
  });

  it('stops a stalled body on its deadline after the headers have arrived', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    let beginRead!: () => void;
    const reading = new Promise<void>(resolve => { beginRead = resolve; });
    const fetchFn = vi.fn<OAuthFetch>(async (_required, init) => new Response(new ReadableStream({
      start(controller) {
        init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason), { once: true });
      },
      pull() { beginRead(); },
    }, { highWaterMark: 0 })));
    const { customFetch } = fixture(fetchFn);
    const failure = new DOMException('request deadline reached', 'TimeoutError');
    const rejected = expect(customFetch(endpoint, request())).rejects.toBe(failure);
    await reading;
    deadline.abort(failure);
    await rejected;
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refuses a previously cancelled request before HTTP', async () => {
    const { customFetch, fetchFn } = fixture();
    const caller = new AbortController();
    caller.abort();
    await expect(customFetch(endpoint, { ...request(), signal: caller.signal })).rejects.toBe(caller.signal.reason);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not retry or replace a host transport failure', async () => {
    const failure = new Error('network failure');
    const { customFetch, fetchFn } = fixture(vi.fn<OAuthFetch>(async () => { throw failure; }));
    await expect(customFetch(endpoint, request())).rejects.toBe(failure);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([new Uint8Array([1]), new ArrayBuffer(1), new ReadableStream()])('refuses unsupported binary or streaming uploads before HTTP', async body => {
    const { customFetch, fetchFn } = fixture();
    await expect(customFetch(endpoint, request(body))).rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('wires real openid-client discovery and revocation through the host dispatcher without a global fetch fallback', async () => {
    const globalFetch = vi.fn(() => { throw new Error('unguarded fetch'); });
    vi.stubGlobal('fetch', globalFetch);
    const issuer = 'https://auth.example.com';
    const revocationEndpoint = `${issuer}/revoke`;
    const fetchFn = vi.fn<OAuthFetch>(async ({ url }, init) => {
      if (String(url) === revocationEndpoint) {
        // Model Tovu's string-only port: accepting URLSearchParams here would hide an ABI regression.
        if (typeof init?.body !== 'string') throw new TypeError('OAuth request body must be a string');
        return new Response(null);
      }
      return Response.json({ issuer, token_endpoint: endpoint, revocation_endpoint: revocationEndpoint });
    });
    const dispatcher = createOAuthDispatcherStub({});
    const transport = createDnsPinnedOAuthTransport({
      guard, fetchFn, dns: { resolve: async () => [] }, addressPolicy: { assertAllowed: () => {} },
      dispatcherFactory: { create: () => ({ dispatcher, close: async () => {} }) },
    });
    try {
      const customFetch = createOAuthCustomFetch({
        ...transport, responseMessages, endpointLabel: 'OAuth metadata endpoint', timeoutMs: 10_000,
      });
      const config = await client.discovery(new URL(issuer), 'example-client', undefined, undefined, {
        [client.customFetch]: customFetch,
      });
      expect(config.serverMetadata()).toMatchObject({ issuer, token_endpoint: endpoint });
      expect(config[client.customFetch]).toBe(customFetch);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn.mock.calls[0]![0]).toEqual({ url: `${issuer}/.well-known/openid-configuration` });
      expect(fetchFn.mock.calls[0]![1]).toMatchObject({ method: 'GET', redirect: 'error', dispatcher });
      const token = randomBytes(16).toString('hex');
      await client.tokenRevocation(config, token);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(fetchFn.mock.calls[1]![0]).toEqual({ url: revocationEndpoint });
      expect(fetchFn.mock.calls[1]![1]).toMatchObject({ method: 'POST', redirect: 'error', dispatcher });
      expect(Object.fromEntries(new URLSearchParams(String(fetchFn.mock.calls[1]![1]!.body))))
        .toEqual({ client_id: 'example-client', token });
      expect(globalFetch).not.toHaveBeenCalled();
    } finally { await transport.close({}); }
  });
});
