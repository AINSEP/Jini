import { redactSecretShapes } from '../core/secrets-only.js';
import { errorType } from './otel.js';

export interface ReportedErrorDescription { type: string; message: string; stack?: string; }

// Error trackers group by type + message and show the stack, so unlike span exports (type only) they
// need text. Both pass through the same secret-shape redaction request targets use, then are capped
// (redact first: a cut could leave a secret prefix too short to match):
// a handler error can embed a whole response body.
const MAX_MESSAGE = 1024;
const MAX_STACK_LINES = 30;

function redact(text: string): string {
 return redactSecretShapes({ text, policy: {} }).text;
}

/** Vendor-neutral, redacted view of a reported error that any error-tracker adapter can send.
 * Secret shapes (tokens, keys, `password=…`) are blanked; e-mails and hostnames are NOT — callers
 * must not put personal data in error messages (see the plan's PII section).
 * @param required The raw error as handed to `ObservabilityPort.reportError`.
 * @returns Type label, redacted capped message, and redacted capped stack when there is one.
 * @complexity O(n) in message + stack length. */
export function describeReportedError({ error }: { error: unknown }): ReportedErrorDescription {
 const type = errorType(error);
 const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : type;
 const stack = error instanceof Error && typeof error.stack === 'string'
  ? redact(error.stack.split('\n').slice(0, MAX_STACK_LINES).join('\n')) : undefined;
 return { type, message: redact(raw).slice(0, MAX_MESSAGE), ...(stack ? { stack } : {}) };
}
