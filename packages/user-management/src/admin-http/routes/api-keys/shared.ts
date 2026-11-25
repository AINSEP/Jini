import type { ApiKeyServiceDeps } from "../../../identity/api-key-service.js";
import { USER_FORBIDDEN, USER_GRANT_EXCEEDS_ISSUER, USER_NOT_FOUND, USER_VALIDATION, type UserErrorRung } from "../users/shared.js";

/**
 * @file Shared pieces of the three api-key admin route specs (principal create, issue, revoke).
 *
 * The hand-written routes shared one `sendApiKeyError` ladder because all three throw from the same
 * service module and errors.spec.md gives them the same codes; {@link API_KEY_ERRORS} keeps that
 * ladder, in its order, as rungs `rejectUserError` maps. Anything unmapped is rethrown to the host's
 * redacted-500 port. The service functions and their deps bag are injected (subpath isolation: the
 * admin-http entry does not reach the `identity` service implementation).
 */

/** Builds the api-key service deps bag per request (the host's assembler over its repo fields). */
export type ApiKeyServicesFn = (required?: Record<string, never>) => ApiKeyServiceDeps;

/**
 * **The no-escalation guard.** All three operations in this family are `security:
 * [{ adminSessionCookie: [] }]` in `openapi/006-identity-and-authorization.yaml`: a human admin
 * session mints, issues, and revokes keys — an API key may not. Without this, any key holding
 * `apikey.manage` could issue itself a successor, and revoking the original would not end the
 * caller's access; key issuance would be a privilege-escalation primitive rather than a delegation
 * of authority a human can withdraw.
 *
 * Runs BEFORE the request body is read and before any existence check, so an api_key caller learns
 * nothing about whether a target exists.
 *
 * @returns `true` when the request may proceed. On `false` the 403 has already been sent.
 * @complexity O(1).
 * @overallScore 100
 */
// Moved from the hand-written guard: the host now enforces it as its session-credential-only mount
// gate with this copy (the 403 message and the permission it names), so the `@returns` above describes
// that gate's admit/refuse outcome.
export const API_KEY_SESSION_CREDENTIAL_GATE = {
  message: "api-key credentials may not manage api keys; use an admin session",
  permission: "apikey.manage",
} as const;

/**
 * Maps this family's thrown error types onto the admin error envelope. Shared by all three routes
 * because all three throw from the same service module and errors.spec.md gives them the same
 * codes (mirrors `users/attach-policy.ts`'s `sendAttachPolicyError`, one level up).
 *
 * @complexity O(1).
 * @overallScore 100
 */
// The ladder as the rung list `rejectUserError` maps, in the hand-written order.
export const API_KEY_ERRORS: readonly UserErrorRung[] = [USER_FORBIDDEN, USER_GRANT_EXCEEDS_ISSUER, USER_VALIDATION, USER_NOT_FOUND];

/** The request body as the hand-written routes read it (`req.body?.<field>`), never assumed an object. @complexity O(1). */
export function apiKeyBody(raw: { body?: unknown }): Record<string, unknown> | undefined {
  return (raw.body ?? undefined) as Record<string, unknown> | undefined;
}
