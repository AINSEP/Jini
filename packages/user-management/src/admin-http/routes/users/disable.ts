import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { disablePrincipal } from "../../../server/admin-crud-service.js";
import type { AdminUserResponse } from "../../http/users.js";
import {
  adminUserForPrincipal, hostRung, principalIdParam, rejectUserError, USER_FORBIDDEN, USER_NOT_FOUND, USER_OWNER_REQUIRED, USER_VALIDATION, userActorId,
  type AssertUserAccountActionFn, type HostErrorPredicate, type IdentityServicesFn, type UserErrorRung, type UserRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. */
export interface UserDisableRouteDeps {
  workspaceId: string;
  identityServices: IdentityServicesFn;
  /** The seeded (bootstrap) owner's principal id, resolved by the host at boot. */
  ownerPrincipalId: PromiseLike<string> | string;
  assertUserAccountAction: AssertUserAccountActionFn;
  /** Matches the host's "you cannot disable your own account" error. */
  isSelfDeleteError: HostErrorPredicate;
}

/** This route's ladder, in the hand-written order; the self-target rung is the host's class. @complexity O(1). */
function userDisableErrors({ deps }: { deps: UserDisableRouteDeps }, _optional: Record<string, never> = {}): readonly UserErrorRung[] {
  return [hostRung({ matches: deps.isSelfDeleteError, status: 409, code: "SELF_DELETE" }), USER_FORBIDDEN, USER_OWNER_REQUIRED, USER_VALIDATION, USER_NOT_FOUND];
}

/**
 * POST users/:principalId/disable — `DISABLE_PRINCIPAL` (SPEC-006 0.6.0, REQ-11, first HTTP route
 * for a transition specified since v0.5.0). Gated by `user.manage`; refuses the seeded owner
 * unconditionally and refuses any disable that would drop the active owner-`*` count to zero
 * (INV-08) — see `server/admin-crud-service.ts`'s `disablePrincipal` for the full contract.
 *
 * `disablePrincipal` returns only the updated `PrincipalRecord` — the admin shape also needs the
 * paired `UserRecord` (see `adminUserForPrincipal` for why that lookup is defensive).
 */
export const userDisableRoute = defineJsonRoute<{ principalId: string }, { user: AdminUserResponse }, UserDisableRouteDeps, UserRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/users/:principalId/disable",
  parse: (raw) => ok({ value: { principalId: principalIdParam(raw.params) } }),
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = userActorId({ context });
    const { workspaceId } = deps;
    const { principalId } = input;
    try {
      const seededOwnerPrincipalId = await deps.ownerPrincipalId;
      const services = deps.identityServices();
      const { principal } = await services.repos.transactions.run({ workspaceId, execute: async () => {
        await deps.assertUserAccountAction({ deps: services, workspaceId, principalId, action: "disable" }, { callerPrincipalId, seededOwnerPrincipalId });
        return disablePrincipal({ deps: services, input: { workspaceId, callerPrincipalId, principalId, seededOwnerPrincipalId } });
      } });
      return ok({ value: { user: await adminUserForPrincipal({ repos: services.repos, workspaceId, principal }) } });
    } catch (err) {
      return rejectUserError({ err, rungs: userDisableErrors({ deps }) });
    }
  },
});
