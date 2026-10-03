import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CLI_EXIT_CODES } from '../errors.js';
import { getJsonFromDaemon, postJsonToDaemon, surfaceFetchError } from '../http.js';

class ExitSentinel extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

function captureWrite() {
  const written: string[] = [];
  return { written, write: ({ text }: { text: string }) => { written.push(text); } };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function streamResponse(status: number, chunks: readonly Uint8Array[]): Response {
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
    json: async () => { throw new Error('should not be called: streamResponse has a body reader'); },
  } as unknown as Response;
}

/** A response whose body stream errors immediately — used to exercise structured reporting of a non-size-limit read failure. */
function erroringStreamResponse(status: number, error: Error): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error);
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    body: stream,
    json: async () => { throw new Error('should not be called: erroringStreamResponse has a body reader'); },
  } as unknown as Response;
}

/** A response with a declared `content-length` header and a real body-stream reader — exercises the pre-read size-cap check ahead of `readJsonWithLimit`'s streaming branch. */
function streamResponseWithContentLength(status: number, chunk: Uint8Array, contentLength: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? contentLength : null) },
    body: stream,
    json: async () => { throw new Error('should not be called: has a body reader'); },
  } as unknown as Response;
}

/** A response implementing neither a body reader nor `.json()` sensibly — only `.text()`, like a test double outside this suite's other shapes. Exercises `readJsonWithLimit`'s `resp.text()` fallback branch. */
function textOnlyResponse(status: number, text: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => { throw new Error('should not be called: textOnlyResponse has no body reader, only text()'); },
  } as unknown as Response;
}

describe('surfaceFetchError', () => {
  it('formats a plain Error with no cause', () => {
    const { written, write } = captureWrite();
    surfaceFetchError({ err: new Error('boom'), daemonUrl: 'http://d.example' }, { write });
    expect(written[0]).toBe('failed to reach daemon at http://d.example: boom\n');
  });

  it('formats a non-Error thrown value via String()', () => {
    const { written, write } = captureWrite();
    surfaceFetchError({ err: 'just a string', daemonUrl: 'http://d.example' }, { write });
    expect(written[0]).toBe('failed to reach daemon at http://d.example: just a string\n');
  });

  it('prefers cause.code + cause.message when present', () => {
    const { written, write } = captureWrite();
    const err = new Error('outer');
    (err as unknown as { cause: unknown }).cause = { code: 'ECONNREFUSED', message: 'refused' };
    surfaceFetchError({ err, daemonUrl: 'http://d.example' }, { write });
    expect(written[0]).toBe('failed to reach daemon at http://d.example: ECONNREFUSED — refused\n');
  });

  it('uses cause.code alone when cause has no message', () => {
    const { written, write } = captureWrite();
    const err = new Error('outer');
    (err as unknown as { cause: unknown }).cause = { code: 'ECONNREFUSED' };
    surfaceFetchError({ err, daemonUrl: 'http://d.example' }, { write });
    expect(written[0]).toBe('failed to reach daemon at http://d.example: ECONNREFUSED\n');
  });

  it('uses cause.message alone when cause has no code', () => {
    const { written, write } = captureWrite();
    const err = new Error('outer');
    (err as unknown as { cause: unknown }).cause = { message: 'timed out' };
    surfaceFetchError({ err, daemonUrl: 'http://d.example' }, { write });
    expect(written[0]).toBe('failed to reach daemon at http://d.example: timed out\n');
  });

  it('adds a sandbox hint for EPERM', () => {
    const { written, write } = captureWrite();
    const err = new Error('outer');
    (err as unknown as { cause: unknown }).cause = { code: 'EPERM' };
    surfaceFetchError({ err, daemonUrl: 'http://d.example' }, { write });
    expect(written).toHaveLength(2);
    expect(written[1]).toContain('sandbox');
  });

  it('adds a sandbox hint for ENETUNREACH', () => {
    const { written, write } = captureWrite();
    const err = new Error('outer');
    (err as unknown as { cause: unknown }).cause = { code: 'ENETUNREACH' };
    surfaceFetchError({ err, daemonUrl: 'http://d.example' }, { write });
    expect(written).toHaveLength(2);
  });

  it('does not add a hint for an unrelated cause code', () => {
    const { written, write } = captureWrite();
    const err = new Error('outer');
    (err as unknown as { cause: unknown }).cause = { code: 'EOTHER' };
    surfaceFetchError({ err, daemonUrl: 'http://d.example' }, { write });
    expect(written).toHaveLength(1);
  });

  it('defaults write to process.stderr.write when not injected', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      surfaceFetchError({ err: new Error('boom'), daemonUrl: 'http://d.example' });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('postJsonToDaemon', () => {
  it('returns the parsed JSON body on a 2xx response', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse(200, { ok: true }));
    const data = await postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: { a: 1 } }, { fetchImpl });
    expect(data).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://d.example/api/x');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    // Every request now carries an internal-timeout-backed AbortSignal (CR-004/SEC-RB-009).
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('merges caller-supplied headers', async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse(200, {}));
    await postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, headers: { 'x-token': 't' } });
    const call = fetchImpl.mock.calls[0]!;
    expect(call[1]?.headers).toEqual({ 'content-type': 'application/json', 'x-token': 't' });
  });

  it('exits via the structured-error path on a network failure', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['daemon-not-running'] });
  });

  it('exits via the structured-error path when the daemon returns a recognized error code', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(422, { error: { code: 'missing-input', message: 'need x', data: { field: 'x' } } }),
    );
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['missing-input'] });
  });

  it('honors caller-supplied exitCodes for a code outside the default table', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, { error: { code: 'custom-conflict', message: 'nope' } }),
    );
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, {
        fetchImpl,
        exit,
        write,
        exitCodes: { 'custom-conflict': 77 },
      }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: 77 });
  });

  it('falls back to "HTTP <status>" as the message when a recognized error code has no message field', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(422, { error: { code: 'missing-input' } }));
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['missing-input'] });
  });

  it('falls back to a structured write + exit(1) for an error code not in any table', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: { code: 'totally-unmapped' } }));
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: 1 });
    expect(write).toHaveBeenCalledWith({ text: expect.stringContaining('POST /api/x failed: 500') });
  });

  it('falls back to a structured write + exit(1) when the response has no error envelope at all', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: 1 });
  });

  it('tolerates a non-JSON response body by treating it as {}', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
    } as unknown as Response));
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: 1 });
  });

  it('defaults write/exit to process.stderr/process.exit on a network failure', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new ExitSentinel(code ?? 0);
    }) as never);
    try {
      await expect(postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl })).rejects.toThrow(ExitSentinel);
      expect(writeSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['daemon-not-running']);
    } finally {
      writeSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('defaults write/exit to process.stderr/process.exit on the unrecognized-error-code fallback path', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: { code: 'totally-unmapped' } }));
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new ExitSentinel(code ?? 0);
    }) as never);
    try {
      await expect(postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl })).rejects.toThrow(ExitSentinel);
      expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('POST /api/x failed: 500'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      writeSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('defaults fetchImpl to the global fetch when not injected', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { ok: true }) as Response);
    try {
      const data = await postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} });
      expect(data).toEqual({ ok: true });
    } finally {
      spy.mockRestore();
    }
  });

  it('aborts and surfaces a daemon-not-running error once timeoutMs elapses', async () => {
    // A realistic fetchImpl honors its AbortSignal, the way undici's real fetch does — this
    // fake mirrors that so the internal timeout wiring is actually exercised end to end.
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    );
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write, timeoutMs: 10 }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['daemon-not-running'] });
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
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    const pending = postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, {
      fetchImpl,
      exit,
      write,
      signal: controller.signal,
      timeoutMs: 60_000,
    });
    controller.abort();
    await expect(pending).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['daemon-not-running'] });
  });

  it('rejects cleanly instead of buffering a response that exceeds maxResponseBytes', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(1000));
    const fetchImpl = vi.fn(async () => streamResponse(200, [chunk, chunk]));
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write, maxResponseBytes: 1500 }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: 1 });
    expect(write).toHaveBeenCalledWith({ text: expect.stringContaining('exceeded') });
  });

  it('reads a streamed JSON response body up to (but under) the byte cap', async () => {
    const chunk = new TextEncoder().encode(JSON.stringify({ ok: true, note: 'hello' }));
    const fetchImpl = vi.fn(async () => streamResponse(200, [chunk]));
    const data = await postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, maxResponseBytes: 1_000_000 });
    expect(data).toEqual({ ok: true, note: 'hello' });
  });

  it('rejects immediately based on a declared content-length header, without reading the body', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(1000));
    const fetchImpl = vi.fn(async () => streamResponseWithContentLength(200, chunk, '999999'));
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write, maxResponseBytes: 100 }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: 1 });
    expect(write).toHaveBeenCalledWith({ text: expect.stringContaining('exceeded') });
  });

  it('permits a streamed response whose declared content-length header is within the byte cap', async () => {
    const chunk = new TextEncoder().encode(JSON.stringify({ ok: true }));
    const fetchImpl = vi.fn(async () => streamResponseWithContentLength(200, chunk, String(chunk.byteLength)));
    const data = await postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, maxResponseBytes: 1_000_000 });
    expect(data).toEqual({ ok: true });
  });

  it('treats a non-JSON streamed response body as {} instead of throwing', async () => {
    const chunk = new TextEncoder().encode('not valid json{');
    const fetchImpl = vi.fn(async () => streamResponse(200, [chunk]));
    const data = await postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl });
    expect(data).toEqual({});
  });

  it('treats a completely empty streamed response body as {} without attempting to parse it', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(200, []));
    const data = await postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl });
    expect(data).toEqual({});
  });

  it('reads a response via the resp.text() fallback when no body reader is present', async () => {
    const fetchImpl = vi.fn(async () => textOnlyResponse(200, JSON.stringify({ ok: true, via: 'text' })));
    const data = await postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl });
    expect(data).toEqual({ ok: true, via: 'text' });
  });

  it('treats a non-JSON resp.text() body as {} instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => textOnlyResponse(200, 'not valid json{'));
    const data = await postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl });
    expect(data).toEqual({});
  });

  it('treats a completely empty resp.text() body as {} without attempting to parse it', async () => {
    const fetchImpl = vi.fn(async () => textOnlyResponse(200, ''));
    const data = await postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl });
    expect(data).toEqual({});
  });

  it('rejects a resp.text() body that exceeds maxResponseBytes with no content-length header', async () => {
    const fetchImpl = vi.fn(async () => textOnlyResponse(200, 'x'.repeat(1000)));
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write, maxResponseBytes: 100 }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: 1 });
    expect(write).toHaveBeenCalledWith({ text: expect.stringContaining('exceeded') });
  });

  it('reports a non-size-limit error raised while streaming through the structured contract', async () => {
    const fetchImpl = vi.fn(async () => erroringStreamResponse(200, new Error('stream broke')));
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    // Raw body-stream failures now reach the same structured-error contract as daemon errors
    // and size-limit rejections; preserve their detail while using the fallback exit code.
    expect(exit).toHaveBeenCalledWith({ code: 1 });
    expect(JSON.parse(write.mock.calls[0]![0].text).error).toEqual({ code: 'request-failed', message: 'stream broke', data: {} });
  });

  it('bounds and redacts an unrecognized-error-code daemon payload instead of dumping it verbatim', async () => {
    const secret = 'A'.repeat(40);
    const fetchImpl = vi.fn(async () =>
      jsonResponse(500, { error: { code: 'totally-unmapped', authorization: `Bearer ${secret}` } }),
    );
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    const combined = write.mock.calls.map((call) => String(call[0].text)).join('');
    expect(combined).toContain('POST /api/x failed: 500');
    expect(combined).not.toContain(secret);
  });

  it('falls back to a redacted String() representation when the unrecognized daemon payload cannot be JSON.stringified', async () => {
    const circular: Record<string, unknown> = { note: 'unmapped' };
    circular.self = circular;
    const fetchImpl = vi.fn(async () => jsonResponse(500, circular));
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: 1 });
    const combined = write.mock.calls.map((call) => String(call[0].text)).join('');
    expect(combined).toContain('POST /api/x failed: 500');
    expect(combined).toContain('[object Object]');
  });

  it('omits the unrecognized-payload excerpt entirely when JSON.stringify yields no serializable content', async () => {
    // A top-level function value is a legal JS value but JSON.stringify() returns `undefined` for
    // it (not a throw) — exercises the `?? ''` fallback and the resulting raw.length === 0 short
    // circuit in describeUnrecognizedDaemonPayload, distinct from the try/catch's throw path.
    const unserializable = () => {};
    const fetchImpl = vi.fn(async () => jsonResponse(500, unserializable));
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: 1 });
    expect(JSON.parse(write.mock.calls[0]![0].text).error).toEqual({ code: 'http-error', message: 'POST /api/x failed: 500', data: {} });
  });

  it('strips userinfo from the daemon URL before reporting a network failure', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      postJsonToDaemon({ base: 'http://user:hunter2@d.example', route: '/api/x', body: {} }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    const combined = write.mock.calls.map((call) => String(call[0].text)).join('');
    expect(combined).not.toContain('hunter2');
  });
});

describe('getJsonFromDaemon', () => {
  it('issues a GET request with no body and returns the parsed JSON on a 2xx response', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse(200, { runs: [] }));
    const data = await getJsonFromDaemon({ base: 'http://d.example', route: '/api/runs' }, { fetchImpl });
    expect(data).toEqual({ runs: [] });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://d.example/api/runs');
    expect(init?.method).toBe('GET');
    expect(init).not.toHaveProperty('body');
    expect(init?.headers).not.toHaveProperty('content-type');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('merges caller-supplied headers without adding a content-type', async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse(200, {}));
    await getJsonFromDaemon({ base: 'http://d.example', route: '/api/runs' }, { fetchImpl, headers: { 'x-token': 't' } });
    const call = fetchImpl.mock.calls[0]!;
    expect(call[1]?.headers).toEqual({ 'x-token': 't' });
  });

  it('exits via the structured-error path on a network failure', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      getJsonFromDaemon({ base: 'http://d.example', route: '/api/runs' }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: DEFAULT_CLI_EXIT_CODES['daemon-not-running'] });
  });

  it('falls back to a plain write + exit(1) for an error code not in any table, using GET in the message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: { code: 'totally-unmapped' } }));
    const exit = vi.fn(({ code }: { code: number }): never => { throw new ExitSentinel(code); });
    const write = vi.fn();
    await expect(
      getJsonFromDaemon({ base: 'http://d.example', route: '/api/runs' }, { fetchImpl, exit, write }),
    ).rejects.toThrow(ExitSentinel);
    expect(exit).toHaveBeenCalledWith({ code: 1 });
    expect(write).toHaveBeenCalledWith({ text: expect.stringContaining('GET /api/runs failed: 500') });
  });

  it('defaults fetchImpl to the global fetch when not injected', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { ok: true }) as Response);
    try {
      const data = await getJsonFromDaemon({ base: 'http://d.example', route: '/api/runs' });
      expect(data).toEqual({ ok: true });
    } finally {
      spy.mockRestore();
    }
  });
});
