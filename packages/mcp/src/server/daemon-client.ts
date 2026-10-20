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
  constructor({ message, status }: { message: string; status: number }) {
    super(message);
    this.status = status;
    this.name = 'DaemonHttpError';
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
  /** Defaults to the global `fetch`; inject for tests. */
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  /** Request deadline in ms. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Maximum daemon response size in bytes before the read is aborted. Defaults to {@link DEFAULT_MAX_RESPONSE_BYTES}. */
  maxResponseBytes?: number;
  /** Caller-supplied cancellation signal; combined with the internal timeout signal, so either one aborts the request. */
  signal?: AbortSignal;
}

interface DaemonErrorEnvelope {
  error?: { code?: unknown; message?: unknown };
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
async function readStreamWithLimit(reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number): Promise<string> {
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
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/** `resp.text()` fallback for response-like doubles with no reader, byte-checked (UTF-8) before it is parsed. */
async function readTextWithLimit(resp: Response, maxBytes: number): Promise<string> {
  const text = await resp.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new DaemonResponseTooLargeError({ limitBytes: maxBytes });
  return text;
}

/**
 * Read `resp`'s body as JSON without ever buffering past `maxBytes`. Prefers streaming via
 * `resp.body`'s reader (what a real `fetch()` `Response` provides), rejecting mid-stream once the
 * cap is exceeded rather than buffering a huge response whole first; falls back to `resp.text()`
 * (still byte-checked before parsing) for response-like test doubles that expose no reader. A body
 * that isn't valid JSON resolves to `{}` rather than throwing — a malformed daemon response should
 * surface as a normal non-2xx/shape mismatch to the caller, not an opaque parse exception.
 */
async function readJsonWithLimit(resp: Response, maxBytes: number): Promise<unknown> {
  assertDeclaredLengthWithinLimit(resp, maxBytes);
  const body = resp.body;
  const text = body != null && typeof body.getReader === 'function'
    ? await readStreamWithLimit(body.getReader(), maxBytes)
    : await readTextWithLimit(resp, maxBytes);
  return parseJsonLoose(text);
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

/** Remove URL credentials, queries and fragments before ordinary secret/control redaction.
 * Even short query tokens are secrets; token-length heuristics cannot protect them.
 * @complexity O(n) in diagnostic text, plus URL parsing for each URL.
 */
function safeDiagnostic({ text }: { text: string }, options: DaemonRequestOptions): string {
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
  return sanitizeUntrustedText({ text: redacted }, options.diagnosticToolIds === undefined ? {} : { diagnosticToolIds: options.diagnosticToolIds });
}

/** Formats a non-2xx daemon response into a message safe to surface as an MCP tool error. */
function formatDaemonHttpError(status: number, url: string, data: unknown, options: DaemonRequestOptions): string {
  const envelope = data as DaemonErrorEnvelope;
  const code = typeof envelope?.error?.code === 'string' ? envelope.error.code : undefined;
  const rawMessage = typeof envelope?.error?.message === 'string' ? envelope.error.message : undefined;
  const codePrefix = code !== undefined ? `${code}: ` : '';
  return safeDiagnostic({ text: `daemon ${status} on ${url}: ${codePrefix}${rawMessage ?? `HTTP ${status}`}` }, options);
}

interface DaemonRequestInit {
  readonly method: 'GET' | 'POST';
  readonly body?: unknown;
}

/**
 * Arms the request deadline and combines it with the caller's signal, so either one aborts the
 * request. `clear` must run once the request settles.
 */
function startDeadline({ route, timeoutMs }: { route: string; timeoutMs: number }, { signal }: { signal?: AbortSignal | undefined }): { signal: AbortSignal; clear: () => void } {
  const timeoutController = new AbortController();
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
async function readBodyOrExplain({ resp, url, maxResponseBytes }: { resp: Response; url: string; maxResponseBytes: number }, options: DaemonRequestOptions): Promise<unknown> {
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
  const deadline = startDeadline({ route, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS }, { signal: options.signal });

  try {
    let resp: Response;
    try {
      resp = await fetchImpl(url, buildFetchInit(init, { headers: options.headers, signal: deadline.signal }));
    } catch (err) {
      throw new Error(formatConnectionFailure(err, baseUrl, options));
    }

    const data = await readBodyOrExplain({ resp, url, maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES }, options);
    if (!resp.ok) {
      throw new DaemonHttpError({ message: formatDaemonHttpError(resp.status, url, data, options), status: resp.status });
    }
    return data;
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
