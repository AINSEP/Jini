/**
 * @module @jini-ai/mcp/server/daemon-client
 *
 * Bounded-I/O JSON GET/POST against a trusted daemon base URL — the transport
 * primitive every proxy tool `createMcpToolServer` hosts is built on
 * (`../client/client.js`'s `createMcpIdleExitController` is the other half of
 * the mechanism; this module is the network half).
 *
 * Deliberately NOT `@jini-ai/cli`'s `getJsonFromDaemon`/`postJsonToDaemon`
 * (`packages/cli/src/http.ts`): those map a failure onto `process.exit`,
 * which is the right contract for a one-shot CLI invocation but wrong here —
 * a stdio MCP server is a long-lived process serving many tool calls, and one
 * failed call must return an MCP `{isError:true}` result and keep serving the
 * next call, not terminate the process. This module ports the same
 * bounded-read / timeout / redaction posture `http.ts` established
 * (CR-004/SEC-RB-009 — see `ADS-memory/reports/code-review/CR-remaining-backend-audit-2026-07-21.md`,
 * `ADS-memory/reports/security/SEC-remaining-backend-audit-2026-07-21.md`) as
 * a throw-based primitive instead: a failed request throws a plain,
 * already-redacted `Error` whose message a tool handler's caller
 * (`handleToolCall` in `./tool-protocol.js`) turns into that MCP error result.
 *
 * No SSRF hardening here (unlike `../core/oauth.ts`'s `safeOAuthFetch`): the
 * target is a caller-resolved, typically-loopback daemon the user already
 * trusts enough to run — not an attacker- or server-metadata-controlled
 * remote URL the way a configured external MCP server's OAuth endpoints are.
 * This mirrors `@jini-ai/cli/http.ts`'s own posture for the identical "fetch my
 * own daemon" concern (no `assertSafePublicUrl` there either).
 */
import { sanitizeUntrustedText } from '@jini-ai/cli';

/** Request deadline. Generous enough for a slow tool call, short enough that a stalled daemon doesn't hang a stdio server turn forever. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Cap on a daemon response body. Comfortably larger than any real status/run envelope, small enough to bound worst-case memory from a hostile/broken daemon. */
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** Thrown internally when a response exceeds its byte cap; always translated to a plain `Error` before it crosses this module's public functions. */
export class DaemonResponseTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`daemon response exceeded the ${limitBytes}-byte limit`);
    this.name = 'DaemonResponseTooLargeError';
  }
}

export interface DaemonRequestOptions {
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

/**
 * Read `resp`'s body as JSON without ever buffering past `maxBytes`. Prefers streaming via
 * `resp.body`'s reader (what a real `fetch()` `Response` provides), rejecting mid-stream once the
 * cap is exceeded rather than buffering a huge response whole first; falls back to `resp.text()`
 * (still byte-checked before parsing) for response-like test doubles that expose no reader. A body
 * that isn't valid JSON resolves to `{}` rather than throwing — a malformed daemon response should
 * surface as a normal non-2xx/shape mismatch to the caller, not an opaque parse exception.
 */
async function readJsonWithLimit(resp: Response, maxBytes: number): Promise<unknown> {
  const contentLength = resp.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) throw new DaemonResponseTooLargeError(maxBytes);
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
        if (done) break;
        if (value !== undefined) {
          total += value.byteLength;
          if (total > maxBytes) throw new DaemonResponseTooLargeError(maxBytes);
          text += decoder.decode(value, { stream: true });
        }
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    return parseJsonLoose(text);
  }

  const text = await resp.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new DaemonResponseTooLargeError(maxBytes);
  return parseJsonLoose(text);
}

/** Formats a `fetch()` rejection (network-unreachable) into a message safe to surface as an MCP tool error. */
function formatConnectionFailure(err: unknown, baseUrl: string): string {
  const cause = err !== null && typeof err === 'object' ? (err as { cause?: unknown }).cause : null;
  const code =
    cause !== null && typeof cause === 'object' && typeof (cause as { code?: unknown }).code === 'string'
      ? (cause as { code: string }).code
      : null;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return `cannot reach the daemon at ${baseUrl}. Is it running?`;
  }
  const message = err instanceof Error ? err.message : String(err);
  return sanitizeUntrustedText(message);
}

/** Formats a non-2xx daemon response into a message safe to surface as an MCP tool error. */
function formatDaemonHttpError(status: number, url: string, data: unknown): string {
  const envelope = data as DaemonErrorEnvelope;
  const code = typeof envelope.error?.code === 'string' ? envelope.error.code : undefined;
  const rawMessage = typeof envelope.error?.message === 'string' ? envelope.error.message : undefined;
  const detail = rawMessage !== undefined ? sanitizeUntrustedText(rawMessage) : `HTTP ${status}`;
  return code !== undefined ? `daemon ${status} on ${url}: ${code}: ${detail}` : `daemon ${status} on ${url}: ${detail}`;
}

interface DaemonRequestInit {
  readonly method: 'GET' | 'POST';
  readonly body?: unknown;
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const url = `${baseUrl}${route}`;

  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    timeoutController.abort(new Error(`request to ${route} timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  // A stdio server turn shouldn't be kept alive purely by this timer.
  (timeoutHandle as unknown as { unref?: () => void }).unref?.();
  const signal = options.signal !== undefined ? AbortSignal.any([options.signal, timeoutController.signal]) : timeoutController.signal;

  try {
    let resp: Response;
    try {
      resp = await fetchImpl(url, {
        method: init.method,
        headers: init.method === 'POST' ? { 'content-type': 'application/json', ...options.headers } : { ...options.headers },
        ...(init.method === 'POST' ? { body: JSON.stringify(init.body ?? {}) } : {}),
        signal,
      });
    } catch (err) {
      throw new Error(formatConnectionFailure(err, baseUrl));
    }

    let data: unknown;
    try {
      data = await readJsonWithLimit(resp, maxResponseBytes);
    } catch (err) {
      if (err instanceof DaemonResponseTooLargeError) {
        throw new Error(`response from ${url} exceeded the ${err.limitBytes}-byte limit`);
      }
      throw err;
    }

    if (!resp.ok) {
      throw new Error(formatDaemonHttpError(resp.status, url, data));
    }
    return data;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/** `GET <baseUrl><route>` and return the parsed JSON response, throwing on network failure or a non-2xx status. */
export async function getDaemonJson<T = unknown>(baseUrl: string, route: string, options?: DaemonRequestOptions): Promise<T> {
  return requestDaemonJson(baseUrl, route, { method: 'GET' }, options) as Promise<T>;
}

/** `POST body` (JSON-serialized) to `<baseUrl><route>` and return the parsed JSON response, throwing on network failure or a non-2xx status. */
export async function postDaemonJson<T = unknown>(baseUrl: string, route: string, body: unknown, options?: DaemonRequestOptions): Promise<T> {
  return requestDaemonJson(baseUrl, route, { method: 'POST', body }, options) as Promise<T>;
}
