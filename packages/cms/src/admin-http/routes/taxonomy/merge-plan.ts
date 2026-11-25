import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { planMergeTerm, type MergeableEntryTermRepoPort, type MergeTermPlanDetails } from "../../../taxonomy/index.js";
import {
  MERGE_PRINCIPAL_KIND, mergeBody, mergeFromTermId, rejectMergeError, rejectMergeValidation,
  type MergeGatewayPlanFn,
} from "./merge-shared.js";
import { taxonomyPrincipal, type TaxonomyRoutePrincipal } from "./shared.js";

/** The deps this route reads: the overlap count and the host's binding of the gateway's `plan()`. */
export interface TaxonomyMergePlanRouteDeps {
  entryTermRepo: Pick<MergeableEntryTermRepoPort, "countOverlap">;
  gatewayPlan: MergeGatewayPlanFn;
}

/** What a successful plan answers. */
export interface TaxonomyMergePlanOutput { planId: string; planHash: string; details: MergeTermPlanDetails }

/**
 * `POST /api/admin/v1/taxonomy/terms/:id/merge/plan` — step 1 of ADR-044's one gated mutation
 * (SPEC-018 C-207). `:id` is `fromTermId`; `intoTermId` is in the body. Gated by
 * `admin.taxonomy.manage` INSIDE the gateway (its `ForbiddenError` answers the 403 with the
 * gateway's reason code), so this spec never calls the host authorize port. The missing-principal
 * 500 comes before the 400 body check, exactly as the hand-written route read the session first.
 */
export const taxonomyMergePlanRoute = defineJsonRoute<{ fromTermId: string; intoTermId: string }, TaxonomyMergePlanOutput, TaxonomyMergePlanRouteDeps, TaxonomyRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/taxonomy/terms/:id/merge/plan",
  parse: (raw) => {
    const { intoTermId } = mergeBody({ raw });
    if (typeof intoTermId !== "string") rejectMergeValidation({ error: "'intoTermId' (string) is required" });
    return ok({ value: { fromTermId: mergeFromTermId({ params: raw.params }), intoTermId } });
  },
  handle: async ({ input, deps, context }) => {
    const principal = taxonomyPrincipal({ context });
    const { fromTermId, intoTermId } = input;
    try {
      const result = await planMergeTerm({
        principalId: principal.id,
        principalKind: MERGE_PRINCIPAL_KIND,
        fromTermId,
        intoTermId,
        computeOverlap: async () => ({ overlappingContentCount: await deps.entryTermRepo.countOverlap({ fromTermId, intoTermId }) }),
        gatewayPlan: () => deps.gatewayPlan({ principalId: principal.id, principalKind: MERGE_PRINCIPAL_KIND, fromTermId, intoTermId }),
      });
      return ok({ value: result });
    } catch (err) {
      return rejectMergeError({ err });
    }
  },
});
