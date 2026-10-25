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
      const data = await getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' });
      expect(data).toEqual({ ok: true });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('GETs and returns the parsed JSON body on a 2xx response', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      streamResponse(200, [new TextEncoder().encode(JSON.stringify({ ok: true }))]));
    const data = await getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl });
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
    const data = await postDaemonJson({ baseUrl: 'http://d.example', route: '/api/runs', body: { contextRef: 'c1' } }, { fetchImpl, headers: { 'x-token': 't' } });
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
    await postDaemonJson({ baseUrl: 'http://d.example', route: '/api/x', body: undefined }, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe('{}');
  });

  it('falls back to resp.text() for a Response-like double with no streaming body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { via: 'text' }));
    const data = await getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl });
    expect(data).toEqual({ via: 'text' });
  });

  it('resolves an empty body to {} rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(200, []));
    const data = await getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl });
    expect(data).toEqual({});
  });

  it('resolves a non-JSON body to {} rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(200, [new TextEncoder().encode('not json')]));
    const data = await getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl });
    expect(data).toEqual({});
  });

  it('throws a friendly message for ECONNREFUSED', async () => {
    const err = new Error('connect failed');
    (err as unknown as { cause: unknown }).cause = { code: 'ECONNREFUSED' };
    const fetchImpl = vi.fn(async () => { throw err; });
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl })).rejects.toThrow(
      'cannot reach the daemon at http://d.example. Is it running?',
    );
  });

  it('throws a friendly message for ENOTFOUND', async () => {
    const err = new Error('dns failed');
    (err as unknown as { cause: unknown }).cause = { code: 'ENOTFOUND' };
    const fetchImpl = vi.fn(async () => { throw err; });
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl })).rejects.toThrow(/cannot reach the daemon/);
  });

  it('throws the (sanitized) underlying message for an unrelated connection failure', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('boom'); });
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl })).rejects.toThrow('boom');
  });

  it('throws a sanitized message for a non-Error thrown value', async () => {
    const fetchImpl = vi.fn(async () => { throw 'just a string'; });
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl })).rejects.toThrow('just a string');
  });

  it('throws with the daemon-supplied code + message on a structured non-2xx envelope', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(404, [
      new TextEncoder().encode(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'run "x" was not found' } })),
    ]));
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/runs/x' }, { fetchImpl })).rejects.toThrow(
      'HTTP 404: NOT_FOUND: run "x" was not found',
    );
  });

  it('exposes the HTTP status on the thrown error, so a tool can tell "route not served" from other failures', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(404, [new TextEncoder().encode('{}')]));
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/active' }, { fetchImpl })).rejects.toMatchObject({
      status: 404,
      message: 'HTTP 404',
    });
  });

  it('falls back to a bare HTTP status when the non-2xx body has no structured message', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(500, [new TextEncoder().encode('{}')]));
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl })).rejects.toThrow(
      'HTTP 500',
    );
  });

  it('redacts secret-looking text embedded in a daemon error message', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(400, [
      new TextEncoder().encode(JSON.stringify({ error: { message: 'bad token: apikey=abcdefghijklmnopqrstuvwxyz123456' } })),
    ]));
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl })).rejects.toThrow(/\[redacted\]/);
  });

  it('keeps the real setting recovery hint and JSON schema keyword in daemon failures', async () => {
    const message = 'Call settings_list_definitions to see valid keys. Schema for forms_create_definition: {"additionalProperties":false}';
    const fetchImpl = vi.fn(async () => streamResponse(400, [
      new TextEncoder().encode(JSON.stringify({ error: { message } })),
    ]));
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl, diagnosticToolIds: ['settings_list_definitions', 'forms_create_definition'] })).rejects.toThrow(message);
  });

  it('keeps a dotted recovery hint while masking known glued and token secrets', async () => {
    const id = 'content_read.backup_restore_point';
    const opaque = 'x7Qm2Pz9Vb4Nc8Ld1Rf6Yt3Wk5';
    const hint = `backup_restore_point 'missing' was not found — call ${id} without id to list valid ids`;
    const message = `${hint}; ${id}_${opaque} api_key=${id} sk-proj-${opaque} ${opaque}`;
    const fetchImpl = vi.fn(async () => streamResponse(400, [new TextEncoder().encode(JSON.stringify({ error: { message } }))]));
    const error = await getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl, diagnosticToolIds: [id], headers: { Authorization: `Bearer ${opaque}` } }).catch((error: Error) => error) as Error;
    expect(error.message).toBe(`HTTP 400: ${hint}; ${id}_[redacted] api_key=[redacted] sk-proj-[redacted] [redacted]`);
  });

  it.each([
    'deadbeefcafebabefeedfaceabcdefab',
    'settings_list_definitionsdeadbeefcafebabefeedfaceabcdefab',
    'settings_list_definitions_deadbeefcafebabefeedfaceabcdefab',
    'additionalPropertiesdeadbeefcafebabefeedfaceabcdefab',
    'a_long_readable_identifier',
  ])('masks the caller-known opaque credential %s through the daemon error path', async token => {
    const fetchImpl = vi.fn(async () => streamResponse(400, [
      new TextEncoder().encode(JSON.stringify({ error: { message: `failed ${token}; use settings_list_definitions; source_control_get_capabilities; additionalProperties` } })),
    ]));
    const error = await getDaemonJson({ baseUrl: 'http://d.example', route: '/api/delegated-tool-calls' }, { fetchImpl, diagnosticToolIds: ['settings_list_definitions', 'source_control_get_capabilities'], headers: { Authorization: `Bearer ${token}` } }).catch((error: Error) => error) as Error;
    expect(error.message).toBe('HTTP 400: failed [redacted]; use settings_list_definitions; source_control_get_capabilities; additionalProperties');
    expect(error.message).not.toContain(token);
  });

  it.each([
    ['forms_create_definition', `forms_create_definition: title is required. Schema for 'forms_create_definition': {"additionalProperties":false}`],
    ['source_control_get_capabilities', 'Call source_control_get_capabilities before retrying this operation.'],
  ])('preserves the %s diagnostic without exposing known glued or labelled secrets', async (id, diagnostic) => {
    const opaque = 'deadbeefcafebabefeedfaceabcdefab';
    const message = `${diagnostic} ${id}_${opaque} api_key=${id} ${opaque}`;
    const fetchImpl = vi.fn(async () => streamResponse(400, [new TextEncoder().encode(JSON.stringify({ error: { message } }))]));
    const error = await getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl, diagnosticToolIds: [id], headers: { Authorization: `Bearer ${opaque}` } }).catch((error: Error) => error) as Error;
    expect(error.message).toBe(`HTTP 400: ${diagnostic} ${id}_[redacted] api_key=[redacted] [redacted]`);
  });

  it('rejects via a declared content-length over the byte cap without reading the body', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(200, [], { 'content-length': '999999' }));
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl, maxResponseBytes: 10 })).rejects.toThrow(/exceeded the 10-byte limit/);
  });

  it('rejects mid-stream once accumulated bytes exceed the cap', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(20));
    const fetchImpl = vi.fn(async () => streamResponse(200, [chunk, chunk]));
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl, maxResponseBytes: 25 })).rejects.toThrow(/exceeded the 25-byte limit/);
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
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl })).rejects.toThrow('stream broke');
  });

  it('rejects a text()-fallback body over the byte cap', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { note: 'x'.repeat(1000) }));
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl, maxResponseBytes: 10 })).rejects.toThrow(/exceeded the 10-byte limit/);
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
    await expect(getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl, timeoutMs: 10 })).rejects.toThrow();
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
    const pending = getDaemonJson({ baseUrl: 'http://d.example', route: '/api/x' }, { fetchImpl, signal: controller.signal, timeoutMs: 60_000 });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it('DaemonResponseTooLargeError carries the configured limit', () => {
    const err = new DaemonResponseTooLargeError({ limitBytes: 42 });
    expect(err.limitBytes).toBe(42);
    expect(err.name).toBe('DaemonResponseTooLargeError');
    expect(err.message).toContain('42-byte');
  });
});

/** Builds a real fetch `Response` whose body streams `chunks` one by one. */
function realStreamResponse(chunks: readonly Uint8Array[], init: ResponseInit = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, init);
}

/** A real `Response` exposing no streaming body, so the reader falls back to `text()`. */
function textOnlyResponse(text: string, init: ResponseInit = {}): Response {
  const resp = new Response(null, init);
  Object.defineProperty(resp, 'body', { value: null });
  Object.defineProperty(resp, 'text', { value: async () => text });
  return resp;
}

/** Malformed-input fixture: a response-like double with no `headers` object at all. */
function headerlessResponse(text: string): Response {
  const resp = textOnlyResponse(text, { status: 200 });
  Object.defineProperty(resp, 'headers', { value: undefined });
  return resp;
}

/** A real `Response` whose body reader yields one `{ done: false, value: undefined }` step before the payload. */
function undefinedChunkResponse(payload: Uint8Array): Response {
  const steps: { done: boolean; value: Uint8Array | undefined }[] = [
    { done: false, value: undefined }, // malformed-input fixture: a reader step without bytes
    { done: false, value: payload },
    { done: true, value: undefined },
  ];
  const reader = { read: async () => steps.shift()!, releaseLock: () => {} };
  const resp = new Response(null, { status: 200 });
  Object.defineProperty(resp, 'body', { value: { getReader: () => reader } });
  return resp;
}

function errorCauseWith(cause: unknown): Error {
  return new Error('fetch failed', { cause });
}

const BASE = { baseUrl: 'http://d.example', route: '/api/x' } as const;

describe('daemon-client pinned branches (characterization)', () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it('reads a real streamed Response whose total size is exactly the byte cap', async () => {
    const body = JSON.stringify({ a: 1 });
    const fetchImpl = vi.fn(async () => realStreamResponse([encode(body)]));
    await expect(getDaemonJson(BASE, { fetchImpl, maxResponseBytes: body.length })).resolves.toEqual({ a: 1 });
  });

  it('rejects a real streamed Response one byte over the cap with the redacted limit message', async () => {
    const body = JSON.stringify({ a: 1 });
    const fetchImpl = vi.fn(async () => realStreamResponse([encode(body)]));
    await expect(getDaemonJson(BASE, { fetchImpl, maxResponseBytes: body.length - 1 })).rejects.toThrow(
      `response from http://d.example/api/x exceeded the ${body.length - 1}-byte limit`,
    );
  });

  it('decodes a multi-byte character split across two stream chunks', async () => {
    const bytes = encode(JSON.stringify({ s: 'é' }));
    const split = bytes.indexOf(0xc3) + 1;
    const fetchImpl = vi.fn(async () => realStreamResponse([bytes.slice(0, split), bytes.slice(split)]));
    await expect(getDaemonJson(BASE, { fetchImpl })).resolves.toEqual({ s: 'é' });
  });

  it('skips a reader step that carries no bytes', async () => {
    const fetchImpl = vi.fn(async () => undefinedChunkResponse(encode('{"ok":1}')));
    await expect(getDaemonJson(BASE, { fetchImpl, maxResponseBytes: 8 })).resolves.toEqual({ ok: 1 });
  });

  it('accepts a declared content-length equal to the cap', async () => {
    const fetchImpl = vi.fn(async () => realStreamResponse([encode('{}')], { headers: { 'content-length': '2' } }));
    await expect(getDaemonJson(BASE, { fetchImpl, maxResponseBytes: 2 })).resolves.toEqual({});
  });

  it('rejects a declared content-length one over the cap before reading', async () => {
    const fetchImpl = vi.fn(async () => realStreamResponse([encode('{}')], { headers: { 'content-length': '3' } }));
    await expect(getDaemonJson(BASE, { fetchImpl, maxResponseBytes: 2 })).rejects.toThrow(
      'response from http://d.example/api/x exceeded the 2-byte limit',
    );
  });

  it('ignores a non-numeric content-length and still enforces the streamed byte cap', async () => {
    const fetchImpl = vi.fn(async () => realStreamResponse([encode('{"long":true}')], { headers: { 'content-length': 'abc' } }));
    await expect(getDaemonJson(BASE, { fetchImpl, maxResponseBytes: 5 })).rejects.toThrow(
      'response from http://d.example/api/x exceeded the 5-byte limit',
    );
  });

  it('reads a response-like double that has no headers object', async () => {
    const fetchImpl = vi.fn(async () => headerlessResponse('{"h":0}'));
    await expect(getDaemonJson(BASE, { fetchImpl })).resolves.toEqual({ h: 0 });
  });

  it('measures the text() fallback in UTF-8 bytes, not characters', async () => {
    const fetchImpl = vi.fn(async () => textOnlyResponse('"éé"', { status: 200 }));
    await expect(getDaemonJson(BASE, { fetchImpl, maxResponseBytes: 5 })).rejects.toThrow(
      'response from http://d.example/api/x exceeded the 5-byte limit',
    );
  });

  it('accepts a text() fallback body exactly at the cap', async () => {
    const fetchImpl = vi.fn(async () => textOnlyResponse('"éé"', { status: 200 }));
    await expect(getDaemonJson(BASE, { fetchImpl, maxResponseBytes: 6 })).resolves.toBe('éé');
  });

  it('resolves an empty text() fallback body to {}', async () => {
    const fetchImpl = vi.fn(async () => textOnlyResponse('', { status: 200 }));
    await expect(getDaemonJson(BASE, { fetchImpl })).resolves.toEqual({});
  });

  it('strips credentials, query and fragment from a URL inside the too-large diagnostic', async () => {
    const fetchImpl = vi.fn(async () => textOnlyResponse('{"big":true}', { status: 200 }));
    const error = await getDaemonJson({ baseUrl: 'http://user:pw@d.example', route: '/api/x?k=v#frag' }, { fetchImpl, maxResponseBytes: 1 }).catch((e: Error) => e);
    expect((error as Error).message).toBe('response from http://d.example/api/x exceeded the 1-byte limit');
  });

  it('replaces an unparseable URL in a diagnostic with [redacted URL]', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('fetch to http://[bad failed'); });
    await expect(getDaemonJson(BASE, { fetchImpl })).rejects.toThrow('fetch to [redacted URL] failed');
  });

  it('leaves a plain URL without credentials, query or fragment unchanged in a diagnostic', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('fetch to http://d.example/api/x failed'); });
    await expect(getDaemonJson(BASE, { fetchImpl })).rejects.toThrow('fetch to http://d.example/api/x failed');
  });

  it('redacts a URL query token inside the friendly ECONNREFUSED message', async () => {
    // The URL matcher swallows the sentence's trailing period into the query, so it is stripped with it.
    const fetchImpl = vi.fn(async () => { throw errorCauseWith({ code: 'ECONNREFUSED' }); });
    await expect(getDaemonJson({ baseUrl: 'http://d.example?t=s', route: '' }, { fetchImpl })).rejects.toThrow(
      /^cannot reach the daemon at http:\/\/d\.example\/ Is it running\?$/,
    );
  });

  it.each([
    ['a non-object cause', 'just-a-string'],
    ['a null cause', null],
    ['a cause with a numeric code', { code: 111 }],
    ['an unrelated string code', { code: 'ECONNRESET' }],
  ])('reports the raw (sanitized) message for %s', async (_label, cause) => {
    const fetchImpl = vi.fn(async () => { throw errorCauseWith(cause); });
    await expect(getDaemonJson(BASE, { fetchImpl })).rejects.toThrow(/^fetch failed$/);
  });

  it('stringifies a thrown null', async () => {
    const fetchImpl = vi.fn(async () => { throw null; });
    await expect(getDaemonJson(BASE, { fetchImpl })).rejects.toThrow(/^null$/);
  });

  it('formats a non-2xx envelope with a code but no message', async () => {
    const fetchImpl = vi.fn(async () => realStreamResponse([encode('{"error":{"code":"BUSY"}}')], { status: 503 }));
    await expect(getDaemonJson(BASE, { fetchImpl })).rejects.toThrow(/^HTTP 503: BUSY$/);
  });

  it('ignores non-string code and message fields in a non-2xx envelope', async () => {
    const fetchImpl = vi.fn(async () => realStreamResponse([encode('{"error":{"code":7,"message":["x"]}}')], { status: 400 }));
    await expect(getDaemonJson(BASE, { fetchImpl })).rejects.toThrow(/^HTTP 400$/);
  });

  it('formats a non-2xx JSON null body as a bare status', async () => {
    const fetchImpl = vi.fn(async () => realStreamResponse([encode('null')], { status: 502 }));
    await expect(getDaemonJson(BASE, { fetchImpl })).rejects.toMatchObject({ name: 'DaemonHttpError', status: 502, message: 'HTTP 502' });
  });

  it('sends GET without a content-type and without a body', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => realStreamResponse([encode('{}')]));
    await getDaemonJson(BASE, { fetchImpl, headers: { authorization: 'Bearer t' } });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.headers).toEqual({ authorization: 'Bearer t' });
    expect('body' in init).toBe(false);
  });

  it('lets a caller header override the POST content-type', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => realStreamResponse([encode('{}')]));
    await postDaemonJson({ ...BASE, body: [1] }, { fetchImpl, headers: { 'content-type': 'text/plain' } });
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ method: 'POST', headers: { 'content-type': 'text/plain' }, body: '[1]' });
  });

  it('does not put the auth header value into a non-2xx diagnostic', async () => {
    const secret = 'Bearer ' + 'tok'.repeat(4);
    const fetchImpl = vi.fn(async () => realStreamResponse([encode('{}')], { status: 401 }));
    const error = await getDaemonJson(BASE, { fetchImpl, headers: { authorization: secret } }).catch((e: Error) => e);
    expect((error as Error).message).toBe('HTTP 401');
  });

  it('rejects with the timeout reason naming the route and deadline', async () => {
    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)); }));
    await expect(getDaemonJson(BASE, { fetchImpl, timeoutMs: 5 })).rejects.toThrow(/^request to \/api\/x timed out after 5ms$/);
  });

  it('clears its deadline timer after a successful request', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => textOnlyResponse('{}', { status: 200 }));
      await getDaemonJson(BASE, { fetchImpl });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears its deadline timer after a failed request', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => { throw new Error('down'); });
      await expect(getDaemonJson(BASE, { fetchImpl })).rejects.toThrow(/^down$/);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes the caller signal reason through when it aborts before the deadline', async () => {
    const controller = new AbortController();
    controller.abort(new Error('client cancelled'));
    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      init?.signal?.aborted ? Promise.reject(init.signal.reason) : Promise.resolve(textOnlyResponse('{}')));
    await expect(getDaemonJson(BASE, { fetchImpl, signal: controller.signal })).rejects.toThrow(/^client cancelled$/);
  });

  it('rethrows a non-size body read error without URL redaction (reported, not fixed)', async () => {
    // Only the byte-cap failure is re-wrapped through safeDiagnostic; any other read failure escapes raw,
    // relying on handleToolCall's safeDiagnostic pass for redaction. A URL with a query inside such a
    // message is therefore not stripped here (the final MCP catch strips it).
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('read http://d.example/x?q=1 broke')); } });
    const fetchImpl = vi.fn(async () => new Response(stream));
    await expect(getDaemonJson(BASE, { fetchImpl })).rejects.toThrow(/^read http:\/\/d\.example\/x\?q=1 broke$/);
  });
});

it('returns a model-facing HTTP status and diagnostic code without the daemon URL prefix', async () => {
  const fetchImpl = vi.fn(async () => streamResponse(403, [new TextEncoder().encode(JSON.stringify({ error: { code: 'TOOL_OPERATION_DENIED', message: 'Use execute_delegated_tool.' } }))]));
  await expect(postDaemonJson({ baseUrl: 'http://d.example', route: '/api/delegated-tool-calls', body: {} }, { fetchImpl, diagnosticToolIds: ['execute_delegated_tool'] }))
    .rejects.toMatchObject({ status: 403, message: 'HTTP 403: TOOL_OPERATION_DENIED: Use execute_delegated_tool.' });
});
