import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { enablePrincipal } from "../../../server/admin-crud-service.js";
import type { assertCallerHasAnyPermission } from "../../../server/grant-service.js";
import type { AdminUserResponse } from "../../http/users.js";
import {
  adminUserForPrincipal, principalIdParam, rejectUserError, rejectUserInTrash, USER_FORBIDDEN, USER_NOT_FOUND, USER_OWNER_REQUIRED, USER_VALIDATION,
  userActorId, hostRung, type AssertUserAccountActionFn, type HostErrorPredicate, type UserErrorRung, type IdentityServicesFn, type IsInTrashFn,
  type UserRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. */
export interface UserEnableRouteDeps {
  workspaceId: string;
  /** Identity service(s), injected: the admin-http entry may not reach the `server` source domain
   *  (subpath isolation); the host binds them from `@jini-ai/user-management/server`. */
  enablePrincipal: typeof enablePrincipal;
  assertCallerHasAnyPermission: typeof assertCallerHasAnyPermission;
  identityServices: IdentityServicesFn;
  isInTrash: IsInTrashFn;
  /** The seeded (bootstrap) owner's principal id, resolved by the host at boot. */
  ownerPrincipalId: PromiseLike<string> | string;
  /** The host's account guard, run with action `enable` (B151): only an owner may re-enable an admin or owner. */
  assertUserAccountAction: AssertUserAccountActionFn;
  /** Matches the host's "user is in the Trash" error, which its Trash index may throw itself. */
  isUserInTrashError: HostErrorPredicate;
}

/** This route's ladder, in the hand-written order; the in-Trash rung is the host's class. @complexity O(1). */
function userEnableErrors({ deps }: { deps: UserEnableRouteDeps }, _optional: Record<string, never> = {}): readonly UserErrorRung[] {
  return [hostRung({ matches: deps.isUserInTrashError, status: 409, code: "USER_IN_TRASH" }), USER_FORBIDDEN, USER_VALIDATION, USER_NOT_FOUND, USER_OWNER_REQUIRED];
}

/**
 * POST users/:principalId/enable — `ENABLE_PRINCIPAL` (SPEC-006 0.6.0, REQ-15) — the symmetric
 * re-activation `DISABLE_PRINCIPAL` never had a counterpart for. Gated by `user.manage`; target
 * must be `kind='user'` (EC-14). See `adminUserForPrincipal` for why the paired-user lookup is
 * defensive, not an expected runtime path.
 */
export const userEnableRoute = defineJsonRoute<{ principalId: string }, { user: AdminUserResponse }, UserEnableRouteDeps, UserRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/users/:principalId/enable",
  parse: (raw) => ok({ value: { principalId: principalIdParam(raw.params) } }),
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = userActorId({ context });
    const { workspaceId } = deps;
    const { principalId } = input;
    try {
      // Trash membership is private too: use the identity owner's gate before looking it up.
      const services = deps.identityServices();
      await deps.assertCallerHasAnyPermission({ deps: services, workspaceId, callerPrincipalId, permissions: ["user.manage"] });
      // OWNER DECISION 2026-09-24 (delete-user plan v2, decision 7) — refuse BEFORE the transition:
      // re-activating a trashed principal would leave an ACTIVE user still indexed for purge. The
      // refusal is not a rung, so `rejectUserError` rethrows it unchanged.
      if (await deps.isInTrash({ principalId })) rejectUserInTrash();
      // B151 (owner rule 2026-11-20): only an owner may turn an admin or owner account back on —
      // `user.manage` alone would let an admin undo the owner's disable. Same guard as disable.ts,
      // in the same transaction as the write.
      const seededOwnerPrincipalId = await deps.ownerPrincipalId;
      const { principal } = await services.repos.transactions.run({ workspaceId, execute: async () => {
        await deps.assertUserAccountAction({ deps: services, workspaceId, principalId, action: "enable" }, { callerPrincipalId, seededOwnerPrincipalId });
        return deps.enablePrincipal({ deps: services, input: { workspaceId, callerPrincipalId, principalId } });
      } });
      return ok({ value: { user: await adminUserForPrincipal({ repos: services.repos, workspaceId, principal }) } });
    } catch (err) {
      return rejectUserError({ err, rungs: userEnableErrors({ deps }) });
    }
  },
});
