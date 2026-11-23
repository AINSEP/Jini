import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { IdentityRepos } from "../../../core/ports.js";
import {
  GrantExceedsIssuerError, IdentityConflictError, IdentityForbiddenError, IdentityNotFoundError, IdentityValidationError, OwnerRequiredError,
  type PrincipalRecord, type UserRecord,
} from "../../../core/types.js";
import type { AuthServiceDeps } from "../../../server/auth-service.js";
import { toAdminUserResponse, type AdminUserResponse } from "../../http/users.js";

/**
 * @file Shared guards and error mapping for the users (principal) admin route specs.
 *
 * Each hand-written users route had its own `if (err instanceof X) res.status(...)` ladder. The
 * specs keep each route's exact ladder as an ordered list of rungs (a route lists only the classes
 * it always mapped, in its own order), and the host's `onError` port writes the thrown refusal flat,
 * so every body stays byte-identical — `{ error, code?, details? }` in that key order.
 *
 * Authorization for these routes lives in the identity services (`createUser`, `assignRole`, …
 * check the caller's grants themselves), not in a route-level `authorize` call; the specs only read
 * the caller's id. Host-owned error classes (the Trash/self-target errors) reach the specs as injected
 * predicates, so the engine never imports the host's classes.
 */

/** The principal fields these routes read: only the id, as the caller of every identity service. */
export interface UserRoutePrincipal { id: string }

/** Builds the identity services' deps bag per request (the host's assembler over its repo fields). */
export type IdentityServicesFn = (required?: Record<string, never>) => AuthServiceDeps;

/** Whether a thrown error is one of the host's own error classes (the engine cannot `instanceof` them). */
export type HostErrorPredicate = (required: { err: unknown }, optional?: Record<string, never>) => boolean;

/** Is this principal currently in the host's Trash? (`trashed_items` membership, host-owned.) */
export type IsInTrashFn = (required: { principalId: string }, optional?: Record<string, never>) => Promise<boolean>;

/**
 * The host's account-protection guard run before a disable or password reset (seeded owner,
 * last-owner and admin/owner-target rules). It throws the host's self-target error, which the route
 * maps through {@link HostErrorPredicate}, or the identity errors the rungs below already map.
 */
export type AssertUserAccountActionFn = (
  required: { deps: AuthServiceDeps; workspaceId: string; principalId: string; action: "disable" | "reset-password" | "enable" },
  optional: { callerPrincipalId: string; seededOwnerPrincipalId: string },
) => Promise<void>;

/** One `catch` rung: which thrown error maps to which status, and the body's optional code/details. */
export interface UserErrorRung {
  readonly matches: (required: { err: unknown }, optional?: Record<string, never>) => boolean;
  readonly status: number;
  readonly code?: string | ((required: { err: unknown }) => string);
  readonly details?: (required: { err: unknown }) => unknown;
}

export const USER_FORBIDDEN: UserErrorRung = {
  matches: ({ err }) => err instanceof IdentityForbiddenError, status: 403, code: "FORBIDDEN",
  details: ({ err }) => ({ permission: (err as IdentityForbiddenError).permission, reason: (err as IdentityForbiddenError).reason }),
};
export const USER_GRANT_EXCEEDS_ISSUER: UserErrorRung = {
  matches: ({ err }) => err instanceof GrantExceedsIssuerError, status: 403, code: "GRANT_EXCEEDS_ISSUER",
  details: ({ err }) => ({ offendingPermissions: (err as GrantExceedsIssuerError).offendingPermissions }),
};
export const USER_VALIDATION: UserErrorRung = { matches: ({ err }) => err instanceof IdentityValidationError, status: 400, code: "VALIDATION_ERROR" };
export const USER_NOT_FOUND: UserErrorRung = { matches: ({ err }) => err instanceof IdentityNotFoundError, status: 404, code: "RESOURCE_NOT_FOUND" };
/** assign-role/attach-policy always answered a missing role/policy/principal without a code. */
export const USER_NOT_FOUND_CODELESS: UserErrorRung = { matches: ({ err }) => err instanceof IdentityNotFoundError, status: 404 };
export const USER_OWNER_REQUIRED: UserErrorRung = { matches: ({ err }) => err instanceof OwnerRequiredError, status: 409, code: "OWNER_REQUIRED" };
/** create's username conflict: always `RESOURCE_CONFLICT`, whatever code the service attached. */
export const USER_USERNAME_CONFLICT: UserErrorRung = {
  matches: ({ err }) => err instanceof IdentityConflictError, status: 409, code: "RESOURCE_CONFLICT", details: () => ({ field: "username" }),
};
/** update's conflict keeps the service's own code (a rename onto a trashed holder is `USER_IN_TRASH`). */
export const USER_CONFLICT_OWN_CODE: UserErrorRung = {
  matches: ({ err }) => err instanceof IdentityConflictError, status: 409,
  code: ({ err }) => (err as IdentityConflictError).code ?? "RESOURCE_CONFLICT", details: () => ({ field: "username" }),
};

/** A rung for a host-owned error class, matched through its injected predicate. @complexity O(1). */
export function hostRung(
  required: { matches: HostErrorPredicate; status: number; code?: string },
  _optional: Record<string, never> = {},
): UserErrorRung {
  return required.code === undefined ? { matches: required.matches, status: required.status } : { matches: required.matches, status: required.status, code: required.code };
}

/**
 * Refuses with the first matching rung's status and the error's own message; anything unmapped is
 * rethrown unchanged — including a refusal the route already threw — so the host's error port
 * answers it (an unexpected failure as the redacted 500).
 * @complexity O(n) in the rung list length, a small fixed list per route.
 */
export function rejectUserError({ err, rungs }: { err: unknown; rungs: readonly UserErrorRung[] }, _optional: Record<string, never> = {}): never {
  const rung = rungs.find((candidate) => candidate.matches({ err }));
  if (!rung) throw err;
  const body: { error: string; code?: string; details?: unknown } = { error: err instanceof Error ? err.message : String(err) };
  if (rung.code !== undefined) body.code = typeof rung.code === "function" ? rung.code({ err }) : rung.code;
  if (rung.details) body.details = rung.details({ err });
  throw new RouteRefusalError({ status: rung.status, body });
}

/**
 * The 409 a Trash-member target gets from enable/update/reset-password (delete-user plan v2,
 * decision 7): refused BEFORE the transition — re-activating or editing a trashed principal would
 * leave an ACTIVE user still indexed for purge.
 */
export function rejectUserInTrash(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): never {
  throw new RouteRefusalError({ status: 409, body: { error: "this user is in the Trash; restore them first", code: "USER_IN_TRASH" } });
}

/**
 * The authenticated caller's id. The host defers a missing session to the route, so a mount without
 * a principal is a wiring bug that fails closed as the host's redacted 500, as `getAuthedPrincipal` did.
 * @complexity O(1).
 */
export function userActorId({ context }: { context: UserRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("users admin route has no authenticated principal");
  return context.id;
}

/** The `:principalId` path segment; Express always fills it, the `?? ""` mirrors the host's own guard. @complexity O(1). */
export function principalIdParam(params: Record<string, string | undefined>): string {
  return String(params.principalId ?? "");
}

/**
 * Builds the admin user shape for `principal` + its paired `user` row, reading the role/policy links.
 * The identity mutations return only one of the two records, so callers fetch the other first.
 * @complexity O(1) plus two repo reads.
 */
export async function adminUserWithGrants(
  { repos, workspaceId, principal, user }: { repos: Pick<IdentityRepos, "principalRoles" | "principalPolicies">; workspaceId: string; principal: PrincipalRecord; user: UserRecord },
  _optional: Record<string, never> = {},
): Promise<AdminUserResponse> {
  const [roleLinks, policyLinks] = await Promise.all([
    repos.principalRoles.listByPrincipalId({ workspaceId, principalId: principal.id }),
    repos.principalPolicies.listByPrincipalId({ workspaceId, principalId: principal.id }),
  ]);
  return toAdminUserResponse({ principal, user, roleIds: roleLinks.map((link) => link.roleId), policyIds: policyLinks.map((link) => link.policyId) });
}

/**
 * The admin user for a principal a mutation just returned. Every `kind='user'` principal has a paired
 * `UserRecord` by construction (CREATE_USER's atomicity guarantee), so the missing-user throw is
 * defensive, not an expected runtime path; it maps to the route's 404 like any not-found.
 * @complexity O(1) plus three repo reads.
 */
export async function adminUserForPrincipal(
  { repos, workspaceId, principal }: { repos: Pick<IdentityRepos, "users" | "principalRoles" | "principalPolicies">; workspaceId: string; principal: PrincipalRecord },
  _optional: Record<string, never> = {},
): Promise<AdminUserResponse> {
  const user = await repos.users.findByPrincipalId({ workspaceId, principalId: principal.id });
  if (!user) throw new IdentityNotFoundError({ message: `user '${principal.id}' was not found` });
  return adminUserWithGrants({ repos, workspaceId, principal, user });
}
