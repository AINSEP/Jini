import { redactSecrets } from '@jini-ai/core';
/**
 * @module providers/provider-http
 *
 * The request/response plumbing `model-catalog.ts` (`listProviderModels`) and
 * `connection-test.ts` (`testProviderConnection`) both need: versioned API
 * paths, HTTP-status and network-error classification, provider error-body
 * parsing, key redaction, and the caller-signal + hard-timeout abort wiring.
 * Each file carried its own byte-identical copy of these until they were
 * folded here.
 */

import type { BaseUrlValidationResult } from './connection-guard.js';
import type { ConnectionTestKind } from './types.js';

/** Node/undici `cause.code`s that mean the base URL cannot be reached at all. */
const UNREACHABLE_BASE_URL_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

export function appendVersionedApiPath({ baseUrl, suffix }: { baseUrl: string; suffix: string }): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/v\d+(\/|$)/.test(pathname) ? `${pathname}${suffix}` : `${pathname}/v1${suffix}`;
  return url.toString();
}

function isLikelyAuthErrorText(text: string): boolean {
  return /(?:api[_ -]?key|x-goog-api-key|unauthorized|unauthenticated|permission denied|invalid credentials|authentication credentials|access denied|invalid key)/i.test(
    text,
  );
}

function isLikelyModelErrorText(text: string): boolean {
  return (
    /model/i.test(text) &&
    /(not found|not exist|does not exist|unknown|invalid|unsupported|not supported|not have access|no access)/i.test(text)
  );
}

/**
 * Maps an HTTP error status to a {@link ConnectionTestKind}. `detailText` (the
 * provider's own error message) refines 400/403 into `auth_failed` and 404
 * into `not_found_model`; without it those stay the bare status meaning.
 */
const AUTH_REFINABLE_STATUSES = new Set([400, 403]);
const FIXED_STATUS_KINDS: Record<number, ConnectionTestKind> = { 401: 'auth_failed', 403: 'forbidden', 429: 'rate_limited' };

export function statusToKind({ status }: { status: number }, { detailText = '' }: { detailText?: string } = {}): ConnectionTestKind {
  if (AUTH_REFINABLE_STATUSES.has(status) && isLikelyAuthErrorText(detailText)) return 'auth_failed';
  if (status === 404) return isLikelyModelErrorText(detailText) ? 'not_found_model' : 'invalid_base_url';
  return FIXED_STATUS_KINDS[status] ?? (status >= 500 ? 'upstream_unavailable' : 'unknown');
}

export function networkErrorToKind(err: unknown): ConnectionTestKind {
  if (!(err instanceof Error)) return 'unknown';
  if (err.name === 'AbortError') return 'timeout';
  const code = (err as { cause?: { code?: string } }).cause?.code;
  return code && UNREACHABLE_BASE_URL_CODES.has(code) ? 'invalid_base_url' : 'unknown';
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** The provider's own error text: `error` (string), `error.message`, `message`, else the raw body. */
export function extractProviderErrorDetail({ data, rawText }: { data: unknown; rawText: string }): string {
  const obj = (data && typeof data === 'object' ? data : {}) as { error?: unknown; message?: unknown };
  if (typeof obj.error === 'string') return obj.error;
  const nested = (obj.error && typeof obj.error === 'object' ? obj.error : {}) as { message?: unknown };
  return nonBlankString(nested.message) ?? nonBlankString(obj.message) ?? rawText.trim().slice(0, 240);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Parses a response body; an empty body is `{}`, a malformed one reports `parseError`. */
export function parseJsonBody(rawText: string): { data: unknown; parseError?: string } {
  try {
    return { data: rawText ? JSON.parse(rawText) : {} };
  } catch (err) {
    // JSON.parse only ever throws a SyntaxError (an Error); the cast
    // documents that rather than adding an untestable non-Error branch.
    return { data: {}, parseError: (err as Error).message };
  }
}

export function redactApiKey({ text, apiKey }: { text: string; apiKey: string }): string {
  return redactSecrets({ input: text }, { exactSecrets: [apiKey] });
}

/** The `{ kind, detail }` refusal for a base URL the SSRF guard rejected, or `undefined` when it passed. */
export function baseUrlRefusal(validated: BaseUrlValidationResult): { kind: ConnectionTestKind; detail: string } | undefined {
  if (!validated.error && validated.parsed) return undefined;
  return {
    kind: validated.forbidden ? 'forbidden' : 'invalid_base_url',
    // Non-null assertion, not a runtime guard: every BaseUrlValidationResult
    // this branch's guard condition can produce sets `error` alongside a
    // missing `parsed` (connection-guard.ts never returns neither/both) —
    // `?? ''` would satisfy the `detail: string` type too, but per this
    // package's coverage-loop policy an assertion is more honest about
    // "TS requires an `undefined` guard here that can't actually occur".
    detail: validated.error!,
  };
}

/**
 * Runs `run` with an abort signal that fires on the caller's `signal` (already
 * aborted or aborted later) or after `timeoutMs`, and always clears the timer
 * and detaches from the caller's signal afterwards.
 *
 * Deliberately `try`/`finally` with no `catch`: callers own error
 * classification. A `try { return A } catch { return B } finally {}` shape
 * leaves a v8/istanbul coverage-instrumentation artifact — an uncoverable
 * phantom branch at the `finally` clause's own opening brace, regardless of
 * which/how many try/catch paths a test exercises (verified with `success`,
 * `try-throws-then-caught`, and `throw-from-inside-catch` scenarios, all
 * leaving the same phantom branch at 0). Keeping `catch` in the caller and
 * `finally` here avoids that shape entirely.
 */
export async function withRequestDeadline<T>(
  { timeoutMs, run }: { timeoutMs: number; run: (signal: AbortSignal) => Promise<T> },
  { signal }: { signal?: AbortSignal | undefined } = {},
): Promise<T> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', abortFromParent, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromParent);
  }
}
