import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { PrincipalRoleRecord } from "../../../core/types.js";
import type { assignRole } from "../../../server/grant-service.js";
import {
  principalIdParam, rejectUserError, USER_FORBIDDEN, USER_GRANT_EXCEEDS_ISSUER, USER_NOT_FOUND_CODELESS, USER_OWNER_REQUIRED, USER_VALIDATION,
  userActorId, type IdentityServicesFn, type UserRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. */
export interface UserAssignRoleRouteDeps {
  workspaceId: string;
  /** Identity service(s), injected: the admin-http entry may not reach the `server` source domain
   *  (subpath isolation); the host binds them from `@jini-ai/user-management/server`. */
  assignRole: typeof assignRole;
  identityServices: IdentityServicesFn;
}

/** Unmapped failures go to the host; a missing target/grant was always the code-less 404. */
const USER_ASSIGN_ROLE_ERRORS = [USER_FORBIDDEN, USER_GRANT_EXCEEDS_ISSUER, USER_VALIDATION, USER_NOT_FOUND_CODELESS, USER_OWNER_REQUIRED] as const;

/**
 * POST users/:principalId/roles — `ASSIGN_ROLE` (state.spec §3, AC-24/AC-25).
 * Gated by `role.manage`; target must be a `kind='user'` principal; the
 * INV-07 grant clamp must pass over every permission carried by the role's
 * policies. See `grant-service.ts`'s `assignRole` for the full contract.
 */
export const userAssignRoleRoute = defineJsonRoute<{ principalId: string; roleId: string }, { assignment: PrincipalRoleRecord }, UserAssignRoleRouteDeps, UserRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/users/:principalId/roles",
  // `?.` as the host read it: a null, absent or non-object body leaves the id empty for the service to refuse.
  parse: (raw) => ok({ value: { principalId: principalIdParam(raw.params), roleId: String((raw.body as { roleId?: unknown } | null | undefined)?.roleId ?? "") } }),
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = userActorId({ context });
    try {
      const { assignment } = await deps.assignRole({
        deps: deps.identityServices(),
        input: { workspaceId: deps.workspaceId, callerPrincipalId, principalId: input.principalId, roleId: input.roleId },
      });
      return ok({ value: { assignment } });
    } catch (err) {
      return rejectUserError({ err, rungs: USER_ASSIGN_ROLE_ERRORS });
    }
  },
}, { successStatus: 201 });
