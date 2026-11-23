import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { IdentityNotFoundError, type UserRecord } from "../../../core/types.js";
import type { updateUser } from "../../../server/admin-crud-service.js";
import type { AuthServiceDeps } from "../../../server/auth-service.js";
import type { AdminUserResponse } from "../../http/users.js";
import {
  adminUserWithGrants, principalIdParam, rejectUserError, rejectUserInTrash, USER_CONFLICT_OWN_CODE, USER_FORBIDDEN, USER_NOT_FOUND,
  USER_OWNER_REQUIRED, USER_VALIDATION, userActorId, hostRung, type HostErrorPredicate, type UserErrorRung, type IdentityServicesFn, type IsInTrashFn, type UserRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. */
export interface UserUpdateRouteDeps {
  workspaceId: string;
  /** Identity service(s), injected: the admin-http entry may not reach the `server` source domain
   *  (subpath isolation); the host binds them from `@jini-ai/user-management/server`. */
  updateUser: typeof updateUser;
  identityServices: IdentityServicesFn;
  isInTrash: IsInTrashFn;
  /** Matches the host's "user is in the Trash" error, which its Trash index may throw itself. */
  isUserInTrashError: HostErrorPredicate;
}

/**
 * The writable PATCH fields — `undefined` means "leave unchanged". A non-string `username` is only
 * flagged here: the host refused it AFTER reading the session and the Trash guard, so the 400 is
 * raised in `handle` to keep a trashed target's 409 (and a missing session's 500) winning.
 */
export interface UserUpdateInput { principalId: string; email: string | undefined; username: string | undefined; usernameIsInvalid: boolean }

/** This route's ladder, in the hand-written order; the in-Trash rung is the host's class. @complexity O(1). */
function userUpdateErrors({ deps }: { deps: UserUpdateRouteDeps }, _optional: Record<string, never> = {}): readonly UserErrorRung[] {
  return [USER_CONFLICT_OWN_CODE, USER_VALIDATION, hostRung({ matches: deps.isUserInTrashError, status: 409, code: "USER_IN_TRASH" }), USER_FORBIDDEN, USER_NOT_FOUND, USER_OWNER_REQUIRED];
}

/**
 * Loads the principal record plus role/policy links and builds the admin response shape.
 * `updateUser` returns only the updated `UserRecord`; the response also needs the paired
 * `PrincipalRecord`, so this re-fetches it — a missing principal here is defensive, not an
 * expected runtime path (the same id `updateUser` itself just succeeded against).
 * @complexity O(1) plus three repo reads.
 */
async function assembleUpdatedUserResponse(
  { services, workspaceId, principalId, user }: { services: AuthServiceDeps; workspaceId: string; principalId: string; user: UserRecord },
  _optional: Record<string, never> = {},
): Promise<AdminUserResponse> {
  const principal = await services.repos.principals.findById({ workspaceId, id: principalId });
  if (!principal) throw new IdentityNotFoundError({ message: `principal '${principalId}' was not found` });
  return adminUserWithGrants({ repos: services.repos, workspaceId, principal, user });
}

/** Runs `updateUser` inside one identity transaction. @complexity O(1) plus the service. */
async function updateInTransaction(
  { deps, services, callerPrincipalId, input }: { deps: UserUpdateRouteDeps; services: AuthServiceDeps; callerPrincipalId: string; input: UserUpdateInput },
  _optional: Record<string, never> = {},
): Promise<{ user: UserRecord }> {
  const { workspaceId } = deps;
  const { principalId, email, username } = input;
  return services.repos.transactions.run({
    workspaceId,
    execute: async () => {
      // The email setter clears an omitted value. HTTP PATCH retains an omitted field;
      // read and write in the same identity transaction so a competing edit cannot be lost.
      const current = email === undefined ? await services.repos.users.findByPrincipalId({ workspaceId, principalId }) : undefined;
      return deps.updateUser({ deps: services, input: { workspaceId, callerPrincipalId, principalId } }, { email: email === undefined ? current?.email : email, username });
    },
  });
}

/**
 * PATCH users/:principalId — `UPDATE_USER` (SPEC-006 0.6.0, REQ-16). Gated by `user.manage`;
 * existing self-profile edits also accept `member.manage`. Only owners may edit owner targets.
 * Username changes require `user.manage`; other unknown fields, including password, stay ignored.
 */
export const userUpdateRoute = defineJsonRoute<UserUpdateInput, { user: AdminUserResponse }, UserUpdateRouteDeps, UserRoutePrincipal>({
  method: "patch",
  path: "/api/admin/v1/workspaces/:workspaceId/users/:principalId",
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    const usernameIsInvalid = body.username !== undefined && typeof body.username !== "string";
    return ok({ value: {
      principalId: principalIdParam(raw.params),
      email: body.email !== undefined ? String(body.email) : undefined,
      username: usernameIsInvalid ? undefined : (body.username as string | undefined),
      usernameIsInvalid,
    } });
  },
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = userActorId({ context });
    try {
      // OWNER DECISION 2026-09-24 (delete-user plan v2, decision 7) — refuse BEFORE the transition;
      // see `rejectUserInTrash` for why. Both refusals are inside the `try` (as the host had them) so
      // a Trash-index failure still maps through the ladder; a refusal is not a rung and passes through.
      if (await deps.isInTrash({ principalId: input.principalId })) rejectUserInTrash();
      if (input.usernameIsInvalid) rejectRoute({ status: 400, error: "username must be a string", code: "VALIDATION_ERROR" });
      const services = deps.identityServices();
      const { user } = await updateInTransaction({ deps, services, callerPrincipalId, input });
      return ok({ value: { user: await assembleUpdatedUserResponse({ services, workspaceId: deps.workspaceId, principalId: input.principalId, user }) } });
    } catch (err) {
      return rejectUserError({ err, rungs: userUpdateErrors({ deps }) });
    }
  },
});
