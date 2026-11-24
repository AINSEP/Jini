import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { PolicyPermissionRepoPort, PolicyRepoPort } from "../../../core/ports.js";
import type { PolicyPermissionRecord } from "../../../core/types.js";
import { accessPathParam, authorizeRoleManage, type AccessRoutePrincipal } from "./access-shared.js";

/** The deps this route reads: the workspace, the policy lookup and its permission rows. */
export interface PolicyPermissionListRouteDeps {
  workspaceId: string;
  policyRepo: Pick<PolicyRepoPort, "findById">;
  policyPermissionRepo: Pick<PolicyPermissionRepoPort, "listByPolicyId">;
}

/**
 * GET policies/:policyId/permissions — the permission rows written onto one policy (OQ-10).
 *
 * Nothing exposed these before: `toAdminPolicyResponse` carries `id`/`name`/`description`/
 * `isBuiltin`/`isFrozen` and no permissions field, so the admin could POST a permission onto a
 * policy but never see what a policy already held. That made `remove-policy-permission.ts`
 * unusable on its own — a removal route needs an id, and this is the only route that yields one.
 *
 * Gated by `role.manage`, the same permission `list-policies.ts` requires (a policy's permission
 * set is exactly as sensitive as the policy list itself), and checked with the same inline
 * `deps.authorize` shape that file uses rather than the service-layer helper — this is a read, so
 * there is no identity transition to call.
 */
export const policyPermissionListRoute = defineJsonRoute<
  { policyId: string }, { policyPermissions: PolicyPermissionRecord[] }, PolicyPermissionListRouteDeps, AccessRoutePrincipal
>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/policies/:policyId/permissions",
  parse: (raw) => ok({ value: { policyId: accessPathParam({ params: raw.params, name: "policyId" }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeRoleManage({ authorize });
    const policy = await deps.policyRepo.findById({ workspaceId: deps.workspaceId, id: input.policyId });
    if (!policy) rejectRoute({ status: 404, error: `policy '${input.policyId}' was not found`, code: "RESOURCE_NOT_FOUND" });
    const policyPermissions = await deps.policyPermissionRepo.listByPolicyId({ workspaceId: deps.workspaceId, policyId: input.policyId });
    return ok({ value: { policyPermissions } });
  },
});
