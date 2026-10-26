import { AsyncLocalStorage } from "node:async_hooks";

import { redactSecrets } from "@jini-ai/core";
import type { ObservabilityPort } from "./ports.js";

/**
 * @file The shared way a host hands an error to `ObservabilityPort.reportError` (provider wave 2,
 * 2026-10-25): request 5xx, process guards, assistant failures and `trackAsyncOperation` all come
 * through here, so each failure reaches the error tracker ONCE and already redacted.
 *
 * Once: an error object is reported at most once per process (a publish failure reported by its
 * operation and then surfacing as the request's 500 is one incident, not two), and a request whose
 * work already reported something is not reported again as a bare 5xx (`runWithErrorReportScope`).
 * Redacted: message and stack go through Jini's `redactSecrets` before the port sees them; the port's
 * adapters redact again, which is idempotent. Attributes are fixed labels and ids only — callers
 * never pass request bodies, headers, cookies, query strings or user text.
 */

type Attributes = Readonly<Record<string, string | number>>;

/** Per-request state: did anything inside this request report an error yet? */
export interface ErrorReportScope { reported: boolean }

const requestScope = new AsyncLocalStorage<ErrorReportScope>();
const reportedErrors = new WeakSet<object>();

/**
 * Runs `work` (normally Express's `next`) with `scope` as the current request's report scope, so a
 * report from anywhere inside it marks the request as reported.
 * @complexity O(1) around `work`.
 */
export function runWithErrorReportScope<T>({ scope, work }: { scope: ErrorReportScope; work: () => T }, _options = {}): T {
  return requestScope.run(scope, work);
}

type ExactSecrets = readonly string[] | undefined;
const redact = (text: string, exactSecrets: ExactSecrets): string => redactSecrets({ input: text }, exactSecrets ? { exactSecrets } : {});

/**
 * A copy of `error` with its message and stack redacted, or the original when nothing needed
 * redacting (so identity survives for callers that compare). Non-Error throws become an Error.
 * `exactSecrets` (e.g. the credential a failing call used) are blanked even without a known shape.
 * @complexity O(n) in message + stack length.
 */
export function redactedError({ error }: { error: unknown }, { exactSecrets }: { exactSecrets?: ExactSecrets } = {}): Error {
  if (!(error instanceof Error)) return new Error(redact(typeof error === "string" ? error : `non-Error thrown: ${typeof error}`, exactSecrets));
  const message = redact(error.message, exactSecrets);
  const stack = error.stack === undefined ? undefined : redact(error.stack, exactSecrets);
  if (message === error.message && stack === error.stack) return error;
  const copy = new Error(message);
  copy.name = error.name;
  if (stack === undefined) delete copy.stack;
  else copy.stack = stack;
  return copy;
}

/**
 * Reports `error` once to the observability port, redacted, labelled with `operation` and the
 * given attributes. Never throws: a failing adapter must not turn one error into two.
 * @returns Whether a report was sent (false: no port, or this error object was already reported).
 * @complexity O(n) in the error's message + stack length.
 */
export function reportErrorOnce(
  required: { observability: ObservabilityPort | undefined; error: unknown; operation: string },
  optional: { attributes?: Attributes; exactSecrets?: ExactSecrets; level?: 'warning' | 'error' } = {},
): boolean {
  const { observability, error, operation } = required;
  const isObject = typeof error === "object" && error !== null;
  if (!observability || (isObject && reportedErrors.has(error))) return false;
  if (isObject) reportedErrors.add(error);
  const scope = requestScope.getStore();
  if (scope) scope.reported = true;
  try {
    observability.reportError({ error: redactedError({ error }, { exactSecrets: optional.exactSecrets }), context: { operation,
      ...(optional.attributes ? { attributes: optional.attributes } : {}), ...(optional.level ? { level: optional.level } : {}) } });
  } catch { /* never let reporting fail the caller */ }
  return true;
}
