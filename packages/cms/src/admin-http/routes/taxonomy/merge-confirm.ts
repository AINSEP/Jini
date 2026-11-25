import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { confirmMergeTerm } from "../../../taxonomy/index.js";
import { MERGE_PRINCIPAL_KIND, mergeBody, rejectMergeError, rejectMergeValidation, type MergeGatewayConfirmFn } from "./merge-shared.js";
import { taxonomyPrincipal, type TaxonomyRoutePrincipal } from "./shared.js";

/** The deps this route reads: the host's binding of the gateway's `confirm()`. */
export interface TaxonomyMergeConfirmRouteDeps {
  gatewayConfirm: MergeGatewayConfirmFn;
}

/** What a successful confirm answers. */
export interface TaxonomyMergeConfirmOutput { confirmationToken: string }

/**
 * `POST /api/admin/v1/taxonomy/terms/:id/merge/confirm` — step 2 of the merge ceremony. `:id` is
 * not read (the plan id and hash identify the plan). Gated inside the gateway, never through the
 * host authorize port; the principal is read before the body is checked, as the hand-written route did.
 */
export const taxonomyMergeConfirmRoute = defineJsonRoute<{ planId: string; planHash: string }, TaxonomyMergeConfirmOutput, TaxonomyMergeConfirmRouteDeps, TaxonomyRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/taxonomy/terms/:id/merge/confirm",
  parse: (raw) => {
    const { planId, planHash } = mergeBody({ raw });
    if (typeof planId !== "string" || typeof planHash !== "string") rejectMergeValidation({ error: "'planId' and 'planHash' (strings) are required" });
    return ok({ value: { planId, planHash } });
  },
  handle: async ({ input, deps, context }) => {
    const principal = taxonomyPrincipal({ context });
    try {
      const { token } = await confirmMergeTerm({
        principalId: principal.id,
        principalKind: MERGE_PRINCIPAL_KIND,
        planId: input.planId,
        planHash: input.planHash,
        gatewayConfirm: (params) => deps.gatewayConfirm({ principalId: principal.id, principalKind: MERGE_PRINCIPAL_KIND, planId: params.planId, planHash: params.planHash }),
      });
      return ok({ value: { confirmationToken: token } });
    } catch (err) {
      return rejectMergeError({ err });
    }
  },
});
