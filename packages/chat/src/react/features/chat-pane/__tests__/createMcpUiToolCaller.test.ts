/**
 * Sibling of `createDaemonAttachmentUploader.test.ts` — same shape (a fetch-mocking suite for a
 * "host supplies a base URL, not a transport" factory), applied to the other half of the MCP-UI
 * confirmation pattern: `createMcpUiToolCaller` relays a View's `tools/call` to a host-authenticated
 * HTTP endpoint. No prior coverage existed for this module before this file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpUiToolCaller } from '../create-mcp-ui-tool-caller.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Verified empirically (not assumed) that jsdom's own `DOMException` — including a real
 * `AbortController`'s `signal.reason` — does NOT chain to `instanceof Error` in this vitest+jsdom
 * environment (`new AbortController().signal.reason instanceof Error` is `false` here, though
 * `.name` is correctly `'AbortError'`). A real browser's `DOMException` does extend `Error`; this is
 * a known jsdom cross-realm gap, not a bug in the source under test. A plain `Error` with `.name`
 * overridden to `'AbortError'` is `instanceof Error` unambiguously in every realm, so it exercises
 * the source's `error instanceof Error && error.name === 'AbortError'` guard the way a real
 * browser's abort would, without inheriting jsdom's gap.
 */
function fakeAbortError(): Error {
  return Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}

describe('createMcpUiToolCaller', () => {
  it('posts {toolName, params} derived from the View\'s {name, arguments} call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ deleted: true }));
    globalThis.fetch = fetchMock;
    const call = createMcpUiToolCaller('');

    await call({ name: 'content_post_delete', arguments: { id: 'post-1', confirmationToken: 'tok' } });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/mcp-ui/tool-calls',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toolName: 'content_post_delete', params: { id: 'post-1', confirmationToken: 'tok' } }),
      }),
    );
  });

  it('copies arguments into a fresh object rather than aliasing the View-supplied one', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}));
    const call = createMcpUiToolCaller('');
    const args = { id: 'post-1' };

    await call({ name: 'content_post_delete', arguments: args });

    const sentBody = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string) as {
      params: unknown;
    };
    expect(sentBody.params).toEqual(args);
    expect(sentBody.params).not.toBe(args);
  });

  it('defaults to /api/mcp-ui/tool-calls and honors a caller-supplied path — required when the host mounts it behind an authenticated admin API', async () => {
    // `.mockImplementation`, not `.mockResolvedValue`: this test calls `fetch` twice, and a `Response`
    // body can only be read once — reusing one instance across both calls throws "Body has already
    // been read" on the second `.text()`.
    globalThis.fetch = vi.fn().mockImplementation(() => jsonResponse({}));

    await createMcpUiToolCaller('')({ name: 'content_post_delete', arguments: {} });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('/api/mcp-ui/tool-calls');

    await createMcpUiToolCaller('', { path: '/api/admin/v1/mcp-ui/tool-calls' })({ name: 'content_post_delete', arguments: {} });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]).toBe('/api/admin/v1/mcp-ui/tool-calls');
  });

  it('targets a same-origin path when the base URL is empty, and tolerates a trailing slash on a real origin', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => jsonResponse({}));

    await createMcpUiToolCaller('')({ name: 'x', arguments: {} });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('/api/mcp-ui/tool-calls');

    await createMcpUiToolCaller('http://127.0.0.1:4317/')({ name: 'x', arguments: {} });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]).toBe('http://127.0.0.1:4317/api/mcp-ui/tool-calls');
  });

  it('merges caller-supplied headers but never lets them override content-type', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}));

    await createMcpUiToolCaller('', { headers: { 'x-csrf-token': 'abc', 'content-type': 'text/plain' } })({
      name: 'x',
      arguments: {},
    });

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers).toEqual({
      'x-csrf-token': 'abc',
      'content-type': 'application/json',
    });
  });

  it('returns the parsed JSON response on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ deleted: true, cancelled: false }));

    await expect(createMcpUiToolCaller('')({ name: 'content_post_delete', arguments: {} })).resolves.toEqual({
      deleted: true,
      cancelled: false,
    });
  });

  it('returns raw text when a successful response body is not valid JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    await expect(createMcpUiToolCaller('')({ name: 'x', arguments: {} })).resolves.toBe('ok');
  });

  it('resolves to an empty string for an empty successful body (e.g. 204) rather than throwing on the empty JSON parse', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(createMcpUiToolCaller('')({ name: 'x', arguments: {} })).resolves.toBe('');
  });

  it('rejects with the server\'s own message from a {error} envelope — the shape this endpoint uses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'this confirmation has expired', code: 'TOOL_CALL_FAILED' }, 400),
    );

    await expect(createMcpUiToolCaller('')({ name: 'content_post_delete', arguments: {} })).rejects.toThrow(
      'this confirmation has expired',
    );
  });

  it('also accepts a bare {message} envelope', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ message: 'Not authorized' }, 403));

    await expect(createMcpUiToolCaller('')({ name: 'x', arguments: {} })).rejects.toThrow('Not authorized');
  });

  it('surfaces a non-JSON rejection body verbatim rather than a generic status message — a proxy error page is more useful than "invalid JSON"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    await expect(createMcpUiToolCaller('')({ name: 'x', arguments: {} })).rejects.toThrow('<html>502</html>');
  });

  it('falls back to a status-coded message only when the rejection body is empty', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 502 }));

    await expect(createMcpUiToolCaller('')({ name: 'x', arguments: {} })).rejects.toThrow(
      'Request failed with status 502.',
    );
  });

  it('falls back to a status-coded message when the rejection body is JSON with neither envelope field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ unrelated: true }, 500));

    await expect(createMcpUiToolCaller('')({ name: 'x', arguments: {} })).rejects.toThrow(
      'Request failed with status 500.',
    );
  });

  it('rejects with a timeout error once the deadline passes, and never resolves the caller\'s own promise from the hung request', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(fakeAbortError());
        });
      })) as unknown as typeof fetch;

    const pending = createMcpUiToolCaller('', { timeoutMs: 5_000 })({ name: 'x', arguments: {} });
    const rejects = expect(pending).rejects.toThrow('Timed out after 5000ms waiting for the server.');

    await vi.advanceTimersByTimeAsync(5_000);

    await rejects;
  });

  it('defaults the timeout to 30s', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(fakeAbortError());
        });
      })) as unknown as typeof fetch;

    const pending = createMcpUiToolCaller('')({ name: 'x', arguments: {} });
    const rejects = expect(pending).rejects.toThrow('Timed out after 30000ms waiting for the server.');

    await vi.advanceTimersByTimeAsync(30_000);

    await rejects;
  });

  it('propagates a non-abort network failure unchanged', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(createMcpUiToolCaller('')({ name: 'x', arguments: {} })).rejects.toThrow('network down');
  });
});
