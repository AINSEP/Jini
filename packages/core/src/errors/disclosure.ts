/**
 * @file Who may read what about an incident. The rule, stated once: redaction removes known secret
 * shapes; it does not decide who may read a fact. No error text is shown to a caller because it was
 * redacted. It is shown only when the owner of that operation approved it (`approveCause`) for a
 * caller authorised for that same operation.
 *
 * | Audience | Gets |
 * |---|---|
 * | `anonymous` | the fallback words and the error ID. No details block |
 * | `signed-in` | Copy details: ID, step, versions, time, and a fixed cause sentence |
 * | `authorized` | the same, plus the listed class/code label; or the approved cause, redacted |
 */
import type { SecretRedactionOptions } from '../redact.js';
import { formatUserFacingError, type UserFacingError } from '../user-facing-error.js';
import { isApprovedCause, type ApprovedCause } from './approved-cause.js';

/**
 * `anonymous`: nobody is signed in. `signed-in`: an authenticated principal. `authorized`: the
 * boundary's permission check for THIS operation has also passed.
 */
export type ErrorAudience = 'anonymous' | 'signed-in' | 'authorized';

/** The cause every signed-in caller sees. It names where the facts are without stating any. */
export const INCIDENT_CAUSE_SENTENCE = 'The error ID identifies the server report.';

/** Options of {@link discloseIncident}. */
export interface DiscloseIncidentOptions {
  readonly approvedCause?: ApprovedCause;
  readonly time?: string;
  readonly redaction?: SecretRedactionOptions;
}

function disclosedCause(required: { audience: ErrorAudience; step: string; label: string }, optional: DiscloseIncidentOptions): unknown {
  if (required.audience !== 'authorized') return INCIDENT_CAUSE_SENTENCE;
  const approved = optional.approvedCause;
  // An approval is for one step: a cause approved for the export is not shown for a later save.
  if (approved !== undefined && isApprovedCause({ value: approved }) && approved.step === required.step) return approved.cause;
  return `${INCIDENT_CAUSE_SENTENCE} Failure class: ${required.label}.`;
}

/**
 * The Copy-details block an incident's caller may read, or `undefined` for an anonymous caller.
 * `label` is a class label and listed code (`Error(SQLITE_BUSY)`), both approved by listing.
 * @complexity O(length of the approved cause) for redaction; O(1) otherwise.
 */
export function discloseIncident(
  required: {
    audience: ErrorAudience; step: string; label: string; errorId: string;
    fallback: { readonly message: string; readonly action: string };
    versions: { readonly app: string; readonly jini: string };
  },
  optional: DiscloseIncidentOptions = {},
): UserFacingError | undefined {
  if (required.audience !== 'signed-in' && required.audience !== 'authorized') return undefined;
  return formatUserFacingError(
    { message: required.fallback.message, action: required.fallback.action, step: required.step, cause: disclosedCause(required, optional) },
    {
      ...optional.redaction, errorId: required.errorId, appVersion: required.versions.app, jiniVersion: required.versions.jini,
      ...(optional.time === undefined ? {} : { time: optional.time }),
    },
  );
}
