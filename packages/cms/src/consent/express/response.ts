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


/** Intercept actual HTML at the common write/end boundary, including sendFile and pipes.
 * Non-HTML output uses native methods without invoking policy/storage. HTML must be complete
 * before parsing; callbacks acknowledge buffered writes and final completion remains native.
 * @complexity O(n) time/space for n response bytes, plus the injected transformation. */
export function captureConsentHtml({ response, transform }: { response: Response; transform: (required: { body: Buffer }) => Promise<Buffer> }, { reportError = () => console.error("Consent HTML transform failed; optional content is blocked.") }: { reportError?: (required: { error: unknown }) => void } = {}): void {
  const write = response.write, end = response.end, writeHead = response.writeHead, flushHeaders = response.flushHeaders;
  const chunks: Buffer[] = [];
  let bytes = 0, buffering = false;
  const isHtml = (_chunk: unknown) => !response.getHeader('content-type') || String(response.getHeader('content-type')).toLowerCase().includes('text/html');
  const restore = () => { response.write = write; response.end = end; response.writeHead = writeHead; response.flushHeaders = flushHeaders; };
  // Explicit header flushes must wait for the HTML transform, including sendFile/stream output.
  response.writeHead = function (this: Response, status: number, reasonOrHeaders?: unknown, headers?: unknown): Response {
    response.statusCode = status;
    if (typeof reasonOrHeaders === 'string') response.statusMessage = reasonOrHeaders;
    const values = typeof reasonOrHeaders === 'string' ? headers : reasonOrHeaders;
    if (Array.isArray(values)) for (let i = 0; i < values.length; i += 2) response.setHeader(String(values[i]), values[i + 1] as string);
    else if (values && typeof values === 'object') for (const [name, value] of Object.entries(values)) if (value !== undefined) response.setHeader(name, value);
    return this;
  } as Response['writeHead'];
  response.flushHeaders = function (this: Response) { if (!isHtml('')) { restore(); flushHeaders.call(this); } };
  response.write = function (this: Response, chunk: unknown, encoding?: unknown, callback?: unknown): boolean {
    if (!buffering && !isHtml(chunk)) { restore(); return Reflect.apply(write, this, [chunk, encoding, callback]); }
    buffering = true;
    const value = Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding as BufferEncoding : 'utf8');
    chunks.push(value); bytes += value.length;
    const done = typeof encoding === 'function' ? encoding : callback;
    if (typeof done === 'function') queueMicrotask(() => done());
    return true;
  } as Response['write'];
  response.end = function (this: Response, chunk?: unknown, encoding?: unknown, callback?: unknown): Response {
    if (!buffering && !isHtml(chunk)) { restore(); return Reflect.apply(end, this, [chunk, encoding, callback]); }
    if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') {
      const value = Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding as BufferEncoding : 'utf8');
      chunks.push(value); bytes += value.length;
    }
    const done = typeof chunk === 'function' ? chunk : typeof encoding === 'function' ? encoding : callback;
    const collected = Buffer.concat(chunks, bytes);
    // Headerless streams may split their opening tag across chunks; inspect the complete body.
    const type = response.getHeader('content-type');
    const html = String(type).toLowerCase().includes('text/html') || (!type && /^\s*<[a-z!]/i.test(collected.toString('utf8')));
    void Promise.resolve().then(() => html ? transform({ body: collected }) : collected).catch(error => {
      if (!response.destroyed) blockConsentResponse({ response });
      // An observability outage must never hold page completion or grant optional requests.
      try { reportError({ error }); } catch { console.error('Consent error reporter failed; optional content is blocked.'); }
      return collected;
    }).then(body => {
      if (response.destroyed) return;
      restore();
      Reflect.apply(end, response, [body, typeof done === 'function' ? done : undefined]);
    });
    return this;
  } as Response['end'];
}
