/**
 * @module http
 *
 * HTTP-client-mode transport plumbing, ported from OD's
 * `apps/daemon/src/cli.ts` `surfaceFetchError`/`postJsonToDaemon` (see
 * `archived provenance ledger`). This is the "HTTP-client mode default" half of
 * extraction-plan §3's `@jini-ai/cli` spec: fetch a daemon route, translate a
 * network failure or a daemon error envelope into the structured exit-code
 * contract from `errors.ts`.
 */

import { DEFAULT_CLI_EXIT_CODES, exitWithStructuredError, structuredErrorData, type ExitCodeTable } from './errors.js';
import { sanitizeDaemonUrlForDisplay } from './daemon-url.js';
import { sanitizeUntrustedText } from '@jini-ai/core/text';

export interface SurfaceFetchErrorOptions {
  /** Defaults to `process.stderr.write`; inject for tests. */
  write?: (requiredArgs: { text: string }) => void;
}

function writeToStderr({ text }: { text: string }): void {
  process.stderr.write(text);
}

function exitProcess({ code }: { code: number }): never {
  return process.exit(code);
}

/** `err.message` for an `Error`, `String(err)` for anything else. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `value[key]` when `value` is an object whose `key` field is a string; `null` otherwise. */
function stringField(value: unknown, key: 'code' | 'message'): string | null {
  if (value === null || typeof value !== 'object') return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : null;
}

/** `cause.code` (with `cause.message` when present), else `cause.message`, else the error's own text. */
function describeFetchFailure(err: unknown): { code: string | null; detail: string } {
  const cause = err !== null && typeof err === 'object' ? (err as { cause?: unknown }).cause : null;
  const code = stringField(cause, 'code');
  const causeMessage = stringField(cause, 'message') ?? '';
  // Stringified up front, before the cause-based choice below, exactly as the original did — so a
  // value whose String() throws still throws even when a cause code is present.
  const ownText = errorText(err);
  if (code !== null) return { code, detail: causeMessage.length > 0 ? `${code} — ${causeMessage}` : code };
  return { code, detail: causeMessage.length > 0 ? causeMessage : ownText };
}

/** Cause codes that indicate an outbound connect denied by a sandbox policy rather than a down daemon. */
const SANDBOX_DENIAL_CODES: ReadonlySet<string> = new Set(['EPERM', 'ENETUNREACH']);

/**
 * Format a `fetch()` rejection (network-unreachable, sandbox-denied) into a
 * human-readable stderr line, with a hint when the underlying cause looks
 * like a sandboxed-environment outbound-connect denial. Per CR-004/SEC-RB-009,
 * `daemonUrl` and the failure detail are both sanitized before they reach
 * stderr — a `daemonUrl` with embedded userinfo, or a cause message that
 * embeds terminal control sequences or a leaked credential, must not be
 * printed verbatim.
 */
export function surfaceFetchError({ err, daemonUrl }: { err: unknown; daemonUrl: string }, options: SurfaceFetchErrorOptions = {}): void {
  const write = options.write ?? writeToStderr;
  const { code, detail } = describeFetchFailure(err);
  write({ text: `failed to reach daemon at ${sanitizeDaemonUrlForDisplay({ url: daemonUrl })}: ${sanitizeUntrustedText({ text: detail })}\n` });
  if (code !== null && SANDBOX_DENIAL_CODES.has(code)) {
    write({ text:
      'hint: outbound connect was denied, likely by a sandbox policy. ' +
        'If this command ran inside an agent sandbox, check its network policy — ' +
        'the daemon itself is unaffected and can be reached from a regular shell.\n',
    });
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

/** Rejects up front when `resp` declares a numeric `content-length` above `maxBytes`; a missing or non-numeric header is left to the byte-counting read. */
function assertDeclaredLengthWithin(resp: Response, maxBytes: number): void {
  const contentLength = resp.headers?.get?.('content-length');
  if (contentLength === null || contentLength === undefined) return;
  const declared = Number(contentLength);
  if (Number.isFinite(declared) && declared > maxBytes) throw new ResponseTooLargeError(maxBytes);
}

/** Drains `body` as UTF-8 text, throwing {@link ResponseTooLargeError} as soon as the running byte count passes `maxBytes`. */
async function readStreamText(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done === true) return text + decoder.decode();
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new ResponseTooLargeError(maxBytes);
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/** `resp.text()`, byte-checked against `maxBytes` before it is parsed. */
async function readTextWithin(resp: Response, maxBytes: number): Promise<string> {
  const text = await resp.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ResponseTooLargeError(maxBytes);
  return text;
}

/** Parses `text` as JSON; an empty or non-JSON body resolves to `{}`. */
function parseJsonOrEmpty(text: string): unknown {
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
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
  assertDeclaredLengthWithin(resp, maxBytes);
  const body = resp.body;
  if (body != null && typeof body.getReader === 'function') return parseJsonOrEmpty(await readStreamText(body, maxBytes));
  if (typeof (resp as { text?: unknown }).text === 'function') return parseJsonOrEmpty(await readTextWithin(resp, maxBytes));
  return await resp.json().catch(() => ({}));
}

export interface PostJsonToDaemonOptions {
  headers?: Record<string, string>;
  exitCodes?: ExitCodeTable;
  /** Defaults to the global `fetch`; inject for tests. */
  fetchImpl?: typeof fetch;
  /** Defaults to `process.stderr.write`; inject for every structured failure path. */
  write?: (requiredArgs: { text: string }) => void;
  /** Defaults to `process.exit`; inject for every structured failure path (must not return). */
  exit?: (requiredArgs: { code: number }) => never;
  /** Caller-supplied cancellation signal; combined with the internal timeout signal, so either one aborts the request. */
  signal?: AbortSignal;
  /** Request deadline in ms. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Maximum daemon response size in bytes before the read is aborted. Defaults to {@link DEFAULT_MAX_RESPONSE_BYTES}. */
  maxResponseBytes?: number;
}

/** `GET`'s options are identical to {@link PostJsonToDaemonOptions} minus the (POST-only) request body. */
export type GetJsonFromDaemonOptions = PostJsonToDaemonOptions;

interface DaemonRequestInit {
  readonly method: 'GET' | 'POST';
  readonly body?: unknown;
}

/** The `{write, exit, exitCodes?}` options every structured exit in this module shares. */
interface StructuredExitOptions {
  readonly write: (requiredArgs: { text: string }) => void;
  readonly exit: (requiredArgs: { code: number }) => never;
  readonly exitCodes?: ExitCodeTable;
}

function structuredExitOptions(options: PostJsonToDaemonOptions): StructuredExitOptions {
  return {
    write: options.write ?? writeToStderr,
    exit: options.exit ?? exitProcess,
    ...(options.exitCodes !== undefined ? { exitCodes: options.exitCodes } : {}),
  };
}

interface Deadline {
  readonly controller: AbortController;
  /** The deadline's own signal, combined with the caller's when one was given. */
  readonly signal: AbortSignal;
  readonly clear: () => void;
}

/** Arms the request deadline: aborts `controller` with a route-naming error after `timeoutMs`. */
function startDeadline({ route, timeoutMs }: { route: string; timeoutMs: number }, { signal }: { signal?: AbortSignal | undefined }): Deadline {
  const controller = new AbortController();
  const handle = setTimeout(() => {
    controller.abort(new Error(`request to ${route} timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  // A short-lived CLI invocation shouldn't be kept alive purely by this timer.
  (handle as unknown as { unref?: () => void }).unref?.();
  return {
    controller,
    signal: signal !== undefined ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    clear: () => { clearTimeout(handle); },
  };
}

/** POST adds a JSON content-type (a caller header of the same name still wins) and the serialized body; GET sends only the caller headers. */
function buildFetchInit(init: DaemonRequestInit, headers: Record<string, string> | undefined, signal: AbortSignal): RequestInit {
  if (init.method === 'POST') {
    return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(init.body), signal };
  }
  return { method: 'GET', headers: { ...headers }, signal };
}

/** A rejected `fetch()` (or a request init that could not be built) exits as `daemon-not-running`, carrying {@link surfaceFetchError}'s lines as diagnostics. */
function exitForFetchFailure({ err, base }: { err: unknown; base: string }, structured: StructuredExitOptions): never {
  const diagnostics: string[] = [];
  surfaceFetchError({ err, daemonUrl: base }, { write: ({ text }) => { diagnostics.push(text.trimEnd()); } });
  return exitWithStructuredError({ code: 'daemon-not-running', message: `Cannot reach daemon at ${sanitizeDaemonUrlForDisplay({ url: base })}` }, { data: { diagnostics }, ...structured });
}

/** A body-read failure: an oversized body aborts the in-flight request and exits `response-too-large`; anything else exits `request-failed`. */
function exitForReadFailure({ err, base, route, controller }: { err: unknown; base: string; route: string; controller: AbortController }, structured: StructuredExitOptions): never {
  if (err instanceof ResponseTooLargeError) {
    controller.abort(err);
    return exitWithStructuredError({ code: 'response-too-large', message: `response from ${sanitizeDaemonUrlForDisplay({ url: base })}${route} exceeded the ${err.limitBytes}-byte limit; aborting.` }, structured);
  }
  return exitWithStructuredError({ code: 'request-failed', message: sanitizeUntrustedText({ text: errorText(err) }) }, structured);
}

/**
 * Fetches `<base><route>` and reads its JSON body under one deadline. The timeout signal stays
 * live through both the initial fetch *and* the body read — a daemon that returns headers
 * promptly but then drips its body slowly should still be bounded by the same deadline, not
 * just the connection phase.
 */
async function fetchJsonWithinDeadline(
  { base, route, init }: { base: string; route: string; init: DaemonRequestInit },
  { options, structured }: { options: PostJsonToDaemonOptions; structured: StructuredExitOptions },
): Promise<{ resp: Response; data: unknown }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const deadline = startDeadline({ route, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS }, { signal: options.signal });
  try {
    let resp: Response;
    try {
      // The init is built inside this try on purpose: a body JSON.stringify cannot serialize is
      // reported through the same daemon-not-running path as a rejected fetch, as it always was.
      resp = await fetchImpl(`${base}${route}`, buildFetchInit(init, options.headers, deadline.signal));
    } catch (err) {
      return exitForFetchFailure({ err, base }, structured);
    }
    try {
      return { resp, data: await readJsonWithLimit(resp, maxResponseBytes) };
    } catch (err) {
      return exitForReadFailure({ err, base, route, controller: deadline.controller }, structured);
    }
  } finally {
    deadline.clear();
  }
}

/** Maps a non-2xx daemon response to a structured exit: a recognized `error.code` keeps its own exit code and sanitized message/data; anything else exits with a bounded, redacted payload excerpt. */
function exitForDaemonError(
  { resp, data, method, route }: { resp: Response; data: unknown; method: DaemonRequestInit['method']; route: string },
  structured: StructuredExitOptions,
): never {
  const errorObj = (data as DaemonJsonErrorBody | null)?.error;
  const exitCodes: ExitCodeTable = { ...DEFAULT_CLI_EXIT_CODES, ...structured.exitCodes };
  const rawCode = errorObj?.code;
  if (typeof rawCode === 'string' && rawCode in exitCodes) {
    const rawMessage = typeof errorObj?.message === 'string' ? errorObj.message : `HTTP ${resp.status}`;
    const errorData = structuredErrorData({ error: errorObj });
    return exitWithStructuredError({ code: rawCode, message: sanitizeUntrustedText({ text: rawMessage }) }, { ...(errorData !== undefined ? { data: errorData } : {}), ...structured });
  }
  const fallbackCode = typeof rawCode === 'string' ? sanitizeUntrustedText({ text: rawCode }) : 'http-error';
  return exitWithStructuredError({ code: fallbackCode, message: `${method} ${route} failed: ${resp.status}${describeUnrecognizedDaemonPayload(data)}` }, structured);
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
  { base, route, init }: { base: string; route: string; init: DaemonRequestInit },
  options: PostJsonToDaemonOptions,
): Promise<unknown> {
  const structured = structuredExitOptions(options);
  const { resp, data } = await fetchJsonWithinDeadline({ base, route, init }, { options, structured });
  if (!resp.ok) return exitForDaemonError({ resp, data, method: init.method, route }, structured);
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
  { base, route, body }: { base: string; route: string; body: unknown },
  options: PostJsonToDaemonOptions = {},
): Promise<unknown> {
  return requestJsonFromDaemon({ base, route, init: { method: 'POST', body } }, options);
}

/**
 * `GET` `<base><route>` and return the parsed JSON response. Same transport contract as
 * {@link postJsonToDaemon} (timeout, response-size cap, structured-error mapping, redaction) with
 * no request body — for read-only daemon routes such as `@jini-ai/http-kit`'s `GET /api/runs` and
 * `GET /api/runs/:runId`.
 */
export async function getJsonFromDaemon(
  { base, route }: { base: string; route: string },
  options: GetJsonFromDaemonOptions = {},
): Promise<unknown> {
  return requestJsonFromDaemon({ base, route, init: { method: 'GET' } }, options);
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
  return ` (daemon response, redacted/truncated): ${sanitizeUntrustedText({ text: raw })}`;
}
