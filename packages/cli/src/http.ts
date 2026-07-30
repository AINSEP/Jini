/**
 * @module http
 *
 * HTTP-client-mode transport plumbing, ported from OD's
 * `apps/daemon/src/cli.ts` `surfaceFetchError`/`postJsonToDaemon` (see
 * `source-map.md`). This is the "HTTP-client mode default" half of
 * extraction-plan §3's `@jini-ai/cli` spec: fetch a daemon route, translate a
 * network failure or a daemon error envelope into the structured exit-code
 * contract from `errors.ts`.
 */

import { DEFAULT_CLI_EXIT_CODES, exitWithStructuredError, structuredErrorData, type ExitCodeTable } from './errors.js';
import { sanitizeDaemonUrlForDisplay } from './daemon-url.js';
import { sanitizeUntrustedText } from './redact.js';

export interface SurfaceFetchErrorOptions {
  /** Defaults to `process.stderr.write`; inject for tests. */
  write?: (text: string) => void;
}

/**
 * Format a `fetch()` rejection (network-unreachable, sandbox-denied) into a
 * human-readable stderr line, with a hint when the underlying cause looks
 * like a sandboxed-environment outbound-connect denial. Per CR-004/SEC-RB-009,
 * `daemonUrl` and the failure detail are both sanitized before they reach
 * stderr — a `daemonUrl` with embedded userinfo, or a cause message that
 * embeds terminal control sequences or a leaked credential, must not be
 * printed verbatim.
 */
export function surfaceFetchError(err: unknown, daemonUrl: string, options: SurfaceFetchErrorOptions = {}): void {
  const write = options.write ?? ((text: string) => { process.stderr.write(text); });
  const cause = err !== null && typeof err === 'object' ? (err as { cause?: unknown }).cause : null;
  const code =
    cause !== null && typeof cause === 'object' && typeof (cause as { code?: unknown }).code === 'string'
      ? (cause as { code: string }).code
      : null;
  const causeMessage =
    cause !== null && typeof cause === 'object' && typeof (cause as { message?: unknown }).message === 'string'
      ? (cause as { message: string }).message
      : '';
  let detail = err instanceof Error ? err.message : String(err);
  if (code !== null) detail = `${code}${causeMessage.length > 0 ? ` — ${causeMessage}` : ''}`;
  else if (causeMessage.length > 0) detail = causeMessage;
  write(`failed to reach daemon at ${sanitizeDaemonUrlForDisplay(daemonUrl)}: ${sanitizeUntrustedText(detail)}\n`);
  if (code === 'EPERM' || code === 'ENETUNREACH') {
    write(
      'hint: outbound connect was denied, likely by a sandbox policy. ' +
        'If this command ran inside an agent sandbox, check its network policy — ' +
        'the daemon itself is unaffected and can be reached from a regular shell.\n',
    );
  }
}

interface DaemonJsonErrorBody {
  error?: { code?: unknown; message?: unknown; data?: unknown };
}

/** Default request deadline. Generous enough for a slow agent run kickoff, short enough that a stalled daemon doesn't hang a CLI invocation forever. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Default cap on a daemon response body. Comfortably larger than any real status/error envelope, small enough to bound worst-case memory from a hostile/broken daemon. */
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** Thrown internally by {@link readJsonWithLimit} when a response exceeds its byte cap; never escapes {@link postJsonToDaemon}. */
class ResponseTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`response exceeded the ${limitBytes}-byte limit`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Read `resp`'s body as JSON without ever buffering past `maxBytes`. Prefers streaming via
 * `resp.body`'s reader (what a real `fetch()` `Response` provides) so a huge response is
 * rejected mid-stream instead of first being buffered whole; falls back to `resp.text()` (still
 * byte-checked before parsing) and finally to `resp.json()` for response-like objects that
 * implement neither — the shape test doubles in this package's own suite use. A body that isn't
 * valid JSON resolves to `{}`, matching this module's previous behavior.
 */
async function readJsonWithLimit(resp: Response, maxBytes: number): Promise<unknown> {
  const contentLength = resp.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) throw new ResponseTooLargeError(maxBytes);
  }

  const body = resp.body;
  if (body != null && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done === true) break;
        if (value !== undefined) {
          total += value.byteLength;
          if (total > maxBytes) throw new ResponseTooLargeError(maxBytes);
          text += decoder.decode(value, { stream: true });
        }
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    try {
      return text.length > 0 ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  }

  if (typeof (resp as { text?: unknown }).text === 'function') {
    const text = await resp.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ResponseTooLargeError(maxBytes);
    try {
      return text.length > 0 ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  }

  return await resp.json().catch(() => ({}));
}

export interface PostJsonToDaemonOptions {
  headers?: Record<string, string>;
  exitCodes?: ExitCodeTable;
  /** Defaults to the global `fetch`; inject for tests. */
  fetchImpl?: typeof fetch;
  /** Defaults to `process.stderr.write`; inject for tests. Used only for the unrecognized-error-code fallback path. */
  write?: (text: string) => void;
  /** Defaults to `process.exit`; inject for tests (must not return). Used only for the unrecognized-error-code fallback path. */
  exit?: (code: number) => never;
  /** Caller-supplied cancellation signal; combined with the internal timeout signal, so either one aborts the request. */
  signal?: AbortSignal;
  /** Request deadline in ms. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Maximum daemon response size in bytes before the read is aborted. Defaults to {@link DEFAULT_MAX_RESPONSE_BYTES}. */
  maxResponseBytes?: number;
}

/** `GET`'s options are identical to {@link PostJsonToDaemonOptions} minus the (POST-only) request body. */
export type GetJsonFromDaemonOptions = PostJsonToDaemonOptions;

interface RequestInit_ {
  readonly method: 'GET' | 'POST';
  readonly body?: unknown;
}

/**
 * Shared transport core behind {@link postJsonToDaemon} and {@link getJsonFromDaemon}: fetch
 * `<base><route>` with a bounded timeout and response-size cap, and map a network failure or a
 * non-2xx daemon response through the structured error contract (`errors.ts`) instead of
 * returning — this function either resolves with the parsed body or never returns. Per
 * CR-004/SEC-RB-009, daemon-supplied error detail is redacted before it reaches stderr rather than
 * dumped verbatim. Both public wrappers exist only to fix `init.method`/`init.body` at their own
 * call site — nothing method-specific lives here beyond that.
 */
async function requestJsonFromDaemon(
  base: string,
  route: string,
  init: RequestInit_,
  options: PostJsonToDaemonOptions = {},
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const write = options.write ?? ((text: string) => { process.stderr.write(text); });
  const exit = options.exit ?? ((exitCode: number) => process.exit(exitCode));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const structuredOptions = {
    write,
    exit,
    ...(options.exitCodes !== undefined ? { exitCodes: options.exitCodes } : {}),
  };

  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    timeoutController.abort(new Error(`request to ${route} timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  // A short-lived CLI invocation shouldn't be kept alive purely by this timer.
  (timeoutHandle as unknown as { unref?: () => void }).unref?.();
  const signal = options.signal !== undefined ? AbortSignal.any([options.signal, timeoutController.signal]) : timeoutController.signal;

  // The timeout signal stays live through both the initial fetch *and* the body read below — a
  // daemon that returns headers promptly but then drips its body slowly should still be bounded
  // by the same deadline, not just the connection phase.
  let resp: Response;
  let data: unknown;
  try {
    try {
      resp = await fetchImpl(`${base}${route}`, {
        method: init.method,
        headers: init.method === 'POST' ? { 'content-type': 'application/json', ...options.headers } : { ...options.headers },
        ...(init.method === 'POST' ? { body: JSON.stringify(init.body) } : {}),
        signal,
      });
    } catch (err) {
      surfaceFetchError(err, base, { write });
      return exitWithStructuredError(
        { code: 'daemon-not-running', message: `Cannot reach daemon at ${sanitizeDaemonUrlForDisplay(base)}` },
        structuredOptions,
      );
    }

    try {
      data = await readJsonWithLimit(resp, maxResponseBytes);
    } catch (err) {
      if (err instanceof ResponseTooLargeError) {
        write(`response from ${sanitizeDaemonUrlForDisplay(base)}${route} exceeded the ${err.limitBytes}-byte limit; aborting.\n`);
        return exit(1);
      }
      throw err;
    }
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!resp.ok) {
    const errorObj = (data as DaemonJsonErrorBody).error;
    const exitCodes: ExitCodeTable = { ...DEFAULT_CLI_EXIT_CODES, ...options.exitCodes };
    const code = typeof errorObj?.code === 'string' && errorObj.code in exitCodes ? errorObj.code : null;
    if (code !== null) {
      const rawMessage = typeof errorObj?.message === 'string' ? errorObj.message : `HTTP ${resp.status}`;
      const message = sanitizeUntrustedText(rawMessage);
      const errorData = structuredErrorData(errorObj);
      return exitWithStructuredError(
        { code, message, ...(errorData !== undefined ? { data: errorData } : {}) },
        structuredOptions,
      );
    }
    const rawExcerpt = describeUnrecognizedDaemonPayload(data);
    write(`${init.method} ${route} failed: ${resp.status}${rawExcerpt}\n`);
    return exit(1);
  }
  return data;
}

/**
 * `POST` a JSON body to `<base><route>` and return the parsed JSON response.
 * A network failure or a non-2xx daemon response both exit via the
 * structured error contract (`errors.ts`) instead of returning — this
 * function either resolves with the parsed body or never returns.
 *
 * Per CR-004/SEC-RB-009, this now enforces a request deadline (combined with
 * an optional caller `signal`) and a maximum response size, and redacts
 * daemon-supplied error detail before it reaches stderr instead of dumping
 * it verbatim.
 */
export async function postJsonToDaemon(
  base: string,
  route: string,
  body: unknown,
  options: PostJsonToDaemonOptions = {},
): Promise<unknown> {
  return requestJsonFromDaemon(base, route, { method: 'POST', body }, options);
}

/**
 * `GET` `<base><route>` and return the parsed JSON response. Same transport contract as
 * {@link postJsonToDaemon} (timeout, response-size cap, structured-error mapping, redaction) with
 * no request body — for read-only daemon routes such as `@jini-ai/http-kit`'s `GET /api/runs` and
 * `GET /api/runs/:runId`.
 */
export async function getJsonFromDaemon(
  base: string,
  route: string,
  options: GetJsonFromDaemonOptions = {},
): Promise<unknown> {
  return requestJsonFromDaemon(base, route, { method: 'GET' }, options);
}

/** A bounded, redacted excerpt of an unrecognized daemon error payload — never the full raw body. */
function describeUnrecognizedDaemonPayload(data: unknown): string {
  let raw: string;
  try {
    raw = JSON.stringify(data) ?? '';
  } catch {
    raw = String(data);
  }
  if (raw.length === 0) return '';
  return ` (daemon response, redacted/truncated): ${sanitizeUntrustedText(raw)}`;
}
