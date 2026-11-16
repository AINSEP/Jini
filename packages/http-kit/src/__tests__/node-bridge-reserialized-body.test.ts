import { createServer, request as httpRequest, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { jsonResponse, readJsonBody } from '@jini-ai/core/contracts/server';
import { createNodeDispatcher, maxReserializedJsonBytes } from '../node-bridge.js';

/**
 * A body an upstream parser already read reaches a route re-serialized. Two facts follow and are
 * pinned here: the rebuilt text can be up to 5.25 times the wire text (so a route limit behind a
 * parser is derived from the parser's limit, never chosen beside it), and the rebuilt request's
 * headers describe the rebuilt body, not the wire one.
 */
let open: HttpServer | undefined;
afterEach(async () => {
  const server = open;
  open = undefined;
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function listen(server: HttpServer): Promise<string> {
  open = server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const ALL_DIGITS = '0123456789';

function* digitStrings({ length, alphabet }: { length: number; alphabet: string }): Generator<string> {
  if (length === 0) {
    yield '';
    return;
  }
  for (const prefix of digitStrings({ length: length - 1, alphabet })) for (const digit of alphabet) yield prefix + digit;
}

/** JSON integer parts of one length: a single digit, or digits with no leading zero. */
function* integerParts({ length, alphabet }: { length: number; alphabet: string }): Generator<string> {
  for (const first of alphabet) {
    if (length > 1 && first === '0') continue;
    for (const rest of digitStrings({ length: length - 1, alphabet })) yield first + rest;
  }
}

/** Every exponent suffix (`e5`, `E+20`, `e-7`, ...) of at most `room` characters; the exponent digits are always swept in full. */
function exponentSuffixes(room: number): string[] {
  const suffixes = [''];
  for (const marker of ['e', 'E']) {
    for (const sign of ['', '+', '-']) {
      for (let length = 1; length <= room - 1 - sign.length; length += 1) {
        for (const digits of digitStrings({ length, alphabet: ALL_DIGITS })) suffixes.push(marker + sign + digits);
      }
    }
  }
  return suffixes;
}

/** Every JSON number token (`-? int frac? exp?`) of at most `maxLength` characters whose mantissa digits come from `mantissaDigits`. */
function* numberTokens({ maxLength, mantissaDigits }: { maxLength: number; mantissaDigits: string }): Generator<string> {
  for (const sign of ['', '-']) {
    for (let intLength = 1; intLength <= maxLength - sign.length; intLength += 1) {
      for (let fracLength = 0; sign.length + intLength + (fracLength === 0 ? 0 : fracLength + 1) <= maxLength; fracLength += 1) {
        const mantissaLength = sign.length + intLength + (fracLength === 0 ? 0 : fracLength + 1);
        const suffixes = exponentSuffixes(maxLength - mantissaLength);
        for (const int of integerParts({ length: intLength, alphabet: mantissaDigits })) {
          for (const frac of fracLength === 0 ? [''] : digitStrings({ length: fracLength, alphabet: mantissaDigits })) {
            const mantissa = sign + int + (fracLength === 0 ? '' : `.${frac}`);
            for (const suffix of suffixes) yield mantissa + suffix;
          }
        }
      }
    }
  }
}

/** The worst growth among `tokens`, each checked against the bound for a body of its own length. */
function sweep(tokens: Iterable<string>): { count: number; overBound: string[]; reachedBound: string[] } {
  const overBound: string[] = [];
  const reachedBound: string[] = [];
  let count = 0;
  for (const token of tokens) {
    count += 1;
    const reserialized = JSON.stringify(JSON.parse(token)).length;
    const bound = maxReserializedJsonBytes({ parserLimitBytes: token.length });
    if (reserialized > bound) overBound.push(token);
    if (reserialized === bound && overBound.length + reachedBound.length < 50) reachedBound.push(token);
  }
  return { count, overBound, reachedBound };
}

describe('maxReserializedJsonBytes', () => {
  it('is 5.25 times the parser limit, for the two host parser limits in use', () => {
    expect(maxReserializedJsonBytes({ parserLimitBytes: 102_400 })).toBe(537_600);
    expect(maxReserializedJsonBytes({ parserLimitBytes: 6_291_456 })).toBe(33_030_144);
  });

  it('rounds up, so a fractional bound never refuses the last byte', () => {
    expect(maxReserializedJsonBytes({ parserLimitBytes: 5 })).toBe(27);
  });

  it('bounds every JSON number token of up to 6 characters, and only the `<digit>e20` family reaches it', () => {
    const result = sweep(numberTokens({ maxLength: 6, mantissaDigits: ALL_DIGITS }));
    expect(result.count).toBe(2_584_000);
    expect(result.overBound).toEqual([]);
    expect(result.reachedBound.sort()).toEqual(['1E20', '1e20', '2E20', '2e20', '3E20', '3e20', '4E20', '4e20', '5E20', '5e20', '6E20', '6e20', '7E20', '7e20', '8E20', '8e20', '9E20', '9e20']);
  });

  // The full 8-character space is some hundred million tokens; mantissa digits are narrowed to the
  // three that behave differently when printed (a zero, the smallest and the largest non-zero digit).
  it('bounds every JSON number token of up to 8 characters with mantissa digits 0, 1 and 9 and any exponent', { timeout: 120_000 }, () => {
    const result = sweep(numberTokens({ maxLength: 8, mantissaDigits: '019' }));
    expect(result.count).toBe(11_788_695);
    expect(result.overBound).toEqual([]);
    expect(result.reachedBound.sort()).toEqual(['1E20', '1e20', '9E20', '9e20']);
  });

  it('holds for whole documents: strings, escapes, whitespace and duplicate keys never grow', () => {
    const documents = ['{"a":"\\u0041\\/\\n","a":1}', '[ "x" ,\t{ "k" : [ ] } ]', '"\\ud800"', '{"10":1,"9":2,"é":" "}', '[1e20,1e20,-1e20,1.5E20,1e-6,1e-7,-0,1e400]'];
    for (const document of documents) {
      const wire = Buffer.byteLength(document);
      expect(Buffer.byteLength(JSON.stringify(JSON.parse(document))), document).toBeLessThanOrEqual(maxReserializedJsonBytes({ parserLimitBytes: wire }));
    }
  });
});

/** `[1e20,1e20,...]` padded with JSON whitespace to exactly `bytes` on the wire: the body that grows the most when re-serialized. */
function expansionFixture(bytes: number): { text: string; count: number } {
  const count = Math.floor((bytes - 1) / 5);
  const text = `[${Array.from({ length: count }, () => '1e20').join(',')}]`;
  return { text: text + ' '.repeat(bytes - text.length), count };
}

const EXPRESS_JSON_DEFAULT_LIMIT_BYTES = 102_400;

/** An Express host with its default blanket JSON parser in front of one bridged route that reads its body with the derived limit. */
function hostBehindParser() {
  const calls: unknown[] = [];
  const dispatcher = createNodeDispatcher();
  dispatcher.server.route({
    method: 'POST',
    path: '/numbers',
    handler: async ({ request }) => {
      const body = await readJsonBody({ request }, { maxBytes: maxReserializedJsonBytes({ parserLimitBytes: EXPRESS_JSON_DEFAULT_LIMIT_BYTES }) });
      calls.push(body);
      if (!body.ok) return jsonResponse({ status: body.error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, body: { error: body.error } });
      const numbers = body.value as number[];
      return jsonResponse({ status: 200, body: { count: numbers.length, allEqual: numbers.every((value) => value === 1e20) } });
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { void dispatcher.handle({ incoming: req, out: res }, { next, parsedBody: req.body }); });
  return { app, calls };
}

function postJson({ base, text }: { base: string; text: string }): Promise<Response> {
  return fetch(`${base}/numbers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
}

describe('a body the parser accepted is never refused by the route limit behind it', () => {
  it.each([
    ['one byte under the parser limit', EXPRESS_JSON_DEFAULT_LIMIT_BYTES - 1],
    ['exactly the parser limit', EXPRESS_JSON_DEFAULT_LIMIT_BYTES],
  ])('accepts the most-expanding body at %s, and the handler sees the same numbers', async (_label, bytes) => {
    const { app, calls } = hostBehindParser();
    const base = await listen(createServer(app));
    const fixture = expansionFixture(bytes);
    expect(Buffer.byteLength(fixture.text)).toBe(bytes);
    // More than four times the wire size once re-serialized: far over any limit chosen "a bit above" the parser's.
    expect(JSON.stringify(JSON.parse(fixture.text)).length).toBeGreaterThan(bytes * 4);
    const res = await postJson({ base, text: fixture.text });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: fixture.count, allEqual: true });
    expect(calls).toHaveLength(1);
  });

  it('one byte over the parser limit is refused by the parser, with its own 413, and the route is never called', async () => {
    const { app, calls } = hostBehindParser();
    const base = await listen(createServer(app));
    const res = await postJson({ base, text: expansionFixture(EXPRESS_JSON_DEFAULT_LIMIT_BYTES + 1).text });
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toContain('PayloadTooLargeError: request entity too large');
    expect(calls).toEqual([]);
  });
});

/** What a route was told about its body: the three headers that describe it, and the bytes it then read. */
function headerEchoHost({ withParser }: { withParser: boolean }) {
  const dispatcher = createNodeDispatcher();
  dispatcher.server.route({
    method: 'POST',
    path: '/seen',
    handler: async ({ request }) => {
      const headers = { length: request.headers.get('content-length'), encoding: request.headers.get('content-encoding'), transfer: request.headers.get('transfer-encoding'), type: request.headers.get('content-type') };
      const body = await readJsonBody({ request });
      return jsonResponse({ status: body.ok ? 200 : 415, body: { headers, body } });
    },
  });
  const app = express();
  if (withParser) app.use(express.json());
  app.use((req, res, next) => { void dispatcher.handle({ incoming: req, out: res }, { next, parsedBody: req.body }); });
  return app;
}

/** POSTs with Node's client so the request can be chunked (no content-length) and carry any content-encoding. */
function rawPost({ base, headers, chunks }: { base: string; headers: Record<string, string>; chunks: readonly (string | Uint8Array)[] }): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/seen`, { method: 'POST', headers }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (chunk: Buffer) => parts.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(parts).toString('utf8')) }));
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

describe('headers of a rebuilt request describe the rebuilt body', () => {
  it('a gzip JSON body the parser inflated is read by the route like any other: no content-encoding, content-length of the rebuilt text', async () => {
    const base = await listen(createServer(headerEchoHost({ withParser: true })));
    const wire = gzipSync('{ "note": "café",  "n": 1e20 }');
    const rebuilt = '{"note":"café","n":100000000000000000000}';
    const res = await rawPost({ base, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': String(wire.byteLength) }, chunks: [wire] });
    expect(res).toEqual({
      status: 200,
      json: {
        headers: { length: String(Buffer.byteLength(rebuilt)), encoding: null, transfer: null, type: 'application/json' },
        body: { ok: true, value: { note: 'café', n: 1e20 } },
      },
    });
  });

  it('a chunked body the parser read loses transfer-encoding and gains the rebuilt content-length', async () => {
    const base = await listen(createServer(headerEchoHost({ withParser: true })));
    const res = await rawPost({ base, headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, chunks: ['{"a":', ' [1e20] }'] });
    expect(res).toEqual({
      status: 200,
      json: { headers: { length: '29', encoding: null, transfer: null, type: 'application/json' }, body: { ok: true, value: { a: [1e20] } } },
    });
  });

  it('a body nothing upstream read keeps its headers: a gzip body is still refused, never inflated', async () => {
    const base = await listen(createServer(headerEchoHost({ withParser: false })));
    const wire = gzipSync('{"a":1}');
    const res = await rawPost({ base, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': String(wire.byteLength) }, chunks: [wire] });
    expect(res.status).toBe(415);
    expect(res.json).toMatchObject({
      headers: { length: String(wire.byteLength), encoding: 'gzip', transfer: null },
      body: { ok: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE' } },
    });
  });
});
