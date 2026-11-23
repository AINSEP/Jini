import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { enablePrincipal } from "../../../server/admin-crud-service.js";
import { assertCallerHasAnyPermission } from "../../../server/grant-service.js";
import type { AdminUserResponse } from "../../http/users.js";
import {
  adminUserForPrincipal, principalIdParam, rejectUserError, rejectUserInTrash, USER_FORBIDDEN, USER_NOT_FOUND, USER_OWNER_REQUIRED, USER_VALIDATION,
  userActorId, type IdentityServicesFn, type IsInTrashFn, type UserRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. */
export interface UserEnableRouteDeps {
  workspaceId: string;
  identityServices: IdentityServicesFn;
  isInTrash: IsInTrashFn;
}

const USER_ENABLE_ERRORS = [USER_FORBIDDEN, USER_VALIDATION, USER_NOT_FOUND, USER_OWNER_REQUIRED] as const;

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
      await assertCallerHasAnyPermission({ deps: services, workspaceId, callerPrincipalId, permissions: ["user.manage"] });
      // OWNER DECISION 2026-09-24 (delete-user plan v2, decision 7) — refuse BEFORE the transition:
      // re-activating a trashed principal would leave an ACTIVE user still indexed for purge. The
      // refusal is not a rung, so `rejectUserError` rethrows it unchanged.
      if (await deps.isInTrash({ principalId })) rejectUserInTrash();
      const { principal } = await enablePrincipal({ deps: services, input: { workspaceId, callerPrincipalId, principalId } });
      return ok({ value: { user: await adminUserForPrincipal({ repos: services.repos, workspaceId, principal }) } });
    } catch (err) {
      return rejectUserError({ err, rungs: USER_ENABLE_ERRORS });
    }
  },
});
