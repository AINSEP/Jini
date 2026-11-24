import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { RoleRepoPort } from "../../../core/ports.js";
import { toAdminRoleResponse, type AdminRoleResponse } from "../../http/users.js";
import { authorizeRoleManage, type AccessRoutePrincipal } from "./access-shared.js";

/** The deps this route reads: the workspace and the role list. */
export interface RoleListRouteDeps {
  workspaceId: string;
  roleRepo: Pick<RoleRepoPort, "list">;
}

/**
 * GET roles — list a workspace's roles (built-in + custom) for the Users admin screen's role
 * picker. Gated by `role.manage` — matches `createRole`/`createPolicy`'s own gate (identity's
 * `grant-service.ts`), since no separate `role.read` permission exists in the catalog (2026-07-16
 * authz sweep: this route previously had zero permission check beyond session auth).
 */
export const roleListRoute = defineJsonRoute<Record<string, never>, { roles: AdminRoleResponse[] }, RoleListRouteDeps, AccessRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/roles",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeRoleManage({ authorize });
    const roles = await deps.roleRepo.list({ workspaceId: deps.workspaceId });
    return ok({ value: { roles: roles.map(toAdminRoleResponse) } });
  },
});
