import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { executeMergeTerm } from "../../../taxonomy/index.js";
import {
  MERGE_PRINCIPAL_KIND, mergeBody, mergeFromTermId, rejectMergeError, rejectMergeValidation,
  type MergeGatewayExecuteFn,
} from "./merge-shared.js";
import { taxonomyPrincipal, type TaxonomyRoutePrincipal } from "./shared.js";

/** The deps this route reads: the host's binding of the gateway's `execute()`. */
export interface TaxonomyMergeExecuteRouteDeps {
  gatewayExecute: MergeGatewayExecuteFn;
}

/** What a successful execute answers. */
export interface TaxonomyMergeExecuteOutput { mergedCount: number }

/**
 * `POST /api/admin/v1/taxonomy/terms/:id/merge/execute` — step 3 of the merge ceremony. `:id` is
 * `fromTermId`; `intoTermId` and the confirmation token are in the body. Merge stays a hard delete
 * (trash parallel plan, owner decision 5): the host's hooks repoint `intoTermId`'s content and
 * deprecate `fromTermId` outright. Gated inside the gateway, never through the host authorize port.
 */
export const taxonomyMergeExecuteRoute = defineJsonRoute<{ fromTermId: string; intoTermId: string; confirmationToken: string }, TaxonomyMergeExecuteOutput, TaxonomyMergeExecuteRouteDeps, TaxonomyRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/taxonomy/terms/:id/merge/execute",
  parse: (raw) => {
    const { intoTermId, confirmationToken } = mergeBody({ raw });
    if (typeof intoTermId !== "string" || typeof confirmationToken !== "string") {
      rejectMergeValidation({ error: "'intoTermId' and 'confirmationToken' (strings) are required" });
    }
    return ok({ value: { fromTermId: mergeFromTermId({ params: raw.params }), intoTermId, confirmationToken } });
  },
  handle: async ({ input, deps, context }) => {
    const principal = taxonomyPrincipal({ context });
    try {
      const result = await executeMergeTerm({
        confirmationToken: input.confirmationToken,
        gatewayExecute: (params) => deps.gatewayExecute({
          principalId: principal.id, principalKind: MERGE_PRINCIPAL_KIND, fromTermId: input.fromTermId, intoTermId: input.intoTermId,
          confirmationToken: params.confirmationToken,
        }),
      });
      return ok({ value: result });
    } catch (err) {
      return rejectMergeError({ err });
    }
  },
});
