import { formatUserFacingError, type UserFacingError, type UserFacingErrorOptions } from "@jini-ai/core";

import { type Translate } from '@jini-ai/core/text';

/** The host's transport error class, read only for the server incident ID its JSON body may carry. */
export type SkillFailureApiError = abstract new (...args: never[]) => Error & { readonly body?: Readonly<Record<string, unknown>> | undefined };
/** Format Skills failures at the admin disclosure boundary, preserving the server incident ID.
 * @param input Original failure, operation fallback and the current feature translator, plus the host's
 *   transport error class, its error describer and its product redaction options (bound by the host).
 * @returns Redacted, bounded details; no transport or clipboard effects.
 * @complexity O(diagnostic characters) time/space; output is capped by the shared formatter.
 * @example skillFailure({ error, message: "Could not load skills.", t });
 */
export function skillFailure(
  { error, message, t, ApiError, describeApiError, redactionOptions }: {
    error: unknown; message: string; t: Translate; ApiError: SkillFailureApiError;
    describeApiError: (required: { e: unknown; fallback: string }) => string; redactionOptions: UserFacingErrorOptions;
  },
  _options = {},
): UserFacingError {
  return formatUserFacingError({ message: t(describeApiError({ e: error, fallback: message })),
    action: t("Reload skills before trying the change again."), step: "skills", cause: error },
  { ...redactionOptions,
    ...(error instanceof ApiError && typeof error.body?.errorId === "string" ? { errorId: error.body.errorId } : {}) });
}
