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
 * [{ adminSessionCookie: [] }]`: a human admin session mints, issues, and revokes keys — an API key
 * may not. Without this, any key holding `apikey.manage` could issue itself a successor, and revoking
 * the original would not end the caller's access; key issuance would be a privilege-escalation
 * primitive rather than a delegation of authority a human can withdraw.
 *
 * The host enforces it as its session-credential-only gate BEFORE the request body is read and
 * before any existence check, so an api_key caller learns nothing about whether a target exists.
 * This is the gate's copy: the 403 message and the permission it names.
 */
export const API_KEY_SESSION_CREDENTIAL_GATE = {
  message: "api-key credentials may not manage api keys; use an admin session",
  permission: "apikey.manage",
} as const;

/** The hand-written `sendApiKeyError` ladder, in its order. */
export const API_KEY_ERRORS: readonly UserErrorRung[] = [USER_FORBIDDEN, USER_GRANT_EXCEEDS_ISSUER, USER_VALIDATION, USER_NOT_FOUND];

/** The request body as the hand-written routes read it (`req.body?.<field>`), never assumed an object. @complexity O(1). */
export function apiKeyBody(raw: { body?: unknown }): Record<string, unknown> | undefined {
  return (raw.body ?? undefined) as Record<string, unknown> | undefined;
}
