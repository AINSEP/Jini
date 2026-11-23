import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { PrincipalPolicyRecord } from "../../../core/types.js";
import { attachPolicy } from "../../../server/grant-service.js";
import {
  principalIdParam, rejectUserError, USER_FORBIDDEN, USER_GRANT_EXCEEDS_ISSUER, USER_NOT_FOUND_CODELESS, USER_OWNER_REQUIRED, USER_VALIDATION,
  userActorId, type IdentityServicesFn, type UserRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. */
export interface UserAttachPolicyRouteDeps {
  workspaceId: string;
  identityServices: IdentityServicesFn;
}

/** Unmapped failures go to the host; a missing target/grant was always the code-less 404. */
const USER_ATTACH_POLICY_ERRORS = [USER_FORBIDDEN, USER_GRANT_EXCEEDS_ISSUER, USER_VALIDATION, USER_NOT_FOUND_CODELESS, USER_OWNER_REQUIRED] as const;

/**
 * POST users/:principalId/policies — `ATTACH_POLICY` (state.spec §3,
 * AC-24/AC-25). Gated by `role.manage`; target must be a `kind='user'`
 * principal; the INV-07 grant clamp must pass over every permission the
 * policy carries. See `grant-service.ts`'s `attachPolicy` for the full
 * contract.
 */
export const userAttachPolicyRoute = defineJsonRoute<{ principalId: string; policyId: string }, { attachment: PrincipalPolicyRecord }, UserAttachPolicyRouteDeps, UserRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/users/:principalId/policies",
  // `?.` as the host read it: a null, absent or non-object body leaves the id empty for the service to refuse.
  parse: (raw) => ok({ value: { principalId: principalIdParam(raw.params), policyId: String((raw.body as { policyId?: unknown } | null | undefined)?.policyId ?? "") } }),
  handle: async ({ input, deps, context }) => {
    const callerPrincipalId = userActorId({ context });
    try {
      const { attachment } = await attachPolicy({
        deps: deps.identityServices(),
        input: { workspaceId: deps.workspaceId, callerPrincipalId, principalId: input.principalId, policyId: input.policyId },
      });
      return ok({ value: { attachment } });
    } catch (err) {
      return rejectUserError({ err, rungs: USER_ATTACH_POLICY_ERRORS });
    }
  },
}, { successStatus: 201 });
