import { defineJsonRoute, ok, routeReply, type RouteReply } from "@jini-ai/core/contracts/server";

import type { IdentityTransactionPort, PolicyPermissionRepoPort } from "../../../core/ports.js";
import { OwnerRequiredError } from "../../../core/types.js";
import type { removePolicyPermission } from "../../../server/admin-crud-service.js";
import type { AuthServiceDeps } from "../../../server/auth-service.js";
import {
  ACCESS_FORBIDDEN, ACCESS_NOT_FOUND, ACCESS_OWNER_REQUIRED, ACCESS_VALIDATION, accessActorId, accessPathParam, rejectAccessError,
  type AccessRoutePrincipal, type AccessServiceRouteDeps,
} from "./access-shared.js";

/** The host's owner test: does this principal hold the unconstrained `*` grant? (The host owns who is an owner.) */
export type PrincipalHoldsOwnerWildcardFn = (
  required: { deps: AuthServiceDeps; workspaceId: string; principalId: string },
  optional?: Record<string, never>,
) => Promise<boolean>;

/** The host's post-write invariant: throws `OwnerRequiredError` when no active owner would remain. */
export type AssertActiveOwnerFloorFn = (
  required: { deps: AuthServiceDeps; workspaceId: string },
  optional?: Record<string, never>,
) => Promise<void>;

/** The deps this route reads. */
export interface PolicyPermissionRemoveRouteDeps extends AccessServiceRouteDeps {
  transactions: Pick<IdentityTransactionPort, "run">;
  policyPermissionRepo: Pick<PolicyPermissionRepoPort, "listByPolicyId">;
  /** Injected: the service lives in the node `./server` entry; the host binds it. */
  removePolicyPermission: typeof removePolicyPermission;
  principalHoldsOwnerWildcard: PrincipalHoldsOwnerWildcardFn;
  assertActiveOwnerFloor: AssertActiveOwnerFloorFn;
}

interface RemoveInput { policyId: string; policyPermissionId: string }

/** This route's thrown error types onto the admin error envelope — the same mapping
 *  `delete-policy.ts` uses, minus `IdentityConflictError`: `removePolicyPermission` has no
 *  reference guard to violate (a permission row is a leaf, nothing points at it). */
const POLICY_PERMISSION_REMOVE_ERRORS = [ACCESS_OWNER_REQUIRED, ACCESS_FORBIDDEN, ACCESS_VALIDATION, ACCESS_NOT_FOUND] as const;

/** Only an owner may remove an unconstrained owner-`*` row: refused before the service runs.
 *  @complexity O(n) in the policy's row count plus the injected owner test. */
async function refuseNonOwnerWildcardRemoval(
  { deps, serviceDeps, input, callerPrincipalId }: { deps: PolicyPermissionRemoveRouteDeps; serviceDeps: AuthServiceDeps; input: RemoveInput; callerPrincipalId: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  const rows = await deps.policyPermissionRepo.listByPolicyId({ workspaceId: deps.workspaceId, policyId: input.policyId });
  const removed = rows.find(row => row.id === input.policyPermissionId);
  if (removed?.permission === "*" && removed.resourceType == null && removed.constraintJson == null
      && !await deps.principalHoldsOwnerWildcard({ deps: serviceDeps, workspaceId: deps.workspaceId, principalId: callerPrincipalId })) {
    throw new OwnerRequiredError({ message: "only an owner can modify an owner principal" });
  }
}

/** The guarded removal, the service call and the owner floor, in one identity transaction (the
 *  floor throws inside it so the removal rolls back). @complexity O(1) plus the injected work. */
async function removeInTransaction({ deps, input, callerPrincipalId }: { deps: PolicyPermissionRemoveRouteDeps; input: RemoveInput; callerPrincipalId: string }, _optional: Record<string, never> = {}): Promise<void> {
  const serviceDeps = deps.identityServiceDeps();
  await deps.transactions.run({ workspaceId: deps.workspaceId, execute: async () => {
    await refuseNonOwnerWildcardRemoval({ deps, serviceDeps, input, callerPrincipalId });
    await deps.removePolicyPermission({ deps: serviceDeps, input: { workspaceId: deps.workspaceId, callerPrincipalId, ...input } });
    await deps.assertActiveOwnerFloor({ deps: serviceDeps, workspaceId: deps.workspaceId });
  } });
}

/**
 * DELETE policies/:policyId/permissions/:policyPermissionId — `REMOVE_POLICY_PERMISSION` (OQ-10),
 * the inverse of `write-policy-permission.ts` and the route that closes the gap `Roles.tsx`'s own
 * header comment flagged: until now a policy's permission set was append-only, and the only way to
 * shrink it was `DELETE_POLICY` + recreate — which INV-09 refuses outright the moment any role or
 * principal references the policy.
 *
 * Gated by `role.manage`, exactly as the ADD route is. A built-in or frozen parent policy is
 * refused `VALIDATION_ERROR` (INV-06/AC-26); a permission id that is absent — or that belongs to a
 * different policy — is `RESOURCE_NOT_FOUND`, never a silent no-op success (the service proves
 * membership from the policy's own rows before deleting).
 *
 * Returns 204, matching `delete-policy.ts`'s convention for a delete with nothing to echo back —
 * as an explicit bodiless `routeReply`, so the host writes a bare `send()` (the hand-written
 * route's `res.status(204).send()`), never a JSON body.
 */
export const policyPermissionRemoveRoute = defineJsonRoute<RemoveInput, RouteReply, PolicyPermissionRemoveRouteDeps, AccessRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/policies/:policyId/permissions/:policyPermissionId",
  parse: (raw) => ok({ value: {
    policyId: accessPathParam({ params: raw.params, name: "policyId" }),
    policyPermissionId: accessPathParam({ params: raw.params, name: "policyPermissionId" }),
  } }),
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = accessActorId({ context });
    try {
      await removeInTransaction({ deps, input, callerPrincipalId });
      return ok({ value: routeReply({ status: 204 }) });
    } catch (err) {
      return rejectAccessError({ err, mappings: POLICY_PERMISSION_REMOVE_ERRORS });
    }
  },
});
