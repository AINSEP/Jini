import { AsyncLocalStorage } from "node:async_hooks";

import { redactSecrets } from "@jini-ai/core";
import type { ObservabilityPort } from "./ports.js";

/**
 * @file The shared way a host hands an error to `ObservabilityPort.reportError` (provider wave 2,
 * 2026-10-25): request 5xx, process guards, assistant failures and `trackAsyncOperation` all come
 * through here, so each failure reaches the error tracker ONCE and already redacted.
 *
 * Once: an error object is reported at most once per port in an occurrence (a publish failure reported by its
 * operation and then surfacing as the request's 500 is one incident, not two), and a request whose
 * work already reported something is not reported again as a bare 5xx (`runWithErrorReportScope`).
 * Redacted: message and stack go through Jini's `redactSecrets` before the port sees them; the port's
 * adapters redact again, which is idempotent. Attributes are fixed labels and ids only — callers
 * never pass request bodies, headers, cookies, query strings or user text.
 */

type Attributes = Readonly<Record<string, string | number>>;

/** Per-request state: did anything inside this request report an error yet? */
export interface ErrorReportScope { reported: boolean; errors?: WeakMap<ObservabilityPort, WeakSet<object>> }

const requestScope = new AsyncLocalStorage<ErrorReportScope>();

/**
 * Runs `work` (normally Express's `next`) with `scope` as the current request's report scope, so a
 * report from anywhere inside it marks the request as reported.
 * @complexity O(1) around `work`.
 */
export function runWithErrorReportScope<T>({ scope, work }: { scope: ErrorReportScope; work: () => T }, { reuseCurrent = false }: { reuseCurrent?: boolean } = {}): T {
  return requestScope.run(reuseCurrent ? requestScope.getStore() ?? scope : scope, work);
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

/** Mark only successful hand-offs; scope owns the weak per-port incident inventory.
 * @returns Local acceptance. @complexity O(1) time/space per error.
 */
function recordAdmission(
  { result, scope, observability, error }: { result: boolean | void; scope: ErrorReportScope | undefined; observability: ObservabilityPort; error: unknown },
  _options = {},
): boolean {
  if (result === false) return false;
  if (!scope) return true;
  scope.reported = true;
  if (typeof error === "object" && error !== null) {
    scope.errors ??= new WeakMap();
    const errors = scope.errors.get(observability) ?? new WeakSet<object>();
    errors.add(error);
    scope.errors.set(observability, errors);
  }
  return true;
}

/** Only an object successfully admitted to this port in this scope is a duplicate. @complexity O(1). */
function alreadyReported({ scope, observability, error }: { scope: ErrorReportScope | undefined; observability: ObservabilityPort; error: unknown }, _options = {}): boolean {
  return typeof error === "object" && error !== null && scope?.errors?.get(observability)?.has(error) === true;
}

/**
 * Reports once per port and occurrence, after redaction. Without a request/trace scope each call
 * is an independent occurrence. Failed/noop delivery leaves both dedup and bare-5xx fallback open.
 * @returns Synchronous local admission; pending async admission returns false and marks on success.
 * @complexity O(n) in the error's message + stack length; scope state is weakly held.
 */
export function reportErrorOnce(
  required: { observability: ObservabilityPort | undefined; error: unknown; operation: string },
  optional: { attributes?: Attributes; exactSecrets?: ExactSecrets } = {},
): boolean {
  const { observability, error, operation } = required;
  const scope = requestScope.getStore();
  if (!observability) return false;
  if (alreadyReported({ scope, observability, error })) return false;
  try {
    const result = observability.reportError({ error: redactedError({ error }, { exactSecrets: optional.exactSecrets }), context: { operation, ...(optional.attributes ? { attributes: optional.attributes } : {}) } });
    const accepted = (result: boolean | void) => recordAdmission({ result, scope, observability, error });
    if (result instanceof Promise) { void result.then(accepted).catch(() => {}); return false; }
    return accepted(result);
  } catch { return false; /* never let reporting fail the caller */ }
}
