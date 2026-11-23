import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { deletePolicy } from "../../../server/admin-crud-service.js";
import {
  ACCESS_FORBIDDEN, ACCESS_NOT_FOUND, ACCESS_VALIDATION, accessActorId, accessConflictOn, accessPathParam, rejectAccessError,
  type AccessRoutePrincipal, type AccessServiceRouteDeps,
} from "./access-shared.js";

/** The deps this route reads: the workspace, the identity services' deps bag and the service it calls. */
export interface PolicyDeleteRouteDeps extends AccessServiceRouteDeps {
  /** Injected: the service lives in the node `./server` entry; the host binds it. */
  deletePolicy: typeof deletePolicy;
}

const POLICY_DELETE_ERRORS = [ACCESS_FORBIDDEN, accessConflictOn("policyId"), ACCESS_VALIDATION, ACCESS_NOT_FOUND] as const;

/**
 * DELETE policies/:policyId — `DELETE_POLICY` (SPEC-006 0.6.0, REQ-19/INV-09). Gated by
 * `role.manage`; a built-in or frozen target is refused `VALIDATION_ERROR`, a still-referenced
 * target `RESOURCE_CONFLICT` (AC-31). Answers 204 with no body.
 */
export const policyDeleteRoute = defineJsonRoute<{ policyId: string }, undefined, PolicyDeleteRouteDeps, AccessRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/policies/:policyId",
  parse: (raw) => ok({ value: { policyId: accessPathParam(raw.params, "policyId") } }),
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = accessActorId({ context });
    try {
      await deps.deletePolicy({ deps: deps.identityServiceDeps(), input: { workspaceId: deps.workspaceId, callerPrincipalId, policyId: input.policyId } });
      return ok({ value: undefined });
    } catch (err) {
      return rejectAccessError({ err, mappings: POLICY_DELETE_ERRORS });
    }
  },
}, { successStatus: 204 });
