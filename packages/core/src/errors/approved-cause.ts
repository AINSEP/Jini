/**
 * @file The one way an error's own text reaches a caller. Redaction removes known secret shapes; it
 * does not decide who may read a fact: a message can quote a draft, a customer note or a URL with a
 * query string, and no redactor sees that. So the owner of an operation approves a cause explicitly,
 * and the reporter shows it only to a caller authorised for that same step. Redaction still runs on
 * an approved cause, as a second layer.
 *
 * The callers of {@link approveCause} are meant to be an allowlist held by `scripts/guard.ts`, so
 * adding one is a reviewed diff with the operation owner's reason beside it. That guard rule is not
 * built yet; until it is, a new caller is caught only by review.
 */
declare const approvedCauseBrand: unique symbol;

/** "A caller authorised for `step` may read this failure's redacted cause." Built only by {@link approveCause}. */
export interface ApprovedCause {
  readonly step: string;
  readonly cause: unknown;
  readonly [approvedCauseBrand]: true;
}
/** Options of {@link approveCause} and {@link isApprovedCause}. None yet; named so one can be added without changing the signature. */
export interface ApproveCauseOptions {}

/** Every approval this module issued. An object of the same shape built elsewhere (a cast, parsed JSON) is not in it. */
const issued = new WeakSet<object>();

/**
 * Called by the feature that owns `step`. Means: a caller authorised for this step may read this
 * failure's redacted cause.
 * @complexity O(1).
 */
export function approveCause(required: { step: string; cause: unknown }, _optional: ApproveCauseOptions = {}): ApprovedCause {
  const approval = Object.freeze({ step: required.step, cause: required.cause }) as ApprovedCause;
  issued.add(approval);
  return approval;
}

/** True only for a value {@link approveCause} returned. */
export function isApprovedCause(required: { value: unknown }, _optional: ApproveCauseOptions = {}): boolean {
  return typeof required.value === 'object' && required.value !== null && issued.has(required.value);
}
