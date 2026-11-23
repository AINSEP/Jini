import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { deleteRole } from "../../../server/admin-crud-service.js";
import {
  ACCESS_FORBIDDEN, ACCESS_NOT_FOUND, ACCESS_VALIDATION, accessActorId, accessConflictOn, accessPathParam, rejectAccessError,
  type AccessRoutePrincipal, type AccessServiceRouteDeps,
} from "./access-shared.js";

/** The deps this route reads: the workspace, the identity services' deps bag and the service it calls. */
export interface RoleDeleteRouteDeps extends AccessServiceRouteDeps {
  /** Injected: the service lives in the node `./server` entry; the host binds it. */
  deleteRole: typeof deleteRole;
}

const ROLE_DELETE_ERRORS = [ACCESS_FORBIDDEN, accessConflictOn("roleId"), ACCESS_VALIDATION, ACCESS_NOT_FOUND] as const;

/**
 * DELETE roles/:roleId — `DELETE_ROLE` (SPEC-006 0.6.0, REQ-19/INV-09). Gated by `role.manage`; a
 * built-in target is refused `VALIDATION_ERROR`, a still-referenced target `RESOURCE_CONFLICT`
 * (AC-31). Answers 204 with no body.
 */
export const roleDeleteRoute = defineJsonRoute<{ roleId: string }, undefined, RoleDeleteRouteDeps, AccessRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/roles/:roleId",
  parse: (raw) => ok({ value: { roleId: accessPathParam(raw.params, "roleId") } }),
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = accessActorId({ context });
    try {
      await deps.deleteRole({ deps: deps.identityServiceDeps(), input: { workspaceId: deps.workspaceId, callerPrincipalId, roleId: input.roleId } });
      return ok({ value: undefined });
    } catch (err) {
      return rejectAccessError({ err, mappings: ROLE_DELETE_ERRORS });
    }
  },
}, { successStatus: 204 });
