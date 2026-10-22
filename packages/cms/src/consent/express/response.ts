import type { Response } from 'express';

/** Last-resort browser enforcement accompanies an inert response after a transform failure.
 * Existing CSP remains enforced alongside this policy. @complexity O(existing header length). */
export function blockConsentResponse({ response }: { response: Response }, _options = {}): void {
  const policy = "default-src 'none'; script-src 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'";
  const existing = response.getHeader('Content-Security-Policy');
  response.setHeader('Content-Security-Policy', existing ? [...(Array.isArray(existing) ? existing.map(String) : [String(existing)]), policy] : policy);
  response.setHeader('Cache-Control', 'private, no-store');
  response.removeHeader('Content-Length'); response.removeHeader('ETag');
}


/** Default capture bound; ordinary rendered pages are far smaller. */
export const CONSENT_MAX_HTML_BYTES = 5 * 1024 * 1024;

/** A CSP cannot stop meta refresh or distinguish first-party pixels from essential images.
 * Serve only inert text on any processing failure, including compressed input. @complexity O(1). */
export function inertConsentBody({ response }: { response: Response }, _options = {}): Buffer {
  blockConsentResponse({ response });
  response.removeHeader('Content-Encoding');
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return Buffer.from('This page could not be delivered with cookie preferences enforced. Please try again or contact the site owner.');
}

type Reporter = (required: { error: unknown }) => void;
type Overflow = (required: Record<string, never>) => Promise<Buffer | null>;

/** An observability outage must never hold completion or grant optional requests. @complexity O(1). */
function reportSafely({ reportError, error }: { reportError: Reporter; error: unknown }): void {
  try { reportError({ error }); } catch { console.error('Consent error reporter failed; optional content is blocked.'); }
}

/** Resolve enabled/static policy before selecting overflow behavior. null is an explicit disabled
 * policy and preserves every original byte; any replacement discards all later chunks.
 * @complexity O(1), excluding the injected policy read. */
async function overflowResult({ response, overflow, maxBytes, reportError }: { response: Response; overflow: Overflow; maxBytes: number; reportError: Reporter }): Promise<Buffer | null> {
  if (!isHtmlResponse({ response })) return null;
  try {
    const body = await overflow({});
    if (body !== null) reportSafely({ reportError, error: new Error(`Consent HTML exceeded ${maxBytes} bytes, so delivery was refused or replaced with inert text. Raise maxHtmlBytes if pages are legitimately larger.`) });
    return body;
  } catch (error) {
    reportSafely({ reportError, error });
    return inertConsentBody({ response });
  }
}

/** Pause piped producers while policy resolves. Disabled sites flush the captured prefix and
 * resume native streaming; enabled sites acknowledge and discard chunks until end. Callers must
 * honor Node write backpressure, just as with the native response. @complexity O(chunk bytes). */
function writeOverflow({ response, result, body, write, writeHead, flushHeaders, done }: { response: Response; result: Promise<Buffer | null>; body: Buffer; write: Response['write']; writeHead: Response['writeHead']; flushHeaders: Response['flushHeaders']; done: unknown }): boolean {
  void result.then(replacement => {
    if (response.destroyed) return;
    if (replacement === null) {
      // Native write must be able to flush headers after the disabled-policy decision.
      response.writeHead = writeHead; response.flushHeaders = flushHeaders;
      if (!Reflect.apply(write, response, [body, typeof done === 'function' ? done : undefined])) return;
    } else if (typeof done === 'function') done();
    queueMicrotask(() => response.emit('drain'));
  });
  return false;
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

/** Unknown content type must stay captured until it can be classified. @complexity O(header length). */
function isHtmlResponse({ response }: { response: Response }): boolean {
  const type = response.getHeader('content-type');
  return !type || String(type).toLowerCase().includes('text/html');
}

/** Headerless streams may split their opening tag across chunks; inspect the complete body. @complexity O(n). */
function isHtmlBody({ type, body }: { type: unknown; body: Buffer }): boolean {
  return String(type).toLowerCase().includes('text/html') || (!type && /^\s*<[a-z!]/i.test(body.toString('utf8')));
}

/** Transform a complete HTML body, then finish natively; failure serves inert text under the blocking policy.
 * @complexity O(n) plus the injected transformation. */
async function completeBody({ response, collected, transform, reportError, finish }: { response: Response; collected: Buffer; transform: (required: { body: Buffer }) => Promise<Buffer>; reportError: (required: { error: unknown }) => void; finish: (body: Buffer) => void }): Promise<void> {
  const html = isHtmlBody({ type: response.getHeader('content-type'), body: collected });
  const body = await Promise.resolve().then(() => html ? transform({ body: collected }) : collected).catch(error => {
    reportSafely({ reportError, error });
    return response.destroyed ? Buffer.alloc(0) : inertConsentBody({ response });
  });
  if (!response.destroyed) finish(body);
}

/** Intercept actual HTML at the common write/end boundary, including sendFile and pipes.
 * Non-HTML output uses native methods without invoking policy/storage. HTML must be complete
 * before parsing; callbacks acknowledge buffered writes and final completion remains native.
 * At most maxBytes (plus one chunk) is captured before resolving overflow policy. The returned
 * replacement is inert; an explicit disabled policy resumes streaming without changing bytes.
 * @complexity O(min(n, maxBytes)) space and O(n) time for n response bytes, plus the injected transformation. */
export function captureConsentHtml({ response, transform }: { response: Response; transform: (required: { body: Buffer }) => Promise<Buffer> }, { reportError = () => console.error("Consent HTML transform failed; optional content is blocked."), maxBytes = CONSENT_MAX_HTML_BYTES, overflow = async () => inertConsentBody({ response }) }: { reportError?: Reporter; maxBytes?: number; overflow?: Overflow } = {}): void {
  const write = response.write, end = response.end, writeHead = response.writeHead, flushHeaders = response.flushHeaders;
  const chunks: Buffer[] = [];
  let bytes = 0, buffering = false;
  let overflowing: Promise<Buffer | null> | undefined;
  const isHtml = (_chunk: unknown) => isHtmlResponse({ response });
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
    const done = typeof encoding === 'function' ? encoding : callback;
    if (overflowing) return writeOverflow({ response, result: overflowing, body: toBuffer({ chunk, encoding }), write, writeHead, flushHeaders, done });
    collect(chunk, encoding);
    if (bytes > maxBytes) {
      overflowing = overflowResult({ response, overflow, maxBytes, reportError });
      const body = Buffer.concat(chunks, bytes);
      chunks.length = 0;
      return writeOverflow({ response, result: overflowing, body, write, writeHead, flushHeaders, done });
    }
    if (typeof done === 'function') queueMicrotask(() => done());
    return true;
  } as Response['write'];
  response.end = function (this: Response, chunk?: unknown, encoding?: unknown, callback?: unknown): Response {
    if (!buffering && !isHtml(chunk)) { restore(); return Reflect.apply(end, this, [chunk, encoding, callback]); }
    const done = endCallback({ chunk, encoding, callback });
    const value = endChunk({ chunk, encoding });
    const finish = (body: Buffer) => { restore(); Reflect.apply(end, response, [body, typeof done === 'function' ? done : undefined]); };
    if (overflowing) { void finishOverflow({ response, result: overflowing, original: value, finish }); return this; }
    collect(value, undefined);
    const collected = Buffer.concat(chunks, bytes);
    chunks.length = 0;
    if (bytes > maxBytes) {
      overflowing = overflowResult({ response, overflow, maxBytes, reportError });
      void finishOverflow({ response, result: overflowing, original: collected, finish });
    } else void completeBody({ response, collected, transform, reportError, finish });
    return this;
  } as Response['end'];
}

/** end callbacks/null are not body chunks. @complexity O(chunk bytes). */
function endChunk({ chunk, encoding }: { chunk: unknown; encoding: unknown }): Buffer {
  return chunk === undefined || chunk === null || typeof chunk === 'function' ? Buffer.alloc(0) : toBuffer({ chunk, encoding });
}

/** Complete only once policy is known; never append the original suffix to inert text.
 * @complexity O(1). */
async function finishOverflow({ response, result, original, finish }: { response: Response; result: Promise<Buffer | null>; original: Buffer; finish: (body: Buffer) => void }): Promise<void> {
  const replacement = await result;
  if (!response.destroyed) finish(replacement ?? original);
}
