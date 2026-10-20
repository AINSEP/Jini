import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpClientPort, HttpRequest } from '@jini-ai/core/primitives';
import type { DnsResolver } from '@jini-ai/platform/http/guarded';
import { defaultMediaOutboundMessages, fetchMediaOutbound } from '../outbound.js';
import { testPinnedRequests } from './outbound-fixtures.js';

// The default (no httpClient) path builds a real policy client; swap only its transport ports for the
// deterministic fixture so the real guard policy still runs.
vi.mock('@jini-ai/platform/http/guarded', async (importOriginal) => {
  const original = await importOriginal<typeof import('@jini-ai/platform/http/guarded')>();
  const { testNodeGuardedHttpPorts } = await import('./outbound-fixtures.js');
  return { ...original, createNodeGuardedHttpPorts: testNodeGuardedHttpPorts };
});

afterEach(() => { vi.unstubAllGlobals(); testPinnedRequests.length = 0; });

const URL_A = 'https://cdn.example/a';

type Sent = { request: HttpRequest; redirect: RequestInit['redirect'] };

function recordingClient(): { client: HttpClientPort; sent: Sent[] } {
  const sent: Sent[] = [];
  const client: HttpClientPort = {
    send: async ({ request }, optional) => {
      sent.push({ request, redirect: optional?.redirect });
      return { status: 200, headers: {}, bodyText: 'ok' };
    },
  };
  return { client, sent };
}

function withDispatcher(init: RequestInit, value: unknown): RequestInit {
  // `dispatcher` is an undici extension absent from the DOM RequestInit type.
  Object.defineProperty(init, 'dispatcher', { value, enumerable: true });
  return init;
}

describe('fetchMediaOutbound wire request validation', () => {
  it('defaults the method to GET', async () => {
    const { client, sent } = recordingClient();
    await fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client });
    expect(sent[0]?.request.method).toBe('GET');
  });

  it('upper-cases a lower-case method', async () => {
    const { client, sent } = recordingClient();
    await fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client, init: { method: 'post' } });
    expect(sent[0]?.request.method).toBe('POST');
  });

  it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])('accepts the %s method', async (method) => {
    const { client, sent } = recordingClient();
    await fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client, init: { method } });
    expect(sent[0]?.request.method).toBe(method);
  });

  it.each(['OPTIONS', 'TRACE', 'CONNECT', ''])('refuses the %j method before I/O', async (method) => {
    const { client, sent } = recordingClient();
    await expect(fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client, init: { method } }))
      .rejects.toThrow(new TypeError('Unsupported media HTTP method'));
    expect(sent).toHaveLength(0);
  });

  it('refuses a dispatcher override before I/O', async () => {
    const { client, sent } = recordingClient();
    await expect(fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client, init: withDispatcher({}, {}) }))
      .rejects.toThrow(new TypeError('Configure media connection pooling on the guarded HTTP client'));
    expect(sent).toHaveLength(0);
  });

  it('refuses even a null dispatcher (only an absent one passes)', async () => {
    const { client } = recordingClient();
    await expect(fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client, init: withDispatcher({}, null) }))
      .rejects.toThrow(new TypeError(defaultMediaOutboundMessages.dispatcherRefused));
  });

  it('checks the dispatcher before the method', async () => {
    const { client } = recordingClient();
    await expect(fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, {
      httpClient: client, init: withDispatcher({ method: 'TRACE' }, {}),
    })).rejects.toThrow(new TypeError(defaultMediaOutboundMessages.dispatcherRefused));
  });

  it('checks the method before the body', async () => {
    const { client } = recordingClient();
    await expect(fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, {
      httpClient: client, init: { method: 'TRACE', body: new Blob(['x']) },
    })).rejects.toThrow(new TypeError(defaultMediaOutboundMessages.unsupportedMethod));
  });

  it.each([
    ['Blob', () => new Blob(['x'])],
    ['ArrayBuffer', () => new ArrayBuffer(2)],
    ['Uint8Array', () => new Uint8Array([1])],
    ['FormData', () => new FormData()],
  ])('refuses a %s body before I/O', async (_name, makeBody) => {
    const { client, sent } = recordingClient();
    await expect(fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, {
      httpClient: client, init: { method: 'POST', body: makeBody() },
    })).rejects.toThrow(new TypeError('Media HTTP body must be a string or URLSearchParams'));
    expect(sent).toHaveLength(0);
  });

  it('forwards a string body', async () => {
    const { client, sent } = recordingClient();
    await fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client, init: { method: 'POST', body: '{"a":1}' } });
    expect(sent[0]?.request.body).toBe('{"a":1}');
  });

  it('forwards an empty string body', async () => {
    const { client, sent } = recordingClient();
    await fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client, init: { method: 'POST', body: '' } });
    expect(sent[0]?.request.body).toBe('');
  });

  it('forwards a URLSearchParams body in its serialized form', async () => {
    const { client, sent } = recordingClient();
    await fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, {
      httpClient: client, init: { method: 'POST', body: new URLSearchParams({ a: '1', b: 'x y' }) },
    });
    expect(sent[0]?.request.body).toBe('a=1&b=x+y');
  });

  it('omits a null body', async () => {
    const { client, sent } = recordingClient();
    await fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client, init: { method: 'POST', body: null } });
    expect(sent[0]?.request).not.toHaveProperty('body');
  });

  it('applies caller message overrides and keeps the defaults for the rest', async () => {
    const { client } = recordingClient();
    const outboundMessages = { unsupportedMethod: 'custom method' };
    await expect(fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client, outboundMessages, init: { method: 'TRACE' } }))
      .rejects.toThrow(new TypeError('custom method'));
    await expect(fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, {
      httpClient: client, outboundMessages, init: { method: 'POST', body: new Blob(['x']) },
    })).rejects.toThrow(new TypeError(defaultMediaOutboundMessages.unsupportedBody));
  });
});

describe('fetchMediaOutbound forwarding to the guarded client', () => {
  it('forwards headers, signal, url and the timeout as both timeoutMs and totalDeadlineMs', async () => {
    const { client, sent } = recordingClient();
    const signal = new AbortController().signal;
    await fetchMediaOutbound({ url: URL_A, timeoutMs: 750 }, { httpClient: client, init: { headers: { 'X-Key': 'v' }, signal } });
    expect(sent[0]?.request).toMatchObject({ url: URL_A, timeoutMs: 750, totalDeadlineMs: 750, headers: { 'x-key': 'v' }, signal });
  });

  it('sends empty headers and no signal when the init has none', async () => {
    const { client, sent } = recordingClient();
    await fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client, init: { signal: null } });
    expect(sent[0]?.request.headers).toEqual({});
    expect(sent[0]?.request).not.toHaveProperty('signal');
  });

  it('always asks the client to refuse redirects, ignoring init.redirect', async () => {
    const { client, sent } = recordingClient();
    await fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client, init: { redirect: 'follow' } });
    expect(sent[0]?.redirect).toBe('error');
  });

  it('returns the guarded response', async () => {
    const { client } = recordingClient();
    const response = await fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { httpClient: client });
    expect(await response.text()).toBe('ok');
  });
});

describe('fetchMediaOutbound default policy client', () => {
  function stubFetchOk() {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bytes')));
  }
  const privateDns: DnsResolver = { resolve: async () => ['10.0.0.5'] };

  it('fetches a public https URL with the 96 MiB response bound', async () => {
    stubFetchOk();
    const response = await fetchMediaOutbound({ url: URL_A, timeoutMs: 500 });
    expect(await response.text()).toBe('bytes');
    expect(testPinnedRequests[0]?.maxResponseBytes).toBe(96 * 1024 * 1024);
  });

  it('refuses a non-http scheme', async () => {
    stubFetchOk();
    await expect(fetchMediaOutbound({ url: 'ftp://cdn.example/a', timeoutMs: 500 })).rejects.toThrow(/scheme/i);
    expect(testPinnedRequests).toHaveLength(0);
  });

  it('uses an injected DNS resolver and refuses its private answer by default', async () => {
    stubFetchOk();
    await expect(fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { dns: privateDns })).rejects.toThrow(/rejected/);
    expect(testPinnedRequests).toHaveLength(0);
  });

  it('allows a private answer only with allowPrivateNetwork: true', async () => {
    stubFetchOk();
    const response = await fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { dns: privateDns, allowPrivateNetwork: true });
    expect(response.status).toBe(200);
  });

  it('treats a non-true allowPrivateNetwork as denied', async () => {
    stubFetchOk();
    await expect(fetchMediaOutbound({ url: URL_A, timeoutMs: 500 }, { dns: privateDns, allowPrivateNetwork: false })).rejects.toThrow(/rejected/);
  });

  it('ignores allowPrivateNetwork and dns when the host injects its own client', async () => {
    const { client, sent } = recordingClient();
    await fetchMediaOutbound({ url: 'http://127.0.0.1/a', timeoutMs: 500 }, { httpClient: client, dns: privateDns, allowPrivateNetwork: false });
    expect(sent).toHaveLength(1);
    expect(testPinnedRequests).toHaveLength(0);
  });
});
