import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { updateRole } from "../../../server/admin-crud-service.js";
import { toAdminRoleResponse, type AdminRoleResponse } from "../../http/users.js";
import {
  ACCESS_FORBIDDEN, ACCESS_VERSION_CONFLICT, accessExpectedVersion, ACCESS_NOT_FOUND, ACCESS_VALIDATION, accessActorId, accessBody, accessPathParam, rejectAccessError,
  type AccessRoutePrincipal, type AccessServiceRouteDeps,
} from "./access-shared.js";

/** The deps this route reads: the workspace, the identity services' deps bag and the service it calls. */
export interface RoleUpdateRouteDeps extends AccessServiceRouteDeps {
  /** Injected: the service lives in the node `./server` entry; the host binds it. */
  updateRole: typeof updateRole;
}

const ROLE_UPDATE_ERRORS = [ACCESS_VERSION_CONFLICT, ACCESS_FORBIDDEN, ACCESS_VALIDATION, ACCESS_NOT_FOUND] as const;

/**
 * PATCH roles/:roleId — `UPDATE_ROLE` (SPEC-006 0.6.0, REQ-18) — rename a non-built-in role. Gated
 * by `role.manage`; a built-in target is refused `VALIDATION_ERROR` (INV-06 extended, AC-30).
 */
export const roleUpdateRoute = defineJsonRoute<{ roleId: string; name: string }, { role: AdminRoleResponse }, RoleUpdateRouteDeps, AccessRoutePrincipal>({
  method: "patch",
  path: "/api/admin/v1/workspaces/:workspaceId/roles/:roleId",
  parse: (raw) => ok({ value: { roleId: accessPathParam({ params: raw.params, name: "roleId" }), name: String(accessBody({ body: raw.body }).name ?? "") } }),
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = accessActorId({ context });
    try {
      const { role } = await deps.updateRole({ deps: deps.identityServiceDeps(), input: { workspaceId: deps.workspaceId, callerPrincipalId, ...input } });
      return ok({ value: { role: toAdminRoleResponse(role) } });
    } catch (err) {
      return rejectAccessError({ err, mappings: ROLE_UPDATE_ERRORS });
    }
  },
});
