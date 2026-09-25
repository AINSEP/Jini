import { describe, expect, it, vi } from 'vitest';
import { DaemonResponseTooLargeError, getDaemonJson, postDaemonJson } from '../daemon-client.js';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null } as unknown as Headers,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function streamResponse(status: number, chunks: readonly Uint8Array[], headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    body: stream,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } as unknown as Headers,
    text: async () => { throw new Error('should not be called: streamResponse has a body reader'); },
  } as unknown as Response;
}

describe('getDaemonJson / postDaemonJson', () => {
  it('defaults fetchImpl to the global fetch when omitted', async () => {
    const spy = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      streamResponse(200, [new TextEncoder().encode(JSON.stringify({ ok: true }))]));
    vi.stubGlobal('fetch', spy);
    try {
      const data = await getDaemonJson('http://d.example', '/api/x');
      expect(data).toEqual({ ok: true });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('GETs and returns the parsed JSON body on a 2xx response', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      streamResponse(200, [new TextEncoder().encode(JSON.stringify({ ok: true }))]));
    const data = await getDaemonJson('http://d.example', '/api/x', { fetchImpl });
    expect(data).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://d.example/api/x');
    expect(init).toMatchObject({ method: 'GET' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('POSTs a JSON-serialized body and merges caller headers', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      streamResponse(201, [new TextEncoder().encode(JSON.stringify({ created: true }))]));
    const data = await postDaemonJson('http://d.example', '/api/runs', { contextRef: 'c1' }, { fetchImpl, headers: { 'x-token': 't' } });
    expect(data).toEqual({ created: true });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-token': 't' },
      body: JSON.stringify({ contextRef: 'c1' }),
    });
  });

  it('defaults a POST body to {} when undefined', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      streamResponse(200, [new TextEncoder().encode('{}')]));
    await postDaemonJson('http://d.example', '/api/x', undefined, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe('{}');
  });

  it('falls back to resp.text() for a Response-like double with no streaming body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { via: 'text' }));
    const data = await getDaemonJson('http://d.example', '/api/x', { fetchImpl });
    expect(data).toEqual({ via: 'text' });
  });

  it('resolves an empty body to {} rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(200, []));
    const data = await getDaemonJson('http://d.example', '/api/x', { fetchImpl });
    expect(data).toEqual({});
  });

  it('resolves a non-JSON body to {} rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(200, [new TextEncoder().encode('not json')]));
    const data = await getDaemonJson('http://d.example', '/api/x', { fetchImpl });
    expect(data).toEqual({});
  });

  it('throws a friendly message for ECONNREFUSED', async () => {
    const err = new Error('connect failed');
    (err as unknown as { cause: unknown }).cause = { code: 'ECONNREFUSED' };
    const fetchImpl = vi.fn(async () => { throw err; });
    await expect(getDaemonJson('http://d.example', '/api/x', { fetchImpl })).rejects.toThrow(
      'cannot reach the daemon at http://d.example. Is it running?',
    );
  });

  it('throws a friendly message for ENOTFOUND', async () => {
    const err = new Error('dns failed');
    (err as unknown as { cause: unknown }).cause = { code: 'ENOTFOUND' };
    const fetchImpl = vi.fn(async () => { throw err; });
    await expect(getDaemonJson('http://d.example', '/api/x', { fetchImpl })).rejects.toThrow(/cannot reach the daemon/);
  });

  it('throws the (sanitized) underlying message for an unrelated connection failure', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('boom'); });
    await expect(getDaemonJson('http://d.example', '/api/x', { fetchImpl })).rejects.toThrow('boom');
  });

  it('throws a sanitized message for a non-Error thrown value', async () => {
    const fetchImpl = vi.fn(async () => { throw 'just a string'; });
    await expect(getDaemonJson('http://d.example', '/api/x', { fetchImpl })).rejects.toThrow('just a string');
  });

  it('throws with the daemon-supplied code + message on a structured non-2xx envelope', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(404, [
      new TextEncoder().encode(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'run "x" was not found' } })),
    ]));
    await expect(getDaemonJson('http://d.example', '/api/runs/x', { fetchImpl })).rejects.toThrow(
      'daemon 404 on http://d.example/api/runs/x: NOT_FOUND: run "x" was not found',
    );
  });

  it('exposes the HTTP status on the thrown error, so a tool can tell "route not served" from other failures', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(404, [new TextEncoder().encode('{}')]));
    await expect(getDaemonJson('http://d.example', '/api/active', { fetchImpl })).rejects.toMatchObject({
      status: 404,
      message: 'daemon 404 on http://d.example/api/active: HTTP 404',
    });
  });

  it('falls back to a bare HTTP status when the non-2xx body has no structured message', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(500, [new TextEncoder().encode('{}')]));
    await expect(getDaemonJson('http://d.example', '/api/x', { fetchImpl })).rejects.toThrow(
      'daemon 500 on http://d.example/api/x: HTTP 500',
    );
  });

  it('redacts secret-looking text embedded in a daemon error message', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(400, [
      new TextEncoder().encode(JSON.stringify({ error: { message: 'bad token: apikey=abcdefghijklmnopqrstuvwxyz123456' } })),
    ]));
    await expect(getDaemonJson('http://d.example', '/api/x', { fetchImpl })).rejects.toThrow(/\[redacted\]/);
  });

  it('rejects via a declared content-length over the byte cap without reading the body', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(200, [], { 'content-length': '999999' }));
    await expect(getDaemonJson('http://d.example', '/api/x', { fetchImpl, maxResponseBytes: 10 })).rejects.toThrow(/exceeded the 10-byte limit/);
  });

  it('rejects mid-stream once accumulated bytes exceed the cap', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(20));
    const fetchImpl = vi.fn(async () => streamResponse(200, [chunk, chunk]));
    await expect(getDaemonJson('http://d.example', '/api/x', { fetchImpl, maxResponseBytes: 25 })).rejects.toThrow(/exceeded the 25-byte limit/);
  });

  it('rethrows a genuine stream read error unchanged (not wrapped as a byte-cap failure)', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('stream broke'));
      },
    });
    const resp = {
      ok: true,
      status: 200,
      body: stream,
      headers: { get: () => null } as unknown as Headers,
      text: async () => { throw new Error('should not be called: streamResponse has a body reader'); },
    } as unknown as Response;
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => resp);
    await expect(getDaemonJson('http://d.example', '/api/x', { fetchImpl })).rejects.toThrow('stream broke');
  });

  it('rejects a text()-fallback body over the byte cap', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { note: 'x'.repeat(1000) }));
    await expect(getDaemonJson('http://d.example', '/api/x', { fetchImpl, maxResponseBytes: 10 })).rejects.toThrow(/exceeded the 10-byte limit/);
  });

  it('aborts and rejects once timeoutMs elapses', async () => {
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    );
    await expect(getDaemonJson('http://d.example', '/api/x', { fetchImpl, timeoutMs: 10 })).rejects.toThrow();
  });

  it('aborts when a caller-supplied signal fires, even before timeoutMs elapses', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    );
    const pending = getDaemonJson('http://d.example', '/api/x', { fetchImpl, signal: controller.signal, timeoutMs: 60_000 });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it('DaemonResponseTooLargeError carries the configured limit', () => {
    const err = new DaemonResponseTooLargeError(42);
    expect(err.limitBytes).toBe(42);
    expect(err.name).toBe('DaemonResponseTooLargeError');
    expect(err.message).toContain('42-byte');
  });
});
