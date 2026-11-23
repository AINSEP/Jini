import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { updatePolicy } from "../../../server/admin-crud-service.js";
import { toAdminPolicyResponse, type AdminPolicyResponse } from "../../http/users.js";
import {
  ACCESS_FORBIDDEN, ACCESS_NOT_FOUND, ACCESS_VALIDATION, accessActorId, accessBody, accessPathParam, optionalString, rejectAccessError,
  type AccessRoutePrincipal, type AccessServiceRouteDeps,
} from "./access-shared.js";

/** The deps this route reads: the workspace and the identity services' deps bag. */
export interface PolicyUpdateRouteDeps extends AccessServiceRouteDeps {}

/** The two writable PATCH fields — `undefined` means "leave unchanged" — plus the target id. */
interface PolicyUpdateInput { policyId: string; name: string | undefined; description: string | undefined }

const POLICY_UPDATE_ERRORS = [ACCESS_FORBIDDEN, ACCESS_VALIDATION, ACCESS_NOT_FOUND] as const;

/**
 * PATCH policies/:policyId — `UPDATE_POLICY` (SPEC-006 0.6.0, REQ-18) — rename/re-describe a
 * non-built-in, non-frozen policy. Gated by `role.manage`; a built-in or frozen target is refused
 * `VALIDATION_ERROR` (INV-06/AC-26, AC-30).
 */
export const policyUpdateRoute = defineJsonRoute<PolicyUpdateInput, { policy: AdminPolicyResponse }, PolicyUpdateRouteDeps, AccessRoutePrincipal>({
  method: "patch",
  path: "/api/admin/v1/workspaces/:workspaceId/policies/:policyId",
  parse: (raw) => {
    const body = accessBody(raw.body);
    return ok({ value: { policyId: accessPathParam(raw.params, "policyId"), name: optionalString(body.name), description: optionalString(body.description) } });
  },
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = accessActorId({ context });
    try {
      const { policy } = await updatePolicy(
        { deps: deps.identityServiceDeps(), input: { workspaceId: deps.workspaceId, callerPrincipalId, policyId: input.policyId } },
        { name: input.name, description: input.description },
      );
      return ok({ value: { policy: toAdminPolicyResponse(policy) } });
    } catch (err) {
      return rejectAccessError({ err, mappings: POLICY_UPDATE_ERRORS });
    }
  },
});
