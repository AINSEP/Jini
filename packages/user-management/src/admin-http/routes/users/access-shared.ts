import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import {
  GrantExceedsIssuerError, IdentityConflictError, IdentityForbiddenError, IdentityNotFoundError, IdentityValidationError,
  OwnerRequiredError, PermissionUnknownError,
} from "../../../core/types.js";
import type { AuthServiceDeps } from "../../../server/auth-service.js";

/**
 * @file Shared guards and error mapping for the role/policy admin route specs (the users family's
 * access half: roles, policies and a policy's permission rows).
 *
 * Every write here is authorized by the identity service itself (`role.manage`, checked inside
 * `createRole`/`updatePolicy`/…), never by the route — so these specs ask the host's `authorize`
 * port nothing; a refusal arrives as `IdentityForbiddenError` and maps to the same 403 body the
 * hand-written routes wrote. Each hand-written route had its own `instanceof` ladder; each spec
 * keeps its exact ladder (same rungs, same order) as a small mapping list, and anything unmapped is
 * rethrown so the host answers it as its redacted 500.
 */

/** The principal fields these routes read: only the id, as the identity transition's caller. */
export interface AccessRoutePrincipal { id: string }

/**
 * Assembles the identity services' deps bag. Injected as a thunk because the bag is the host's
 * (it binds the host's rename port among others) and the hand-written routes assembled it per
 * request, inside their `try` — a failure assembling it is therefore mapped/500'd like any other.
 */
export type IdentityServiceDepsFn = () => AuthServiceDeps;

/** The two fields every service-backed role/policy route reads. */
export interface AccessServiceRouteDeps {
  workspaceId: string;
  identityServiceDeps: IdentityServiceDepsFn;
}

/** One `catch` rung: which thrown error it matches and the exact refusal it answers. */
export interface AccessErrorMapping {
  readonly matches: (required: { err: unknown }, optional?: Record<string, never>) => boolean;
  readonly respond: (required: { err: unknown }, optional?: Record<string, never>) => { status: number; body: Record<string, unknown> };
}

/** A rung for one error class; `body` builds the flat envelope (key order is the wire order). @complexity O(1). */
function rung<E extends Error>(
  { errorClass, status, body }: { errorClass: abstract new (...args: never[]) => E; status: number; body: (err: E) => Record<string, unknown> },
  _optional: Record<string, never> = {},
): AccessErrorMapping {
  return { matches: ({ err }) => err instanceof errorClass, respond: ({ err }) => ({ status, body: body(err as E) }) };
}

export const ACCESS_FORBIDDEN = rung({ errorClass: IdentityForbiddenError, status: 403, body: (err) => ({
  error: err.message, code: "FORBIDDEN", details: { permission: err.permission, reason: err.reason },
}) });
export const ACCESS_VALIDATION = rung({ errorClass: IdentityValidationError, status: 400, body: (err) => ({ error: err.message, code: "VALIDATION_ERROR" }) });
export const ACCESS_NOT_FOUND = rung({ errorClass: IdentityNotFoundError, status: 404, body: (err) => ({ error: err.message, code: "RESOURCE_NOT_FOUND" }) });
export const ACCESS_GRANT_EXCEEDS_ISSUER = rung({ errorClass: GrantExceedsIssuerError, status: 403, body: (err) => ({
  error: err.message, code: "GRANT_EXCEEDS_ISSUER", details: { offendingPermissions: err.offendingPermissions },
}) });
export const ACCESS_OWNER_REQUIRED = rung({ errorClass: OwnerRequiredError, status: 409, body: (err) => ({ error: err.message, code: "OWNER_REQUIRED" }) });

/** A still-referenced delete target (INV-09): 409 naming the id field the client sent. @complexity O(1). */
export function accessConflictOn({ field }: { field: string }, _optional: Record<string, never> = {}): AccessErrorMapping {
  return rung({ errorClass: IdentityConflictError, status: 409, body: (err) => ({ error: err.message, code: "RESOURCE_CONFLICT", details: { field } }) });
}

/** An unregistered permission: 400 echoing the permission exactly as the client sent it (raw, not
 *  coerced — an absent one drops out of the JSON, as `req.body?.permission` did). @complexity O(1). */
export function accessPermissionUnknown({ requested }: { requested: unknown }, _optional: Record<string, never> = {}): AccessErrorMapping {
  return rung({ errorClass: PermissionUnknownError, status: 400, body: (err) => ({ error: err.message, code: "PERMISSION_UNKNOWN", details: { permission: requested } }) });
}

/**
 * Refuses with the first matching rung; anything unmapped is rethrown unchanged so the host's error
 * port answers it as an unexpected (redacted) failure under the route's own operation copy.
 * @complexity O(n) in the mapping list length, a small fixed list per route.
 */
export function rejectAccessError({ err, mappings }: { err: unknown; mappings: readonly AccessErrorMapping[] }, _optional: Record<string, never> = {}): never {
  const mapping = mappings.find((candidate) => candidate.matches({ err }));
  if (!mapping) throw err;
  throw new RouteRefusalError(mapping.respond({ err }));
}

/** The authenticated caller's id. A missing principal is a wiring bug (the host mounts these behind
 *  its session), so it fails closed as an unexpected failure, as `getAuthedPrincipal` did. @complexity O(1). */
export function accessActorId({ context }: { context: AccessRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("users admin route has no authenticated principal");
  return context.id;
}

/** One path segment; Express always fills it, the `?? ""` keeps the hand-written guard (an absent id
 *  becomes an honest not-found from the service, never a wildcard). @complexity O(1). */
export function accessPathParam({ params, name }: { params: Record<string, string | undefined>; name: string }, _optional: Record<string, never> = {}): string {
  return String(params[name] ?? "");
}

/** The untyped JSON body as a record (`req.body ?? {}`). @complexity O(1). */
export function accessBody({ body }: { body: unknown }, _optional: Record<string, never> = {}): Record<string, unknown> {
  return (body ?? {}) as Record<string, unknown>;
}

/** An optional string field: `undefined` means "absent / leave unchanged", anything else is coerced. @complexity O(1). */
export function optionalString({ value }: { value: unknown }, _optional: Record<string, never> = {}): string | undefined {
  return value !== undefined ? String(value) : undefined;
}
