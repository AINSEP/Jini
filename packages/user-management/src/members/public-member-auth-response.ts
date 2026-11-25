import { MemberAuthError, MemberReauthenticationRequiredError, MemberSignInUnavailableError, MemberValidationError } from "./types.js";

export function memberCookieExpiry({ expiresAtIso, nowMs }: { expiresAtIso: string; nowMs: () => number }, _optional = {}): { expires: Date; maxAge: number } {
  const maxAge = Math.max(0, new Date(expiresAtIso).getTime() - nowMs());
  return { expires: new Date(nowMs() + maxAge), maxAge: Math.floor(maxAge / 1000) };
}

/** Credential failures share one body across password, link, code and reset; no exception text leaks.
 * @returns The refusal (status + flat body), or `undefined` for an unexpected error (the 500).
 */
export function memberAuthRefusal({ error }: { error: unknown }, options: { reset?: boolean } = {}): { status: number; body: { error: string; code?: string } } | undefined {
  if (error instanceof MemberReauthenticationRequiredError) {
    return { status: 401, body: { error: "sign in again to set a password", code: "REAUTHENTICATION_REQUIRED" } };
  }
  if (error instanceof MemberAuthError) return { status: 401, body: { error: "invalid credentials", code: "INVALID_CREDENTIALS" } };
  if (options.reset && error instanceof MemberValidationError) return { status: 400, body: { error: error.message } };
  return undefined;
}

/** `respondToSignInError`'s known answers: credential 401, site-wide setup 503, validation 400.
 * @returns The refusal (status + flat body), or `undefined` for an unexpected error (the 500).
 */
export function memberSignInRefusal({ error, isSenderNotConfigured, senderNotConfiguredMessage }: { error: unknown; isSenderNotConfigured: (required: { error: unknown }) => boolean; senderNotConfiguredMessage: string }, _optional = {}): { status: number; body: { error: string; code?: string } } | undefined {
  if (error instanceof MemberAuthError) return memberAuthRefusal({ error });
  if (error instanceof MemberSignInUnavailableError) {
    return { status: 503, body: { error: error.message, code: "MEMBER_SIGN_IN_UNAVAILABLE" } };
  }
  if (isSenderNotConfigured({ error })) {
    return { status: 503, body: { error: senderNotConfiguredMessage, code: "MEMBER_SIGN_IN_UNAVAILABLE" } };
  }
  if (error instanceof MemberValidationError) return { status: 400, body: { error: error.message } };
  return undefined;
}
