import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { createRole } from "../../../server/grant-service.js";
import { toAdminRoleResponse, type AdminRoleResponse } from "../../http/users.js";
import {
  ACCESS_FORBIDDEN, ACCESS_VALIDATION, accessActorId, accessBody, rejectAccessError,
  type AccessRoutePrincipal, type AccessServiceRouteDeps,
} from "./access-shared.js";

/** The deps this route reads: the workspace, the identity services' deps bag and the service it calls. */
export interface RoleCreateRouteDeps extends AccessServiceRouteDeps {
  /** Injected: the service lives in the node `./server` entry; the host binds it. */
  createRole: typeof createRole;
}

const ROLE_CREATE_ERRORS = [ACCESS_FORBIDDEN, ACCESS_VALIDATION] as const;

/** POST roles — `CREATE_ROLE` (state.spec §3). Gated by `role.manage`; always mints `isBuiltin=false`. */
export const roleCreateRoute = defineJsonRoute<{ name: string }, { role: AdminRoleResponse }, RoleCreateRouteDeps, AccessRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/roles",
  parse: (raw) => ok({ value: { name: String(accessBody({ body: raw.body }).name ?? "") } }),
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = accessActorId({ context });
    try {
      const { role } = await deps.createRole({ deps: deps.identityServiceDeps(), input: { workspaceId: deps.workspaceId, callerPrincipalId, name: input.name } });
      return ok({ value: { role: toAdminRoleResponse(role) } });
    } catch (err) {
      return rejectAccessError({ err, mappings: ROLE_CREATE_ERRORS });
    }
  },
}, { successStatus: 201 });
