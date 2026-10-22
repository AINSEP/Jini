import { describe, expect, it, vi } from 'vitest';
import { AdminApiError, describeApiError } from '../transport/errors.js';
import { createAdminClient, createHttpTransport } from '../transport/http.js';
import type { AdminTransport } from '../transport/types.js';

type FetchImpl = (requiredArgs: { url: string }, optionalArgs?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** The `RequestInit` the spy was last called with. Throws rather than returning a default, so a
 *  test that never triggered a request fails on the missing call instead of on the assertion. */
function lastInit(spy: { mock: { calls: Array<[{ url: string }, (RequestInit | undefined)?]> } }): RequestInit {
  const call = spy.mock.calls.at(-1);
  if (!call) throw new Error('fetch was never called');
  return call[1] ?? {};
}

function lastHeaders(spy: { mock: { calls: Array<[{ url: string }, (RequestInit | undefined)?]> } }): Headers {
  return new Headers(lastInit(spy).headers);
}

describe('createHttpTransport', () => {
  it('prefixes the base URL', async () => {
    const fetchSpy = vi.fn<FetchImpl>(async () => jsonResponse({ ok: true }));
    const transport = createHttpTransport({ baseUrl: '/api/admin/v1', fetch: fetchSpy });
    await transport.request({ path: '/users' });
    expect(fetchSpy.mock.calls.at(-1)?.[0].url).toBe('/api/admin/v1/users');
  });

  it('applies the JSON content type by default', async () => {
    const fetchSpy = vi.fn<FetchImpl>(async () => jsonResponse({}));
    await createHttpTransport({ baseUrl: '', fetch: fetchSpy }).request({ path: '/x' });
    expect(lastHeaders(fetchSpy).get('Content-Type')).toBe('application/json');
  });

  it('keeps the JSON default when a call passes unrelated headers', async () => {
    // The ported original spread `...init` last, so a per-call `headers` replaced the default
    // wholesale instead of merging. This is the regression guard for that.
    const fetchSpy = vi.fn<FetchImpl>(async () => jsonResponse({}));
    await createHttpTransport({ baseUrl: '', fetch: fetchSpy }).request({ path: '/x' }, {
      headers: { 'X-Trace': 'abc' },
    });
    expect(lastHeaders(fetchSpy).get('Content-Type')).toBe('application/json');
    expect(lastHeaders(fetchSpy).get('X-Trace')).toBe('abc');
  });

  it('lets a per-call header override the transport default', async () => {
    const fetchSpy = vi.fn<FetchImpl>(async () => jsonResponse({}));
    await createHttpTransport({ baseUrl: '', fetch: fetchSpy }, { headers: { Authorization: 'Bearer base' } }).request({ path: '/x' }, { headers: { Authorization: 'Bearer call' } });
    expect(lastHeaders(fetchSpy).get('Authorization')).toBe('Bearer call');
  });

  it('defaults credentials to same-origin and allows an override', async () => {
    const fetchSpy = vi.fn<FetchImpl>(async () => jsonResponse({}));
    await createHttpTransport({ baseUrl: '', fetch: fetchSpy }).request({ path: '/x' });
    expect(lastInit(fetchSpy).credentials).toBe('same-origin');

    const omitSpy = vi.fn<FetchImpl>(async () => jsonResponse({}));
    await createHttpTransport({ baseUrl: '', fetch: omitSpy }, { credentials: 'omit' }).request({ path: '/x' });
    expect(lastInit(omitSpy).credentials).toBe('omit');
  });

  it('returns the parsed body on success', async () => {
    const transport = createHttpTransport({ baseUrl: '', fetch: async () => jsonResponse({ users: [{ id: 'u1' }] }) });
    await expect(transport.request({ path: '/users' })).resolves.toEqual({ users: [{ id: 'u1' }] });
  });

  it('throws AdminApiError carrying status, code and raw body', async () => {
    const transport = createHttpTransport({ baseUrl: '', fetch: async () => jsonResponse({ error: 'nope', code: 'FORBIDDEN', detail: 'x' }, 403) });
    await expect(transport.request({ path: '/x' })).rejects.toMatchObject({
      message: 'nope',
      status: 403,
      code: 'FORBIDDEN',
      body: { error: 'nope', code: 'FORBIDDEN', detail: 'x' },
    });
  });

  it('synthesizes a message when the error body has none', async () => {
    const transport = createHttpTransport({ baseUrl: '', fetch: async () => jsonResponse({}, 500) });
    await expect(transport.request({ path: '/x' })).rejects.toThrow('request failed (500)');
  });

  it('treats an unparseable success body as empty rather than failing', async () => {
    // A 204 has no body; that is a successful mutation, not a parse error.
    const transport = createHttpTransport({ baseUrl: '', fetch: async () =>
        ({
          ok: true,
          status: 204,
          json: async () => {
            throw new SyntaxError('Unexpected end of JSON input');
          },
        }) as unknown as Response });
    await expect(transport.request({ path: '/x' })).resolves.toEqual({});
  });

  it('omits code when the server sent a non-string one', async () => {
    const transport = createHttpTransport({ baseUrl: '', fetch: async () => jsonResponse({ error: 'bad', code: 42 }, 400) });
    await expect(transport.request({ path: '/x' })).rejects.toMatchObject({ code: undefined });
  });
});

describe('describeApiError', () => {
  it('prefers the server message', () => {
    expect(describeApiError({ e: new AdminApiError({ message: 'server said no', status: 400 }), fallback: 'fallback' })).toBe('server said no');
  });

  it('falls back when the server message is empty', () => {
    expect(describeApiError({ e: new AdminApiError({ message: '', status: 400 }), fallback: 'fallback' })).toBe('fallback');
  });

  it('uses a plain Error message', () => {
    expect(describeApiError({ e: new Error('network down'), fallback: 'fallback' })).toBe('network down');
  });

  it('falls back for a thrown non-Error', () => {
    expect(describeApiError({ e: 'a string', fallback: 'fallback' })).toBe('fallback');
  });
});

describe('createAdminClient', () => {
  const transport: AdminTransport = { request: async () => ({}) as never };

  it('composes Jini-shipped and host-owned route groups into one object', () => {
    const client = createAdminClient({ transport: transport, groups: {
      identity: ({ transport: t }) => ({ listUsers: () => t.request<string[]>({ path: '/users' }) }),
      posts: ({ transport: t }) => ({ list: () => t.request<string[]>({ path: '/posts' }) }),
    } });
    expect(typeof client.identity.listUsers).toBe('function');
    expect(typeof client.posts.list).toBe('function');
  });

  it('exposes the transport for routes nobody wrapped in a group', () => {
    expect(createAdminClient({ transport: transport, groups: {} }).transport).toBe(transport);
  });

  it('rejects a group named "transport" rather than silently shadowing the escape hatch', () => {
    expect(() => createAdminClient({ transport: transport, groups: { transport: () => ({}) } })).toThrow(
      /reserved route-group name/,
    );
  });

  it('hands every group the same transport instance', () => {
    const seen: AdminTransport[] = [];
    createAdminClient({ transport: transport, groups: {
      a: ({ transport: t }) => {
        seen.push(t);
        return {};
      },
      b: ({ transport: t }) => {
        seen.push(t);
        return {};
      },
    } });
    expect(seen).toEqual([transport, transport]);
  });
});
