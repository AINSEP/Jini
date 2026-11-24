import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { PolicyRepoPort } from "../../../core/ports.js";
import { toAdminPolicyResponse, type AdminPolicyResponse } from "../../http/users.js";
import { authorizeRoleManage, type AccessRoutePrincipal } from "./access-shared.js";

/** The deps this route reads: the workspace and the policy list. */
export interface PolicyListRouteDeps {
  workspaceId: string;
  policyRepo: Pick<PolicyRepoPort, "list">;
}

/**
 * GET policies — list a workspace's policies (built-in + custom) for the Users admin screen's
 * policy picker. Gated by `role.manage`, mirroring `list-roles.ts`'s identical reasoning
 * (`createPolicy` is also gated by `role.manage`, not a separate `policy.manage`; 2026-07-16
 * authz sweep: this route previously had zero permission check beyond session auth).
 */
export const policyListRoute = defineJsonRoute<Record<string, never>, { policies: AdminPolicyResponse[] }, PolicyListRouteDeps, AccessRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/policies",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeRoleManage({ authorize });
    const policies = await deps.policyRepo.list({ workspaceId: deps.workspaceId });
    return ok({ value: { policies: policies.map(toAdminPolicyResponse) } });
  },
});
