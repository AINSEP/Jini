/**
 * @module @jini-ai/mcp/server/daemon-client
 * Bounded-I/O JSON GET/POST against a caller-resolved trusted daemon base URL.
 * A long-lived MCP server must report a failed call and keep serving, so this transport throws
 * redacted errors for handleToolCall to convert rather than using the CLI transport's process.exit.
 * Bounded reads, timeouts and redaction follow CR-004/SEC-RB-009.
 *
 * This is a trusted, typically-loopback daemon URL, not attacker-controlled server metadata or
 * an external MCP OAuth endpoint; public-URL SSRF validation is therefore outside this contract.
 */
import { sanitizeUntrustedText } from '@jini-ai/core/text';
import { envelopeVocabulary } from './call-vocabulary.js';
import { describeDaemonFailure, isRecognizedEnvelope, type DaemonFailureText } from './daemon-error-text.js';

/** Request deadline. Generous enough for a slow tool call, short enough that a stalled daemon doesn't hang a stdio server turn forever. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Cap on a daemon response body. Comfortably larger than any real status/run envelope, small enough to bound worst-case memory from a hostile/broken daemon. */
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Thrown for a non-2xx daemon response. `status` lets a tool distinguish an unsupported route (404)
 * from other failures without pattern-matching the public error message.
 */
export class DaemonHttpError extends Error {
  readonly status: number;
  /** From the envelope; absent when the answer carried none. */
  readonly code?: string;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;
  constructor({ message, status, code, requestId, details }: { message: string; status: number; code?: string | undefined; requestId?: string | undefined; details?: Record<string, unknown> | undefined }) {
    super(message);
    this.status = status;
    if (code !== undefined) this.code = code;
    if (requestId !== undefined) this.requestId = requestId;
    if (details !== undefined) this.details = details;
    this.name = 'DaemonHttpError';
  }
}

/** What the reporter records for an unreadable answer: its shape only (status, route without query, content type, size), never body text. */
export class DaemonTransportFailure extends Error {
  readonly status: number;
  readonly route: string;
  readonly contentType: string | null;
  readonly bodyBytes: number;
  constructor({ status, route, contentType, bodyBytes }: { status: number; route: string; contentType: string | null; bodyBytes: number }) {
    super(`the daemon answered HTTP ${status} on ${route} with an unreadable ${contentType ?? 'untyped'} body of ${bodyBytes} bytes`);
    this.status = status;
    this.route = route;
    this.contentType = contentType;
    this.bodyBytes = bodyBytes;
    this.name = 'DaemonTransportFailure';
  }
}

/** Thrown internally when a response exceeds its byte cap; always translated to a plain `Error` before it crosses this module's public functions. */
export class DaemonResponseTooLargeError extends Error {
  readonly limitBytes: number;
  constructor({ limitBytes }: { limitBytes: number }) {
    super(`daemon response exceeded the ${limitBytes}-byte limit`);
    this.limitBytes = limitBytes;
    this.name = 'DaemonResponseTooLargeError';
  }
}

export interface DaemonRequestOptions {
  /** Exact host-registered IDs that may appear in diagnostics; credentials are always redacted. */
  diagnosticToolIds?: readonly string[];
  /** Further exact tokens this call may keep (names it was allowed to read); never a registration predicate. */
  trustedTokens?: readonly string[];
  /** Defaults to the global `fetch`; inject for tests. */
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  /** Request deadline in ms. Null delegates lifetime to caller/run cancellation; omission uses DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number | null;
  /** Maximum daemon response size in bytes before the read is aborted. Defaults to {@link DEFAULT_MAX_RESPONSE_BYTES}. */
  maxResponseBytes?: number;
  /** Caller-supplied cancellation signal; combined with the internal timeout signal, so either one aborts the request. */
  signal?: AbortSignal;
  /** Records an unreadable answer (never an envelope) once and returns the error ID shown to the model; structurally `ErrorReporter['record']`. */
  reportFailure?: (required: { error: unknown; step: string }) => { errorId: string };
}

/** A read body: the parsed JSON (`{}` when it was not JSON) and its size in bytes. */
interface DaemonBody {
  readonly data: unknown;
  readonly bytes: number;
}

function parseJsonLoose(text: string): unknown {
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Rejects up front when a declared `content-length` already exceeds the cap; a missing or non-numeric header defers to the byte-counted read. */
function assertDeclaredLengthWithinLimit(resp: Response, maxBytes: number): void {
  // `headers?.get?.` tolerates response-like doubles; a missing header becomes NaN (Number(null) would be 0).
  const declared = Number(resp.headers?.get?.('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw new DaemonResponseTooLargeError({ limitBytes: maxBytes });
}

/** Decodes a body stream chunk by chunk, rejecting as soon as the running byte total passes `maxBytes`. Always releases the reader lock. */
async function readStreamWithLimit(reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number): Promise<{ text: string; bytes: number }> {
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    for (let step = await reader.read(); !step.done; step = await reader.read()) {
      // A reader double may yield a step without bytes; count it as empty.
      const chunk = step.value ?? new Uint8Array();
      total += chunk.byteLength;
      if (total > maxBytes) throw new DaemonResponseTooLargeError({ limitBytes: maxBytes });
      text += decoder.decode(chunk, { stream: true });
    }
    return { text: text + decoder.decode(), bytes: total };
  } finally {
    reader.releaseLock();
  }
}

/** `resp.text()` fallback for response-like doubles with no reader, byte-checked (UTF-8) before it is parsed. */
async function readTextWithLimit(resp: Response, maxBytes: number): Promise<{ text: string; bytes: number }> {
  const text = await resp.text();
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes) throw new DaemonResponseTooLargeError({ limitBytes: maxBytes });
  return { text, bytes };
}

/**
 * Read `resp`'s body as JSON without ever buffering past `maxBytes`. Prefers streaming via
 * `resp.body`'s reader (what a real `fetch()` `Response` provides), rejecting mid-stream once the
 * cap is exceeded rather than buffering a huge response whole first; falls back to `resp.text()`
 * (still byte-checked before parsing) for response-like test doubles that expose no reader. A body
 * that isn't valid JSON resolves to `{}` rather than throwing — a malformed daemon response should
 * surface as a normal non-2xx/shape mismatch to the caller, not an opaque parse exception.
 */
async function readJsonWithLimit(resp: Response, maxBytes: number): Promise<DaemonBody> {
  assertDeclaredLengthWithinLimit(resp, maxBytes);
  const body = resp.body;
  const { text, bytes } = body != null && typeof body.getReader === 'function'
    ? await readStreamWithLimit(body.getReader(), maxBytes)
    : await readTextWithLimit(resp, maxBytes);
  return { data: parseJsonLoose(text), bytes };
}

/** Formats a `fetch()` rejection (network-unreachable) into a message safe to surface as an MCP tool error. */
function formatConnectionFailure(err: unknown, baseUrl: string, options: DaemonRequestOptions): string {
  const cause = err !== null && typeof err === 'object' ? (err as { cause?: unknown }).cause : null;
  const code =
    cause !== null && typeof cause === 'object' && typeof (cause as { code?: unknown }).code === 'string'
      ? (cause as { code: string }).code
      : null;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return safeDiagnostic({ text: `cannot reach the daemon at ${baseUrl}. Is it running?` }, options);
  }
  const message = err instanceof Error ? err.message : String(err);
  return safeDiagnostic({ text: message }, options);
}

const CREDENTIAL_HEADER_RE = /^(?:(?:proxy-)?authorization|x-api-key)$/i;

/** Remove URL credentials, queries and fragments before ordinary secret/control redaction.
 * Even short query tokens are secrets; token-length heuristics cannot protect them.
 * Opaque runs stay masked except identifier-shaped slugs/tool IDs; configured header values
 * also use exact-secret masking at eight characters or more;
 * short header values would otherwise erase ordinary words from recovery hints.
 * Credential headers (the run credential) are masked at any length: a short secret leaking
 * outweighs a hint losing a few characters. Core never substitutes them inside a credential
 * label or marker, so they cannot split another credential's label.
 * @complexity Local scans of diagnostic text and header values, plus core's exact-secret replacements.
 */
export function safeDiagnostic({ text }: { text: string }, options: DaemonRequestOptions = {}): string {
  const redacted = text.replace(/https?:\/\/[^\s<>"']+/gi, url => {
    try {
      const parsed = new URL(url);
      if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash) return url;
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return '[redacted URL]';
    }
  });
  const headerSecrets = Object.entries(options.headers ?? {}).flatMap(([name, value]) => [value, value.replace(/^(?:Bearer|Basic)\s+/i, '')]
    .filter(secret => CREDENTIAL_HEADER_RE.test(name) || secret.length >= 8));
  return sanitizeUntrustedText({ text: redacted }, {
    keepIdentifiers: true,
    exactSecrets: headerSecrets,
    ...(options.diagnosticToolIds === undefined && options.trustedTokens === undefined ? {}
      : { diagnosticToolIds: [...(options.diagnosticToolIds ?? []), ...(options.trustedTokens ?? [])] }),
  });
}

/** The error of a non-2xx answer: a recognized envelope through the sanitizer; anything else reported once and shown as fixed words plus the returned ID. */
function buildDaemonHttpError(
  { resp, route, body }: { resp: Response; route: string; body: DaemonBody },
  options: DaemonRequestOptions,
): DaemonHttpError {
  const { status } = resp;
  const readable = isRecognizedEnvelope({ data: body.data });
  if (readable) {
    const failure = describeDaemonFailure({ status, data: body.data, readable });
    // The envelope's own names are trusted for this one format; a name masked here cannot be restored by a later pass.
    const trustedTokens = [...(options.trustedTokens ?? []), ...envelopeVocabulary(failure)];
    return new DaemonHttpError({ ...failure, message: safeDiagnostic({ text: failure.message }, { ...options, trustedTokens }), status });
  }
  const error = new DaemonTransportFailure({ status, route: route.split('?', 1)[0] ?? route,
    contentType: resp.headers?.get?.('content-type') ?? null, bodyBytes: body.bytes });
  const errorId = options.reportFailure?.({ error, step: 'mcp daemon call' }).errorId;
  const failure: DaemonFailureText = describeDaemonFailure({ status, data: body.data, readable }, { ...(errorId === undefined ? {} : { errorId }) });
  return new DaemonHttpError({ message: failure.message, status });
}

interface DaemonRequestInit {
  readonly method: 'GET' | 'POST';
  readonly body?: unknown;
}

/**
 * Arms the request deadline and combines it with the caller's signal, so either one aborts the
 * request. `clear` must run once the request settles.
 */
function startDeadline({ route, timeoutMs }: { route: string; timeoutMs: number | null }, { signal }: { signal?: AbortSignal | undefined }): { signal: AbortSignal; clear: () => void } {
  const timeoutController = new AbortController();
  // An interactive delegated call is bounded by its run/caller cancellation, not human reading time.
  if (timeoutMs === null) return { signal: signal ?? timeoutController.signal, clear: () => {} };
  const timeoutHandle = setTimeout(() => {
    timeoutController.abort(new Error(`request to ${route} timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  // A stdio server turn shouldn't be kept alive purely by this timer.
  (timeoutHandle as unknown as { unref?: () => void }).unref?.();
  return {
    signal: signal !== undefined ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal,
    clear: () => clearTimeout(timeoutHandle),
  };
}

/** Builds the `fetch` init: POST carries a JSON body (default `{}`) and a content-type the caller's headers may override; GET carries neither. */
function buildFetchInit(init: DaemonRequestInit, { headers, signal }: { headers: Record<string, string> | undefined; signal: AbortSignal }): RequestInit {
  if (init.method === 'GET') return { method: 'GET', headers: { ...headers }, signal };
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(init.body ?? {}), signal };
}

/** Reads the body under the byte cap, converting a cap overrun into a redacted `Error`; any other read failure propagates unchanged. */
async function readBodyOrExplain({ resp, url, maxResponseBytes }: { resp: Response; url: string; maxResponseBytes: number }, options: DaemonRequestOptions): Promise<DaemonBody> {
  try {
    return await readJsonWithLimit(resp, maxResponseBytes);
  } catch (err) {
    if (err instanceof DaemonResponseTooLargeError) {
      throw new Error(safeDiagnostic({ text: `response from ${url} exceeded the ${err.limitBytes}-byte limit` }, options));
    }
    throw err;
  }
}

/**
 * Shared transport core behind {@link getDaemonJson} and {@link postDaemonJson}: fetch
 * `<baseUrl><route>` with a bounded timeout and response-size cap, and turn a network failure or a
 * non-2xx daemon response into a thrown, already-redacted `Error` — this function either resolves
 * with the parsed body or throws. Never calls `process.exit`.
 */
async function requestDaemonJson(
  baseUrl: string,
  route: string,
  init: DaemonRequestInit,
  options: DaemonRequestOptions = {},
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${baseUrl}${route}`;
  const deadline = startDeadline({ route, timeoutMs: options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs }, { signal: options.signal });

  try {
    let resp: Response;
    try {
      resp = await fetchImpl(url, buildFetchInit(init, { headers: options.headers, signal: deadline.signal }));
    } catch (err) {
      throw new Error(formatConnectionFailure(err, baseUrl, options));
    }

    const body = await readBodyOrExplain({ resp, url, maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES }, options);
    if (!resp.ok) throw buildDaemonHttpError({ resp, route, body }, options);
    return body.data;
  } finally {
    deadline.clear();
  }
}

/** `GET <baseUrl><route>` and return the parsed JSON response, throwing on network failure or a non-2xx status. */
export async function getDaemonJson<T = unknown>({ baseUrl, route }: { baseUrl: string; route: string }, options?: DaemonRequestOptions): Promise<T> {
  return requestDaemonJson(baseUrl, route, { method: 'GET' }, options) as Promise<T>;
}

/** `POST body` (JSON-serialized) to `<baseUrl><route>` and return the parsed JSON response, throwing on network failure or a non-2xx status. */
export async function postDaemonJson<T = unknown>({ baseUrl, route, body }: { baseUrl: string; route: string; body: unknown }, options?: DaemonRequestOptions): Promise<T> {
  return requestDaemonJson(baseUrl, route, { method: 'POST', body }, options) as Promise<T>;
}
