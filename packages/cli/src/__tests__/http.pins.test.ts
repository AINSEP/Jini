/**
 * Characterization pins for `http.ts` (SEC: carries the daemon auth header). Written against the
 * pre-refactor code so the cyclomatic/cognitive split of `surfaceFetchError`,
 * `readJsonWithLimit` and `requestJsonFromDaemon` is proven behaviour-preserving: header
 * handling, size caps (each boundary), deadline/abort wiring, error-envelope mapping and the
 * guarantee that a caller-supplied auth header never reaches stderr.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJsonFromDaemon, postJsonToDaemon, surfaceFetchError, type PostJsonToDaemonOptions } from '../http.js';

class ExitSentinel extends Error {
  constructor(public readonly code: unknown) {
    super('exit');
  }
}

interface Harness {
  readonly written: string[];
  readonly exitCodes: unknown[];
  readonly calls: { url: string; init: RequestInit }[];
  readonly options: PostJsonToDaemonOptions;
}

/** Built at runtime so no secret-shaped literal is committed. */
const TOKEN = 'gh' + 'p_' + 'x'.repeat(36);

function harness(respond: (requiredArgs: { url: string; init: RequestInit }) => Promise<Response>, extra: PostJsonToDaemonOptions = {}): Harness {
  const written: string[] = [];
  const exitCodes: unknown[] = [];
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  };
  return {
    written,
    exitCodes,
    calls,
    options: {
      fetchImpl,
      write: ({ text }) => { written.push(text); },
      exit: ({ code }) => { exitCodes.push(code); throw new ExitSentinel(code); },
      ...extra,
    },
  };
}

function envelope(h: Harness): { error: { code: string; message: string; data: Record<string, unknown> } } {
  return JSON.parse(h.written.join('').trim()) as { error: { code: string; message: string; data: Record<string, unknown> } };
}

function chunked(chunks: readonly Uint8Array[], init: ResponseInit = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, init);
}

const enc = new TextEncoder();

afterEach(() => {
  vi.useRealTimers();
});

describe('http pins: request shape and auth header', () => {
  it('POST sends content-type json, the caller headers (auth included) and a JSON body', async () => {
    const h = harness(async () => Response.json({ ok: true }), { headers: { authorization: `Bearer ${TOKEN}` } });
    await expect(postJsonToDaemon({ base: 'http://127.0.0.1:1', route: '/api/x', body: { a: 1 } }, h.options)).resolves.toEqual({ ok: true });
    expect(h.calls[0]?.url).toBe('http://127.0.0.1:1/api/x');
    expect(h.calls[0]?.init.method).toBe('POST');
    expect(h.calls[0]?.init.headers).toEqual({ 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` });
    expect(h.calls[0]?.init.body).toBe('{"a":1}');
  });

  it('POST lets a caller content-type header override the default one', async () => {
    const h = harness(async () => Response.json({}), { headers: { 'content-type': 'text/plain' } });
    await postJsonToDaemon({ base: 'http://h', route: '/r', body: null }, h.options);
    expect(h.calls[0]?.init.headers).toEqual({ 'content-type': 'text/plain' });
  });

  it('POST serializes an undefined body as an undefined fetch body', async () => {
    const h = harness(async () => Response.json({}));
    await postJsonToDaemon({ base: 'http://h', route: '/r', body: undefined }, h.options);
    expect('body' in h.calls[0]!.init).toBe(true);
    expect(h.calls[0]?.init.body).toBeUndefined();
  });

  it('reports a POST body JSON.stringify cannot serialize as daemon-not-running without calling fetch (reported, not fixed)', async () => {
    const h = harness(async () => Response.json({}));
    await expect(postJsonToDaemon({ base: 'http://h', route: '/r', body: { n: 10n } }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(h.calls).toEqual([]);
    expect(envelope(h).error.code).toBe('daemon-not-running');
    expect(envelope(h).error.data).toEqual({ diagnostics: ['failed to reach daemon at http://h: Do not know how to serialize a BigInt'] });
  });

  it('GET sends only the caller headers, no content-type and no body key', async () => {
    const h = harness(async () => Response.json({ ok: 1 }), { headers: { authorization: `Bearer ${TOKEN}` } });
    await getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options);
    expect(h.calls[0]?.init.method).toBe('GET');
    expect(h.calls[0]?.init.headers).toEqual({ authorization: `Bearer ${TOKEN}` });
    expect('body' in h.calls[0]!.init).toBe(false);
  });

  it('GET with no caller headers sends an empty headers object', async () => {
    const h = harness(async () => Response.json({}));
    await getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options);
    expect(h.calls[0]?.init.headers).toEqual({});
  });

  it('never writes the auth header value when the fetch itself fails', async () => {
    const h = harness(async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED', message: 'connect refused' } }); }, { headers: { authorization: `Bearer ${TOKEN}` } });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(h.written.join('')).not.toContain(TOKEN);
    expect(envelope(h).error).toEqual({ code: 'daemon-not-running', message: 'Cannot reach daemon at http://h', data: { diagnostics: ['failed to reach daemon at http://h: ECONNREFUSED — connect refused'] } });
  });

  it('never writes the auth header value when the daemon echoes it back in an unrecognized error payload', async () => {
    const h = harness(async () => Response.json({ echoed: `Bearer ${TOKEN}` }, { status: 500 }), { headers: { authorization: `Bearer ${TOKEN}` } });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(h.written.join('')).not.toContain(TOKEN);
    expect(envelope(h).error.code).toBe('http-error');
  });

  it('never writes the auth header value when the daemon echoes it in a recognized error message', async () => {
    const h = harness(async () => Response.json({ error: { code: 'missing-input', message: `bad token ${TOKEN}` } }, { status: 401 }), { headers: { authorization: `Bearer ${TOKEN}` } });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(h.written.join('')).not.toContain(TOKEN);
    expect(envelope(h).error.code).toBe('missing-input');
    expect(h.exitCodes).toEqual([67]);
  });

  it('keeps a query-string token in the displayed daemon URL (reported, not fixed)', async () => {
    const secret = 'q' + 'secret'.repeat(2);
    const h = harness(async () => { throw new Error('down'); });
    await expect(getJsonFromDaemon({ base: `http://h/?token=${secret}`, route: '' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(envelope(h).error.message).toBe(`Cannot reach daemon at http://h/?token=${secret}`);
  });
});

describe('http pins: response size cap', () => {
  it('ignores a non-numeric content-length header and reads the body', async () => {
    const h = harness(async () => chunked([enc.encode('{"a":1}')], { headers: { 'content-length': 'abc' } }), { maxResponseBytes: 2 });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    // The declared length is skipped, so the streamed byte count is what trips the cap.
    expect(envelope(h).error).toEqual({ code: 'response-too-large', message: 'response from http://h/r exceeded the 2-byte limit; aborting.', data: {} });
  });

  it('accepts a declared content-length exactly at the cap', async () => {
    const h = harness(async () => chunked([enc.encode('{"a":1}')], { headers: { 'content-length': '7' } }), { maxResponseBytes: 7 });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).resolves.toEqual({ a: 1 });
  });

  it('rejects a declared content-length one byte over the cap before reading, aborting the request signal', async () => {
    let seen: AbortSignal | undefined;
    const h = harness(async ({ init }) => { seen = init.signal ?? undefined; return chunked([enc.encode('{}')], { headers: { 'content-length': '8' } }); }, { maxResponseBytes: 7 });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(envelope(h).error.code).toBe('response-too-large');
    expect(h.exitCodes).toEqual([1]);
    expect(seen?.aborted).toBe(true);
    expect((seen?.reason as Error).name).toBe('ResponseTooLargeError');
  });

  it('accepts a multi-chunk stream totalling exactly the cap', async () => {
    const h = harness(async () => chunked([enc.encode('{"a"'), enc.encode(':1}')]), { maxResponseBytes: 7 });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).resolves.toEqual({ a: 1 });
  });

  it('rejects a multi-chunk stream one byte over the cap', async () => {
    const h = harness(async () => chunked([enc.encode('{"a"'), enc.encode(':1} ')]), { maxResponseBytes: 7 });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(envelope(h).error.message).toBe('response from http://h/r exceeded the 7-byte limit; aborting.');
  });

  it('decodes a multi-byte character split across stream chunks', async () => {
    const bytes = enc.encode('{"s":"é"}');
    const h = harness(async () => chunked([bytes.slice(0, 7), bytes.slice(7)]));
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).resolves.toEqual({ s: 'é' });
  });

  it('skips an undefined chunk value yielded by a non-standard reader', async () => {
    // Malformed-input fixture: a hand-rolled reader that yields `{done:false, value:undefined}`,
    // which no spec-conforming ReadableStream produces.
    const results = [{ done: false, value: undefined }, { done: false, value: enc.encode('{"a":2}') }, { done: true, value: undefined }];
    const reader = { read: async () => results.shift()!, releaseLock: () => {} };
    const resp = { ok: true, status: 200, headers: new Headers(), body: { getReader: () => reader } } as unknown as Response;
    const h = harness(async () => resp);
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).resolves.toEqual({ a: 2 });
  });

  it('measures a text()-only body in UTF-8 bytes, not characters', async () => {
    // Malformed-input fixture: a response-like object with only text(), no body reader.
    const resp = { ok: true, status: 200, text: async () => '"é"' } as unknown as Response;
    const h = harness(async () => resp, { maxResponseBytes: 3 });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(envelope(h).error.code).toBe('response-too-large');
  });

  it('accepts a text()-only body exactly at the cap', async () => {
    // Malformed-input fixture: a response-like object with only text(), no body reader.
    const resp = { ok: true, status: 200, text: async () => '"é"' } as unknown as Response;
    const h = harness(async () => resp, { maxResponseBytes: 4 });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).resolves.toBe('é');
  });

  it('resolves {} when a json()-only body rejects', async () => {
    // Malformed-input fixture: a response-like object with neither a body reader nor text().
    const resp = { ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } } as unknown as Response;
    const h = harness(async () => resp);
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).resolves.toEqual({});
  });

  it('reports a non-Error value thrown while reading the body as request-failed with its String() form', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error('plain string failure'); } });
    const h = harness(async () => new Response(stream));
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(envelope(h).error).toEqual({ code: 'request-failed', message: 'plain string failure', data: {} });
  });
});

describe('http pins: deadline and exit codes', () => {
  it('clears its deadline timer once the request settles', async () => {
    vi.useFakeTimers();
    const h = harness(async () => Response.json({}));
    await getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its deadline timer when the fetch fails', async () => {
    vi.useFakeTimers();
    const h = harness(async () => { throw new Error('down'); });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the configured timeoutMs and names the route in the abort reason', async () => {
    vi.useFakeTimers();
    const h = harness(({ init }) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(init.signal?.reason); });
    }), { timeoutMs: 50 });
    const pending = getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options);
    const settled = expect(pending).rejects.toBeInstanceOf(ExitSentinel);
    await vi.advanceTimersByTimeAsync(49);
    expect(h.written).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(envelope(h).error.data).toEqual({ diagnostics: ['failed to reach daemon at http://h: request to /r timed out after 50ms'] });
  });

  it('passes the caller exitCodes table through to a transport failure exit', async () => {
    const h = harness(async () => { throw new Error('down'); }, { exitCodes: { 'daemon-not-running': 42 } });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(h.exitCodes).toEqual([42]);
  });

  it('maps a recognized daemon code to its exit code and sanitized data', async () => {
    const h = harness(async () => Response.json({ error: { code: 'missing-input', message: 'no such run', data: { runId: 'r1' }, retryable: false } }, { status: 400 }));
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(h.exitCodes).toEqual([67]);
    expect(envelope(h).error).toEqual({ code: 'missing-input', message: 'no such run', data: { runId: 'r1', retryable: false } });
  });

  it('treats a code only the caller exitCodes table knows as recognized, keeping the daemon message and data', async () => {
    const h = harness(async () => Response.json({ error: { code: 'pack-specific', message: 'pack said no', retryable: true } }, { status: 409 }), { exitCodes: { 'pack-specific': 77 } });
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(h.exitCodes).toEqual([77]);
    expect(envelope(h).error).toEqual({ code: 'pack-specific', message: 'pack said no', data: { retryable: true } });
  });

  it('falls back to http-error when the daemon code is not a string', async () => {
    const h = harness(async () => Response.json({ error: { code: 7, message: 'x' } }, { status: 502 }));
    await expect(postJsonToDaemon({ base: 'http://h', route: '/r', body: {} }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(envelope(h).error.code).toBe('http-error');
    expect(envelope(h).error.message).toBe('POST /r failed: 502 (daemon response, redacted/truncated): {"error":{"code":7,"message":"x"}}');
  });

  it('strips control sequences from an unrecognized string daemon code', async () => {
    const h = harness(async () => Response.json({ error: { code: 'weird\u001b[31m' } }, { status: 500 }));
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(envelope(h).error.code).toBe('weird');
  });

  it('treats a non-object JSON error body as an envelope-less failure', async () => {
    const h = harness(async () => Response.json('nope', { status: 500 }));
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(envelope(h).error).toEqual({ code: 'http-error', message: 'GET /r failed: 500 (daemon response, redacted/truncated): "nope"', data: {} });
  });

  it('accepts a prototype key such as "toString" as a recognized daemon code and exits with a non-numeric code (reported, not fixed)', async () => {
    const h = harness(async () => Response.json({ error: { code: 'toString', message: 'm' } }, { status: 500 }));
    await expect(getJsonFromDaemon({ base: 'http://h', route: '/r' }, h.options)).rejects.toBeInstanceOf(ExitSentinel);
    expect(envelope(h).error.code).toBe('toString');
    expect(typeof h.exitCodes[0]).toBe('function');
  });
});

describe('http pins: surfaceFetchError odd inputs', () => {
  function surface(err: unknown): string[] {
    const out: string[] = [];
    surfaceFetchError({ err, daemonUrl: 'http://h' }, { write: ({ text }) => { out.push(text); } });
    return out;
  }

  it('uses a cause code from a non-Error thrown object', () => {
    expect(surface({ cause: { code: 'EPERM' } })).toEqual([
      'failed to reach daemon at http://h: EPERM\n',
      'hint: outbound connect was denied, likely by a sandbox policy. If this command ran inside an agent sandbox, check its network policy — the daemon itself is unaffected and can be reached from a regular shell.\n',
    ]);
  });

  it('ignores a non-string cause code and falls back to the cause message', () => {
    expect(surface(new Error('outer', { cause: { code: 13, message: 'inner' } }))).toEqual(['failed to reach daemon at http://h: inner\n']);
  });

  it('ignores a primitive cause', () => {
    expect(surface(new Error('outer', { cause: 'EPERM' }))).toEqual(['failed to reach daemon at http://h: outer\n']);
  });

  it('ignores an empty cause message alongside no code', () => {
    expect(surface(new Error('outer', { cause: { message: '' } }))).toEqual(['failed to reach daemon at http://h: outer\n']);
  });

  it('stringifies a null thrown value', () => {
    expect(surface(null)).toEqual(['failed to reach daemon at http://h: null\n']);
  });

  it('redacts a secret-shaped value in the failure detail', () => {
    expect(surface(new Error(`boom ${TOKEN}`)).join('')).not.toContain(TOKEN);
  });

  it('still stringifies the thrown value eagerly even when a cause code is present (throws for a null-prototype object)', () => {
    // Malformed-input fixture: a null-prototype object has no toString, so String() throws.
    const err = Object.assign(Object.create(null) as object, { cause: { code: 'EPERM' } });
    expect(() => surface(err)).toThrow(TypeError);
  });
});
