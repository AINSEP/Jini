/**
 * @file Serves a `Server` route table from Node's `http` request/response objects. This is the
 * only code a host adapter needs: plain `node:http` calls `handle` with no `next`; an Express (4 or
 * 5) host mounts `handle` as one middleware and passes `next`, so unmatched requests and handler
 * errors fall through to the host's own routes and error handler. Express's `req`/`res` ARE Node's
 * `IncomingMessage`/`ServerResponse`, which is why moving the host to Express 5 changes nothing here.
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { inspect } from 'node:util';
import { redactSecrets, type SecretRedactionPattern } from '@jini-ai/core';
import { createRouteTable, type RouteMatch, type Server } from '@jini-ai/core/contracts/server';

/** Optional per-request hints from a host framework that already touched the request. */
export interface NodeDispatchOptions {
  /** Hand unmatched requests (`next()`) and handler failures (`next(error)`) to the host. */
  readonly next?: (error?: unknown) => void;
  /** `scheme://host` for `Request.url`; a host behind a trusted proxy passes its own view. Defaults to `http://<Host header>`. */
  readonly origin?: string;
  /**
   * The body an upstream parser already produced (Express: `req.body`). Used only when that
   * parser has consumed the stream: a `Buffer`/`Uint8Array` is passed on byte for byte, a string
   * as text, anything else as JSON. Without this, a converted route behind a blanket
   * `express.json()` would see an empty body.
   */
  readonly parsedBody?: unknown;
  /**
   * Trusted per-request values the host's own code established before this request reached the
   * dispatcher (Express: `res.locals`, where host authentication put the signed-in principal).
   * Handlers and middleware get a fresh `locals` seeded with these. Only values the host itself
   * set belong here, never anything rebuilt from request headers or body: the routes behind the
   * dispatcher trust them as the host's verdict.
   */
  readonly locals?: Readonly<Record<string, unknown>>;
}

/** One unhandled failure, with the reference its 500 answer showed the caller. */
export interface UnhandledErrorReport {
  readonly error: unknown;
  /** Also in the plain-words 500 body (when one could still be sent), so a pasted reference finds this log line. */
  readonly reference: string;
}

/** Optional settings for {@link createNodeDispatcher}. */
export interface NodeDispatcherOptions {
  /**
   * Where a handler failure goes when no `next` was given, and where a failure after the headers
   * were sent always goes (default: redacted, to stderr). A sink that throws is contained: the
   * dispatcher writes one fixed line to stderr instead and carries on.
   */
  readonly onUnhandledError?: (required: UnhandledErrorReport) => void;
  /**
   * Extra credential shapes the default stderr sink masks on top of the shared redactor's own.
   * Jini stays vendor-neutral and knows no host's key formats, so the host injects them (a
   * host passes its own API key shape). Ignored when `onUnhandledError` is given: that sink owns redaction.
   */
  readonly redactionPatterns?: readonly SecretRedactionPattern[];
  /**
   * For a host that replaces Express routes with route lists and must keep answering what Express
   * answered. Paths match as Express 4 matches by default (fixed segments ignore letter case, one
   * trailing slash is accepted); a `:name` segment that is not valid percent-encoding is a 400
   * (handed to the host as an error with `status` 400 when `next` is given, so its own error page
   * answers, otherwise a plain-words 400); and an OPTIONS request for a path some route owns is
   * answered here, 200 with `Allow` and the methods as the body, as Express answered it. That last
   * answer is for a host with no CORS layer above the dispatcher: a CORS layer answers a preflight
   * itself and the request never gets here. Default `false`: exact paths, and OPTIONS goes to the host.
   */
  readonly expressCompatible?: boolean;
}

export interface NodeDispatcher {
  /** Register routes here; they are served by `handle`. */
  readonly server: Server;
  /** Serves one request. Never rejects: every failure is answered or handed to `next(error)`. */
  handle(requiredArgs: { readonly incoming: IncomingMessage; readonly out: ServerResponse }, optionalArgs?: NodeDispatchOptions): Promise<void>;
}

/**
 * How many times longer a JSON text can get when it is parsed and printed again
 * (`JSON.stringify(JSON.parse(text))`), which is what {@link consumedBody} does to a body an upstream
 * parser already read. The only JSON production that grows is a number written in exponent form:
 * `1e20` (4 bytes) prints as `100000000000000000000` (21 bytes), 21 / 4 = 5.25. Nothing does worse:
 * from `1e21` up JavaScript prints the exponent form again, and a sign, a longer mantissa or a
 * negative exponent adds input bytes faster than output bytes. Strings, escapes, whitespace and
 * duplicate keys never grow.
 */
const JSON_RESERIALIZE_MAX_EXPANSION = 5.25;

/**
 * Largest size a body of `parserLimitBytes` can have after the bridge re-serializes it. See JSON_RESERIALIZE_MAX_EXPANSION.
 * A host with a JSON parser in front of the dispatcher passes this as the route-side body limit:
 * the parser has already applied the real limit to the bytes on the wire, and the route limit
 * only has to be large enough never to refuse a body the parser accepted.
 */
export function maxReserializedJsonBytes(required: { parserLimitBytes: number }, _optional: Record<string, never> = {}): number {
  return Math.ceil(required.parserLimitBytes * JSON_RESERIALIZE_MAX_EXPANSION);
}

function consumedBody(parsedBody: unknown): Uint8Array | string | null {
  if (parsedBody === undefined || parsedBody === null) return null;
  if (parsedBody instanceof Uint8Array) return new Uint8Array(parsedBody);
  if (typeof parsedBody === 'string') return parsedBody;
  return JSON.stringify(parsedBody);
}

/**
 * The request path exactly as received, plus the URL for the web `Request`; `null` when no URL
 * can be built (a Host header that is not a host, an absolute-form or `*` request target).
 * Routes match on the raw path, never on a parsed URL's pathname: the URL parser resolves `..`
 * and would read `//a/b` as host `a` + path `/b`, so it could pick a different route than the
 * one the host framework's own gates looked at. The URL takes only the origin's scheme and host,
 * so a Host header carrying a path cannot shift the path either.
 */
function requestTarget({ incoming, origin }: { incoming: IncomingMessage; origin: string | undefined }): { pathname: string; url: URL } | null {
  const target = incoming.url ?? '/';
  if (!target.startsWith('/')) return null;
  const pathname = /^[^?#]*/.exec(target)?.[0] ?? target;
  try {
    const url = new URL(new URL(origin ?? `http://${incoming.headers.host ?? 'localhost'}`).origin);
    url.pathname = pathname;
    url.search = target.slice(pathname.length).split('#')[0] ?? '';
    return { pathname, url };
  } catch {
    return null;
  }
}

/**
 * Makes the headers describe a body the bridge rebuilt from `parsedBody` instead of the one that
 * was on the wire: `content-length` is the rebuilt byte length, `content-encoding` and
 * `transfer-encoding` go. The upstream parser already decoded and de-chunked what it read (Express
 * inflates gzip by default), and core's `readBodyBytes` refuses any `content-encoding` other than
 * identity and compares `content-length` to its limit. Left as received, a gzip JSON call the
 * host's parser accepted would be answered 415 behind the bridge.
 */
function describeRebuiltBody({ headers, body }: { headers: Headers; body: Uint8Array | string }): void {
  headers.set('content-length', String(typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength));
  headers.delete('content-encoding');
  headers.delete('transfer-encoding');
}

/** The body for the web `Request`: the untouched stream, or what an upstream parser left of it (with `headers` corrected to match). */
function requestBody({ incoming, headers, parsedBody }: { incoming: IncomingMessage; headers: Headers; parsedBody: unknown }): ReadableStream<Uint8Array> | Uint8Array | string | null {
  if (!incoming.readableEnded) return Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
  // An upstream parser has drained the socket; rebuild from what it produced, not from the empty stream.
  const rebuilt = consumedBody(parsedBody);
  if (rebuilt !== null) describeRebuiltBody({ headers, body: rebuilt });
  return rebuilt;
}

/**
 * The headers of a Node request as web `Headers`: the one view of a header every route handler is given.
 * A host that reads headers outside the bridge (its own route calling code that takes a web request)
 * builds them with this, so a header reads the same either way. Node has already joined a repeated
 * header (`cookie` with `; `, most others with `, `); one it keeps as a list (`set-cookie`) becomes one entry per value.
 * @param required.incoming - The request as Node read it; its headers are copied at the moment of the call.
 * @complexity O(headers) time and space; no I/O.
 */
export function nodeRequestHeaders({ incoming }: { readonly incoming: Pick<IncomingMessage, 'headers'> }, _optional: Record<string, never> = {}): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    // Node gives a repeated header as an array; each value becomes its own entry.
    for (const item of [value].flat()) if (item !== undefined) headers.append(name, item);
  }
  return headers;
}

function toWebRequest({ incoming, url, signal, parsedBody }: { incoming: IncomingMessage; url: URL; signal: AbortSignal; parsedBody: unknown }): Request {
  const headers = nodeRequestHeaders({ incoming });
  const method = incoming.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return new Request(url, { method, headers, signal });
  const body = requestBody({ incoming, headers, parsedBody });
  // `duplex` is required by Node's fetch for a stream body but missing from the DOM RequestInit type.
  const init: RequestInit & { duplex: 'half' } = { method, headers, signal, body, duplex: 'half' };
  return new Request(url, init);
}

/**
 * Resolves once the socket takes more (`drain`) or the client is gone (`close`/`error`). All three
 * listeners come off when it settles: one wait per full buffer, never a growing set of listeners
 * or promise reactions over a long-lived SSE connection.
 */
function writableOrGone(out: ServerResponse): Promise<void> {
  // Already gone: its `close` has fired and will not fire again.
  if (out.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    const settle = () => {
      out.off('drain', settle);
      out.off('close', settle);
      out.off('error', settle);
      resolve();
    };
    out.on('drain', settle);
    out.on('close', settle);
    out.on('error', settle);
  });
}

/** Writes chunks until the stream ends (true) or the client leaves (false); waits whenever the socket buffer is full. */
async function copyChunks({ reader, out }: { reader: ReadableStreamDefaultReader<Uint8Array>; out: ServerResponse }): Promise<boolean> {
  for (;;) {
    // Checked before reading (a client gone before the first read never fires `close` again) and after (never write to a closed socket).
    if (out.destroyed) return false;
    const chunk = await reader.read();
    if (out.destroyed) return false;
    if (chunk.done) return true;
    if (!out.write(chunk.value)) await writableOrGone(out);
  }
}

/**
 * Copies `body` to `out` with backpressure: when the socket buffer is full, reading waits for
 * `drain`, so a slow or stalled client holds the producer back instead of the stream filling
 * Node's memory (the producers' own queue ceilings, e.g. SSE, only work if this waits). A client
 * that leaves cancels the stream so its producer stops; cancelling also ends a read that is
 * waiting on an idle producer. The reader is always released, so nothing keeps the stream locked.
 * Returns false when the client left.
 * @throws When the stream itself fails; the caller cuts the connection.
 */
async function pipeBody({ body, out }: { body: ReadableStream<Uint8Array>; out: ServerResponse }): Promise<boolean> {
  const reader = body.getReader();
  const onLeave = () => { reader.cancel().catch(() => undefined); };
  out.once('close', onLeave);
  let finished = false;
  try {
    finished = await copyChunks({ reader, out });
    return finished;
  } finally {
    out.off('close', onLeave);
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/**
 * Adds a response's `Vary` fields to any a middleware or a route's static headers already set, as Express
 * `res.vary` does: a replacement would drop e.g. a CORS `Origin` and let a cache serve one origin's answer
 * to another. Field names are de-duplicated case-insensitively and `*` absorbs everything.
 * @complexity O(n) in the number of field names.
 */
function appendVary({ out, value }: { out: ServerResponse; value: string }, _optional: Record<string, never> = {}): void {
  const existing = out.getHeader('vary');
  const fields: string[] = [];
  for (const field of `${existing === undefined ? '' : String(existing)},${value}`.split(',')) {
    const name = field.trim();
    if (name && !fields.some((seen) => seen.toLowerCase() === name.toLowerCase())) fields.push(name);
  }
  out.setHeader('vary', fields.includes('*') ? '*' : fields.join(', '));
}

/**
 * Writes a web `Response` to a Node `ServerResponse`: status, headers (each `Set-Cookie` on its own line), then the
 * body with backpressure, headers flushed before the first chunk so a stream reaches the client before its first event.
 * For a host that builds its own `Response` and answers through Node (Express) instead of registering a route, so it
 * gets the same writer the dispatcher uses. `headOnly` writes the head and drops the body (a `HEAD` answer). A client
 * that leaves cancels the body's producer; a body that fails mid-way rejects, and the caller cuts the connection.
 * @throws When the body stream itself fails.
 */
export async function sendWebResponse({ response, res }: { response: Response; res: ServerResponse }, { headOnly = false }: { headOnly?: boolean } = {}): Promise<void> {
  const out = res;
  out.statusCode = response.status;
  // Set-Cookie cannot be comma-joined (cookie dates contain commas), so each one gets its own line.
  const cookies = response.headers.getSetCookie();
  response.headers.forEach((value, name) => {
    if (name === 'vary') appendVary({ out, value });
    else if (name !== 'set-cookie') out.setHeader(name, value);
  });
  for (const cookie of cookies) out.appendHeader('set-cookie', cookie);
  if (!response.body || headOnly) {
    await response.body?.cancel();
    out.end();
    return;
  }
  // Headers first, so a streamed (SSE) response reaches the client before its first event.
  out.flushHeaders();
  if (await pipeBody({ body: response.body, out })) out.end();
}

/** A finished plain-text answer; its length is stated, as Express stated it (a stream's is not, so only finished bodies get one). */
function plainText({ status, text }: { status: number; text: string }, { headers = {}, type = 'text/plain; charset=utf-8' }: { headers?: Record<string, string>; type?: string } = {}): Response {
  return new Response(text, { status, headers: { 'content-type': type, 'content-length': String(Buffer.byteLength(text)), ...headers } });
}

const MALFORMED_PATH_TEXT = 'The request address is not valid. A part of it is not valid percent-encoding.';

/** What Express answers an OPTIONS request with when a route owns the path: the allowed methods, as the `Allow` header and as the body. */
function optionsResponse({ allow }: { allow: readonly string[] }): Response {
  const methods = allow.join(',');
  return plainText({ status: 200, text: methods }, { headers: { allow: methods }, type: 'text/html; charset=utf-8' });
}

/** The dispatcher's own answer when no route takes the request (`match` null = no usable URL). */
function unroutedResponse(match: RouteMatch | null): Response {
  if (!match) return plainText({ status: 400, text: 'The request address is not valid. Check the URL and the Host header.' });
  if (match.kind === 'malformed-path') return plainText({ status: 400, text: MALFORMED_PATH_TEXT });
  if (match.kind === 'method-not-allowed') return plainText({ status: 405, text: 'Method Not Allowed' }, { headers: { allow: match.allow.join(', ') } });
  return plainText({ status: 404, text: 'Not Found' });
}

/** A short random reference that ties a caller's 500 to the server's log line; it reveals nothing about the failure. */
function newErrorReference(): string {
  return randomBytes(6).toString('hex');
}

// Exceptions can echo credentials; inspect keeps stack and code, then the shared redactor runs (as adapter.ts does)
// with the host's own key shapes added, since only the host knows them.
function stderrSink(extraPatterns: readonly SecretRedactionPattern[]): (required: UnhandledErrorReport) => void {
  return ({ error, reference }) => {
    process.stderr.write(`[@jini-ai/http-kit] route handler failed (reference ${reference}): ${redactSecrets({ input: inspect(error) }, { redactPii: false, extraPatterns })}\n`);
  };
}

/**
 * Wraps a sink so it can never throw into the dispatcher: a failing sink would otherwise turn a
 * reported error into a rejected `handle()` (which the Express adapter discards) and skip cutting
 * the connection. The fallback line names only the reference, never the error, so it cannot leak.
 */
function containedSink(sink: (required: UnhandledErrorReport) => void): (required: UnhandledErrorReport) => void {
  return (report) => {
    try {
      sink(report);
    } catch {
      try { process.stderr.write(`[@jini-ai/http-kit] the error sink failed; error reference ${report.reference} was not logged\n`); } catch { /* nothing left to report to */ }
    }
  };
}

/** The 500 a caller sees: plain words plus a reference they can paste to whoever runs the site. */
function internalErrorResponse(reference: string): Response {
  return plainText({ status: 500, text: `The server could not finish this request. Reference: ${reference}. Try again; if it keeps failing, send this reference to the site's owner.` });
}

interface Dispatch {
  readonly incoming: IncomingMessage;
  readonly out: ServerResponse;
  readonly method: string;
  readonly options: NodeDispatchOptions;
  readonly onUnhandledError: (required: UnhandledErrorReport) => void;
  readonly expressCompatible: boolean;
}

/** Calls the matched route and writes its answer; a handler failure goes to `next(error)` or a plain 500. */
async function serveRoute({ incoming, out, method, options, onUnhandledError }: Dispatch, { url, match }: { url: URL; match: Extract<RouteMatch, { kind: 'route' }> }): Promise<void> {
  // A client that hangs up aborts `request.signal`, which is how a handler or stream notices.
  // Observe response close: request close can fire when a POST body finishes while its response is still streaming. A normally finished response does not abort the signal.
  const abort = new AbortController();
  const onClose = () => { if (!out.writableFinished) abort.abort(); };
  out.on('close', onClose);
  const address = incoming.socket?.remoteAddress;
  let response: Response;
  try {
    const request = toWebRequest({ incoming, url, signal: abort.signal, parsedBody: options.parsedBody });
    response = await match.route.handler({ request, params: match.params, locals: { ...options.locals }, ...(address ? { client: { address } } : {}) });
  } catch (error) {
    out.off('close', onClose);
    if (options.next) {
      options.next(error);
      return;
    }
    const reference = newErrorReference();
    onUnhandledError({ error, reference });
    await sendWebResponse({ response: internalErrorResponse(reference), res: out })
      .catch(() => { out.destroy(); });
    return;
  }
  try {
    await sendWebResponse({ response, res: out }, { headOnly: method === 'HEAD' });
  } catch (error) {
    // Headers are already on the wire, so no error page can follow: cut the connection so the
    // client sees a failed response instead of a silently truncated one.
    onUnhandledError({ error, reference: newErrorReference() });
    out.destroy();
  } finally {
    out.off('close', onClose);
  }
}

/** Writes an answer the dispatcher itself chose; a failed write cuts the connection. */
function answerItself({ dispatch, response }: { dispatch: Dispatch; response: Response }): Promise<void> {
  return sendWebResponse({ response, res: dispatch.out }, { headOnly: dispatch.method === 'HEAD' })
    .catch(() => { dispatch.out.destroy(); });
}

/**
 * The answers an `expressCompatible` dispatcher gives instead of falling through: OPTIONS on a path a route owns, and a 400 for a
 * malformed `:name` segment. `undefined` means "not one of these", and the ordinary fall-through applies.
 */
function expressAnswer({ dispatch, match }: { dispatch: Dispatch; match: RouteMatch | null }): Promise<void> | undefined {
  if (!dispatch.expressCompatible || !match) return undefined;
  if (match.kind === 'method-not-allowed' && dispatch.method === 'OPTIONS') return answerItself({ dispatch, response: optionsResponse({ allow: match.allow }) });
  if (match.kind !== 'malformed-path') return undefined;
  if (!dispatch.options.next) return answerItself({ dispatch, response: unroutedResponse(match) });
  dispatch.options.next(Object.assign(new Error(MALFORMED_PATH_TEXT), { status: 400, statusCode: 400, expose: true }));
  return Promise.resolve();
}

/**
 * Creates a dispatcher with an empty route table.
 * @param optional.onUnhandledError - Where a handler failure goes when no `next` was given, with the reference its 500 shows (default: redacted, to stderr).
 * @param optional.redactionPatterns - Host key shapes the default stderr sink also masks.
 * @param optional.expressCompatible - Keep Express's answers for path spellings, a bad percent-escape and OPTIONS (see {@link NodeDispatcherOptions}).
 */
export function createNodeDispatcher(
  _required: Record<string, never> = {},
  { onUnhandledError, redactionPatterns = [], expressCompatible = false }: NodeDispatcherOptions = {},
): NodeDispatcher {
  const table = createRouteTable({}, { lenientPaths: expressCompatible });
  const report = containedSink(onUnhandledError ?? stderrSink(redactionPatterns));
  const dispatch = async (dispatchArgs: Dispatch): Promise<void> => {
    const target = requestTarget({ incoming: dispatchArgs.incoming, origin: dispatchArgs.options.origin });
    const match = target ? table.match({ method: dispatchArgs.method, pathname: target.pathname }) : null;
    if (target && match?.kind === 'route') return serveRoute(dispatchArgs, { url: target.url, match });
    const answer = expressAnswer({ dispatch: dispatchArgs, match });
    if (answer) return answer;
    // Not ours (or no usable URL): the host's own routes and validation decide, as before the dispatcher.
    if (dispatchArgs.options.next) return dispatchArgs.options.next();
    return answerItself({ dispatch: dispatchArgs, response: unroutedResponse(match) });
  };
  return {
    server: { route: (route) => table.route(route) },
    handle({ incoming, out }, options = {}) {
      // The promise never rejects (the Express adapter discards it): anything left is reported and
      // the connection cut. `report` is contained, and the cut runs even if it were not.
      return dispatch({ incoming, out, method: incoming.method ?? 'GET', options, onUnhandledError: report, expressCompatible }).catch((error: unknown) => {
        try {
          report({ error, reference: newErrorReference() });
        } finally {
          out.destroy();
        }
      });
    },
  };
}
