import type { Response } from 'express';

/** Last-resort browser enforcement keeps original HTML available after a transform failure.
 * Existing CSP remains enforced alongside this policy. @complexity O(existing header length). */
export function blockConsentResponse({ response }: { response: Response }, _options = {}): void {
  const policy = "default-src 'self'; script-src 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'self'";
  const existing = response.getHeader('Content-Security-Policy');
  response.setHeader('Content-Security-Policy', existing ? [...(Array.isArray(existing) ? existing.map(String) : [String(existing)]), policy] : policy);
  response.setHeader('Cache-Control', 'private, no-store');
  response.removeHeader('Content-Length'); response.removeHeader('ETag');
}


/** Default capture bound; ordinary rendered pages are far smaller. */
export const CONSENT_MAX_HTML_BYTES = 5 * 1024 * 1024;

/** Past the capture bound the page is served unmodified under the restrictive policy, so memory
 * stays bounded and nothing optional runs ungated. @complexity O(collected bytes) once. */
function overflowBody({ response, chunks, maxBytes, reportError }: { response: Response; chunks: Buffer[]; maxBytes: number; reportError: (required: { error: unknown }) => void }): Buffer {
  blockConsentResponse({ response });
  const error = new Error(`Consent HTML exceeded ${maxBytes} bytes, so it was served unmodified under the restrictive consent policy. Raise maxHtmlBytes if pages are legitimately larger.`);
  try { reportError({ error }); } catch { console.error('Consent error reporter failed; an oversized page was served under the restrictive policy.'); }
  return Buffer.concat(chunks);
}

/** @complexity O(chunk length). */
function toBuffer({ chunk, encoding }: { chunk: unknown; encoding: unknown }): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.from(String(chunk), typeof encoding === 'string' ? encoding as BufferEncoding : 'utf8');
}

/** Node accepts writeHead headers as an object or a flat [name, value, ...] list. @complexity O(headers). */
function setHeaders({ response, values }: { response: Response; values: unknown }): void {
  if (Array.isArray(values)) {
    for (let i = 0; i < values.length; i += 2) response.setHeader(String(values[i]), values[i + 1] as string);
    return;
  }
  if (!values || typeof values !== 'object') return;
  for (const [name, value] of Object.entries(values)) if (value !== undefined) response.setHeader(name, value);
}

/** end(cb), end(chunk, cb) and end(chunk, encoding, cb) all complete the same callback. @complexity O(1). */
function endCallback({ chunk, encoding, callback }: { chunk: unknown; encoding: unknown; callback: unknown }): unknown {
  if (typeof chunk === 'function') return chunk;
  return typeof encoding === 'function' ? encoding : callback;
}

/** Headerless streams may split their opening tag across chunks; inspect the complete body. @complexity O(n). */
function isHtmlBody({ type, body }: { type: unknown; body: Buffer }): boolean {
  return String(type).toLowerCase().includes('text/html') || (!type && /^\s*<[a-z!]/i.test(body.toString('utf8')));
}

/** Transform a complete HTML body, then finish natively; failure serves the original under the blocking policy.
 * @complexity O(n) plus the injected transformation. */
async function completeBody({ response, collected, transform, reportError, finish }: { response: Response; collected: Buffer; transform: (required: { body: Buffer }) => Promise<Buffer>; reportError: (required: { error: unknown }) => void; finish: (body: Buffer) => void }): Promise<void> {
  const html = isHtmlBody({ type: response.getHeader('content-type'), body: collected });
  const body = await Promise.resolve().then(() => html ? transform({ body: collected }) : collected).catch(error => {
    if (!response.destroyed) blockConsentResponse({ response });
    // An observability outage must never hold page completion or grant optional requests.
    try { reportError({ error }); } catch { console.error('Consent error reporter failed; optional content is blocked.'); }
    return collected;
  });
  if (!response.destroyed) finish(body);
}

/** Intercept actual HTML at the common write/end boundary, including sendFile and pipes.
 * Non-HTML output uses native methods without invoking policy/storage. HTML must be complete
 * before parsing; callbacks acknowledge buffered writes and final completion remains native.
 * At most maxBytes (plus one chunk) is buffered; a larger page streams through unmodified under
 * the restrictive policy.
 * @complexity O(min(n, maxBytes)) space and O(n) time for n response bytes, plus the injected transformation. */
export function captureConsentHtml({ response, transform }: { response: Response; transform: (required: { body: Buffer }) => Promise<Buffer> }, { reportError = () => console.error("Consent HTML transform failed; optional content is blocked."), maxBytes = CONSENT_MAX_HTML_BYTES }: { reportError?: (required: { error: unknown }) => void; maxBytes?: number } = {}): void {
  const write = response.write, end = response.end, writeHead = response.writeHead, flushHeaders = response.flushHeaders;
  const chunks: Buffer[] = [];
  let bytes = 0, buffering = false;
  const isHtml = (_chunk: unknown) => !response.getHeader('content-type') || String(response.getHeader('content-type')).toLowerCase().includes('text/html');
  const restore = () => { response.write = write; response.end = end; response.writeHead = writeHead; response.flushHeaders = flushHeaders; };
  const collect = (chunk: unknown, encoding: unknown) => { const value = toBuffer({ chunk, encoding }); chunks.push(value); bytes += value.length; };
  // Explicit header flushes must wait for the HTML transform, including sendFile/stream output.
  response.writeHead = function (this: Response, status: number, reasonOrHeaders?: unknown, headers?: unknown): Response {
    response.statusCode = status;
    if (typeof reasonOrHeaders === 'string') response.statusMessage = reasonOrHeaders;
    setHeaders({ response, values: typeof reasonOrHeaders === 'string' ? headers : reasonOrHeaders });
    return this;
  } as Response['writeHead'];
  response.flushHeaders = function (this: Response) { if (!isHtml('')) { restore(); flushHeaders.call(this); } };
  response.write = function (this: Response, chunk: unknown, encoding?: unknown, callback?: unknown): boolean {
    if (!buffering && !isHtml(chunk)) { restore(); return Reflect.apply(write, this, [chunk, encoding, callback]); }
    buffering = true;
    collect(chunk, encoding);
    const done = typeof encoding === 'function' ? encoding : callback;
    if (bytes > maxBytes) {
      const body = overflowBody({ response, chunks, maxBytes, reportError });
      restore();
      return Reflect.apply(write, this, [body, done]);
    }
    if (typeof done === 'function') queueMicrotask(() => done());
    return true;
  } as Response['write'];
  response.end = function (this: Response, chunk?: unknown, encoding?: unknown, callback?: unknown): Response {
    if (!buffering && !isHtml(chunk)) { restore(); return Reflect.apply(end, this, [chunk, encoding, callback]); }
    if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') collect(chunk, encoding);
    const done = endCallback({ chunk, encoding, callback });
    if (bytes > maxBytes) {
      const body = overflowBody({ response, chunks, maxBytes, reportError });
      restore();
      return Reflect.apply(end, this, [body, done]);
    }
    const finish = (body: Buffer) => { restore(); Reflect.apply(end, response, [body, typeof done === 'function' ? done : undefined]); };
    void completeBody({ response, collected: Buffer.concat(chunks, bytes), transform, reportError, finish });
    return this;
  } as Response['end'];
}
