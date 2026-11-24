import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { PolicyPermissionRecord } from "../../../core/types.js";
import type { writePolicyPermission } from "../../../server/admin-crud-service.js";
import {
  ACCESS_FORBIDDEN, ACCESS_GRANT_EXCEEDS_ISSUER, ACCESS_NOT_FOUND, ACCESS_VALIDATION, accessActorId, accessBody, accessPathParam,
  accessPermissionUnknown, optionalString, rejectAccessError, type AccessRoutePrincipal, type AccessServiceRouteDeps,
} from "./access-shared.js";

/** The deps this route reads. Which permissions may never be granted to another role, and the
 *  refusal copy, are the host's product policy (e.g. its manual-publishing backstop), so injected. */
export interface PolicyPermissionWriteRouteDeps extends AccessServiceRouteDeps {
  ungrantablePermissions: readonly string[];
  ungrantablePermissionRefusal: string;
  /** Injected: the service lives in the node `./server` entry; the host binds it. */
  writePolicyPermission: typeof writePolicyPermission;
}

/** The coerced payload, plus the permission exactly as sent — only for the PERMISSION_UNKNOWN echo. */
interface PolicyPermissionWriteInput {
  policyId: string;
  permission: string;
  requestedPermission: unknown;
  resourceType: string | undefined;
  constraintJson: string | undefined;
}

/**
 * POST policies/:policyId/permissions — `WRITE_POLICY_PERMISSION` (SPEC-006 0.6.0, INV-07 — first
 * HTTP route for a transition specified since v0.5.3, AC-32). Gated by `role.manage`; refuses an
 * unregistered permission (`PERMISSION_UNKNOWN`), a built-in or frozen parent policy
 * (`VALIDATION_ERROR`, INV-06/AC-26), or a permission the caller does not hold unconstrained
 * (`GRANT_EXCEEDS_ISSUER`, INV-07/AC-24).
 */
export const policyPermissionWriteRoute = defineJsonRoute<PolicyPermissionWriteInput, { policyPermission: PolicyPermissionRecord }, PolicyPermissionWriteRouteDeps, AccessRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/policies/:policyId/permissions",
  // Coerce the HTTP payload while leaving grant validation to the identity service.
  parse: (raw) => {
    const body = accessBody({ body: raw.body });
    return ok({ value: {
      policyId: accessPathParam({ params: raw.params, name: "policyId" }), permission: String(body.permission ?? ""), requestedPermission: body.permission,
      resourceType: optionalString({ value: body.resourceType }), constraintJson: optionalString({ value: body.constraintJson }),
    } });
  },
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = accessActorId({ context });
    // A host-reserved permission is refused before any grant work, by the raw value the client sent
    // (strict equality, as before): no role, however privileged its granter, may carry it.
    if (deps.ungrantablePermissions.includes(input.requestedPermission as string)) {
      rejectRoute({ status: 403, error: deps.ungrantablePermissionRefusal, code: "FORBIDDEN" });
    }
    // `PermissionUnknownError` echoes the request's own permission, so this ladder is per request.
    const mappings = [ACCESS_FORBIDDEN, ACCESS_GRANT_EXCEEDS_ISSUER, accessPermissionUnknown({ requested: input.requestedPermission }), ACCESS_VALIDATION, ACCESS_NOT_FOUND];
    try {
      const { policyPermission } = await deps.writePolicyPermission(
        { deps: deps.identityServiceDeps(), input: { workspaceId: deps.workspaceId, callerPrincipalId, policyId: input.policyId, permission: input.permission } },
        // An absent scope field is omitted (exact optional types); the service reads it as unscoped either way.
        {
          ...(input.resourceType === undefined ? {} : { resourceType: input.resourceType }),
          ...(input.constraintJson === undefined ? {} : { constraintJson: input.constraintJson }),
        },
      );
      return ok({ value: { policyPermission } });
    } catch (err) {
      return rejectAccessError({ err, mappings });
    }
  },
}, { successStatus: 201 });
