import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { IdentityTransactionPort } from "../../../core/ports.js";
import { OwnerRequiredError } from "../../../core/types.js";
import { removePolicyPermission } from "../../../server/admin-crud-service.js";
import type { AuthServiceDeps } from "../../../server/auth-service.js";
import {
  ACCESS_FORBIDDEN, ACCESS_NOT_FOUND, ACCESS_OWNER_REQUIRED, ACCESS_VALIDATION, accessActorId, accessPathParam, rejectAccessError,
  type AccessRoutePrincipal, type AccessServiceRouteDeps,
} from "./access-shared.js";

/** Whether a principal holds the unscoped owner wildcard. Injected: the host owns its owner model. */
export type OwnerWildcardProbe = (required: { deps: AuthServiceDeps; workspaceId: string; principalId: string }) => Promise<boolean>;

/** Throws when the workspace would be left without an active owner. Injected, as the probe above. */
export type OwnerFloorAssertion = (required: { deps: AuthServiceDeps; workspaceId: string }) => Promise<void>;

/** The deps this route reads: the workspace, the services' deps bag, the unit of work and the host's owner rules. */
export interface PolicyPermissionRemoveRouteDeps extends AccessServiceRouteDeps {
  transactions: Pick<IdentityTransactionPort, "run">;
  principalHoldsOwnerWildcard: OwnerWildcardProbe;
  assertActiveOwnerFloor: OwnerFloorAssertion;
}

type RemoveInput = { policyId: string; policyPermissionId: string };

/** The same mapping `delete-policy` uses, minus `IdentityConflictError`: `removePolicyPermission` has
 *  no reference guard to violate (a permission row is a leaf, nothing points at it). The owner rung
 *  comes first: both owner checks below throw it. */
const POLICY_PERMISSION_REMOVE_ERRORS = [ACCESS_OWNER_REQUIRED, ACCESS_FORBIDDEN, ACCESS_VALIDATION, ACCESS_NOT_FOUND] as const;

/**
 * The unscoped `*` row is what makes a principal an owner, so only an owner may strip it; a `*`
 * row scoped by resource type or constraint grants no ownership and is an ordinary row. An absent
 * or foreign row id passes here and the service answers it not-found.
 * @complexity O(rows of the policy) plus the injected probe.
 */
async function assertMayRemoveOwnerWildcard(
  { deps, serviceDeps, input, callerPrincipalId }: { deps: PolicyPermissionRemoveRouteDeps; serviceDeps: AuthServiceDeps; input: RemoveInput; callerPrincipalId: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  const rows = await serviceDeps.repos.policyPermissions.listByPolicyId({ workspaceId: deps.workspaceId, policyId: input.policyId });
  const removed = rows.find((row) => row.id === input.policyPermissionId);
  if (removed?.permission !== "*" || removed.resourceType != null || removed.constraintJson != null) return;
  if (await deps.principalHoldsOwnerWildcard({ deps: serviceDeps, workspaceId: deps.workspaceId, principalId: callerPrincipalId })) return;
  throw new OwnerRequiredError({ message: "only an owner can modify an owner principal" });
}

/**
 * DELETE policies/:policyId/permissions/:policyPermissionId — `REMOVE_POLICY_PERMISSION` (OQ-10),
 * the inverse of `write-policy-permission` and the route that closes the gap the admin Roles
 * screen's own header comment flagged: until now a policy's permission set was append-only, and the
 * only way to shrink it was `DELETE_POLICY` + recreate — which INV-09 refuses outright the moment
 * any role or principal references the policy.
 *
 * Gated by `role.manage`, exactly as the ADD route is. A built-in or frozen parent policy is
 * refused `VALIDATION_ERROR` (INV-06/AC-26); a permission id that is absent — or that belongs to a
 * different policy — is `RESOURCE_NOT_FOUND`, never a silent no-op success (the service proves
 * membership from the policy's own rows before deleting). The owner guard, the removal and the
 * owner-floor check share one unit of work, so a refused floor rolls the removal back.
 *
 * Returns 204, matching `delete-policy`'s convention for a delete with nothing to echo back.
 */
export const policyPermissionRemoveRoute = defineJsonRoute<RemoveInput, undefined, PolicyPermissionRemoveRouteDeps, AccessRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/policies/:policyId/permissions/:policyPermissionId",
  parse: (raw) => ok({ value: { policyId: accessPathParam(raw.params, "policyId"), policyPermissionId: accessPathParam(raw.params, "policyPermissionId") } }),
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = accessActorId({ context });
    try {
      const serviceDeps = deps.identityServiceDeps();
      await deps.transactions.run({ workspaceId: deps.workspaceId, execute: async () => {
        await assertMayRemoveOwnerWildcard({ deps, serviceDeps, input, callerPrincipalId });
        await removePolicyPermission({ deps: serviceDeps, input: { workspaceId: deps.workspaceId, callerPrincipalId, ...input } });
        await deps.assertActiveOwnerFloor({ deps: serviceDeps, workspaceId: deps.workspaceId });
      } });
      return ok({ value: undefined });
    } catch (err) {
      return rejectAccessError({ err, mappings: POLICY_PERMISSION_REMOVE_ERRORS });
    }
  },
}, { successStatus: 204 });
