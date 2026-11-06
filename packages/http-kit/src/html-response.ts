/** Bounded HTML response capture for host-owned transformations, including files and streams.
 * This transport primitive applies no content policy: overflow and failures preserve original bytes. */
import type { ServerResponse } from 'node:http';

type Transform = (required: { body: Buffer }) => Promise<Buffer>;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function bufferOf(chunk: unknown, encoding: unknown): Buffer {
  if (chunk === undefined || chunk === null || typeof chunk === 'function') return Buffer.alloc(0);
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.from(String(chunk), typeof encoding === 'string' ? encoding as BufferEncoding : 'utf8');
}

/** Defer explicit headers until a buffered HTML transform has completed. */
function copyHeaders(response: ServerResponse, values: unknown): void {
  if (Array.isArray(values)) {
    for (let i = 0; i < values.length; i += 2) response.setHeader(String(values[i]), values[i + 1] as string);
    return;
  }
  if (!values || typeof values !== 'object') return;
  for (const [name, value] of Object.entries(values)) if (value !== undefined) response.setHeader(name, value);
}

function captures(response: ServerResponse): boolean {
  const type = response.getHeader('content-type');
  return response.req?.method !== 'HEAD' && !response.getHeader('content-encoding') && (!type || /\btext\/html\b/i.test(String(type)));
}

function htmlBody(response: ServerResponse, body: Buffer): boolean {
  const type = response.getHeader('content-type');
  return /\btext\/html\b/i.test(String(type)) || !type && /^\s*<[a-z!]/i.test(body.toString('utf8'));
}

function completionCallback(chunk: unknown, encoding: unknown, callback: unknown): unknown {
  if (typeof chunk === 'function') return chunk;
  return typeof encoding === 'function' ? encoding : callback;
}

/** A changed body invalidates its original length and validators; pass-through keeps native headers. */
async function transformBody(response: ServerResponse, body: Buffer, transform: Transform): Promise<Buffer> {
  let result = body;
  try { if (body.length && htmlBody(response, body)) result = await transform({ body: Buffer.from(body) }); }
  catch { return body; }
  if (!body.equals(result)) {
    response.removeHeader('Content-Length'); response.removeHeader('ETag'); response.removeHeader('Content-MD5');
  }
  return result;
}

/** Capture a response only while its uncompressed HTML fits the byte bound. Callbacks acknowledge
 * buffered writes; overflow restores native writes immediately, so pipes retain native backpressure.
 * A failed transform returns original bytes. Changed bytes drop stale length/validator headers.
 * The transform receives a copy so mutation before a throw cannot corrupt the fallback (at most
 * two maxBytes-sized input buffers, excluding output allocated by the transform).
 * @complexity O(min(body bytes, maxBytes)) retained space; O(body bytes) work plus transform cost.
 */
export function captureHtmlResponse(
  { response, transform }: { response: ServerResponse; transform: Transform },
  { maxBytes = DEFAULT_MAX_BYTES }: { maxBytes?: number } = {},
): void {
  const { write, end, writeHead, flushHeaders } = response;
  const chunks: Buffer[] = [];
  let bytes = 0;
  const restore = () => { response.write = write; response.end = end; response.writeHead = writeHead; response.flushHeaders = flushHeaders; };
  const held = () => { const body = Buffer.concat(chunks, bytes); chunks.length = 0; bytes = 0; return body; };
  const append = (body: Buffer) => { chunks.push(body); bytes += body.length; };
  const flushPrefix = () => { restore(); const prefix = held(); if (prefix.length) Reflect.apply(write, response, [prefix]); };

  response.writeHead = function (status: number, reasonOrHeaders?: unknown, headers?: unknown): ServerResponse {
    response.statusCode = status;
    if (typeof reasonOrHeaders === 'string') response.statusMessage = reasonOrHeaders;
    copyHeaders(response, typeof reasonOrHeaders === 'string' ? headers : reasonOrHeaders);
    return response;
  } as ServerResponse['writeHead'];
  response.flushHeaders = function () {
    if (!captures(response)) { flushPrefix(); flushHeaders.call(response); }
  };
  response.write = function (chunk: unknown, encoding?: unknown, callback?: unknown): boolean {
    const body = bufferOf(chunk, encoding);
    if (!captures(response) || bytes + body.length > maxBytes) {
      flushPrefix();
      return Reflect.apply(write, response, [chunk, encoding, callback]);
    }
    append(body);
    const done = typeof encoding === 'function' ? encoding : callback;
    if (typeof done === 'function') queueMicrotask(() => done());
    return true;
  } as ServerResponse['write'];
  response.end = function (chunk?: unknown, encoding?: unknown, callback?: unknown): ServerResponse {
    const done = completionCallback(chunk, encoding, callback);
    const body = bufferOf(chunk, encoding);
    if (!captures(response) || bytes + body.length > maxBytes) {
      flushPrefix();
      return Reflect.apply(end, response, [body, typeof done === 'function' ? done : undefined]);
    }
    append(body);
    void transformBody(response, held(), transform).then(result => {
      restore();
      if (!response.destroyed) Reflect.apply(end, response, [result, typeof done === 'function' ? done : undefined]);
    });
    return response;
  } as ServerResponse['end'];
}
