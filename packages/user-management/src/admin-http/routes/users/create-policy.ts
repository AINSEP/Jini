import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { createPolicy } from "../../../server/grant-service.js";
import { toAdminPolicyResponse, type AdminPolicyResponse } from "../../http/users.js";
import {
  ACCESS_FORBIDDEN, ACCESS_VALIDATION, accessActorId, accessBody, optionalString, rejectAccessError,
  type AccessRoutePrincipal, type AccessServiceRouteDeps,
} from "./access-shared.js";

/** The deps this route reads: the workspace and the identity services' deps bag. */
export interface PolicyCreateRouteDeps extends AccessServiceRouteDeps {}

const POLICY_CREATE_ERRORS = [ACCESS_FORBIDDEN, ACCESS_VALIDATION] as const;

/**
 * POST policies — `CREATE_POLICY` (state.spec §3). Gated by `role.manage`;
 * always mints `isBuiltin=false` and `isFrozen=false`.
 */
export const policyCreateRoute = defineJsonRoute<{ name: string; description: string | undefined }, { policy: AdminPolicyResponse }, PolicyCreateRouteDeps, AccessRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/policies",
  // This route's `name`/`description` POST fields, read off an untyped body in one place.
  parse: (raw) => {
    const body = accessBody(raw.body);
    return ok({ value: { name: String(body.name ?? ""), description: optionalString(body.description) } });
  },
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = accessActorId({ context });
    try {
      const { policy } = await createPolicy(
        { deps: deps.identityServiceDeps(), input: { workspaceId: deps.workspaceId, callerPrincipalId, name: input.name } },
        { description: input.description },
      );
      return ok({ value: { policy: toAdminPolicyResponse(policy) } });
    } catch (err) {
      return rejectAccessError({ err, mappings: POLICY_CREATE_ERRORS });
    }
  },
}, { successStatus: 201 });
