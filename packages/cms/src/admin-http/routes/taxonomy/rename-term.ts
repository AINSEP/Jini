import type { TransactionalRepoPort } from "@jini-ai/core/contracts/events";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { renameTerm, TermRecordNotFoundError, type TaxonomyRepoPort, type Term } from "../../../taxonomy/index.js";
import {
  FORBIDDEN_REFUSAL,
  postContentTargets,
  rejectTaxonomyError,
  taxonomyPrincipal,
  taxonomyWriteServiceDeps,
  type TaxonomyRoutePrincipal,
  type TaxonomyWriteRouteDeps,
} from "./shared.js";

/** The deps this route reads: the write deps, with a taxonomy repo that also opens the shared
 *  transaction the rename runs in. */
export interface TaxonomyRenameTermRouteDeps extends TaxonomyWriteRouteDeps {
  taxonomyRepo: TaxonomyRepoPort & TransactionalRepoPort;
}

/** The term to rename and its new name. */
export interface TaxonomyRenameTermInput { termId: string; newName: string }

/**
 * @file design-spec.md §2.3/§2.8 — `PUT /api/admin/v1/taxonomy/terms/:id` (renames a term,
 * AC-15/AC-19/AC-25). Gated by `admin.taxonomy.manage`.
 */
export const taxonomyRenameTermRoute = defineJsonRoute<TaxonomyRenameTermInput, { term: Term }, TaxonomyRenameTermRouteDeps, TaxonomyRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/taxonomy/terms/:id",
  parse: (raw) => {
    const { newName } = (raw.body ?? {}) as Record<string, unknown>;
    if (typeof newName !== "string") rejectRoute({ status: 400, error: "'newName' (string) is required", code: "VALIDATION_ERROR" });
    return ok({ value: { termId: String(raw.params.id), newName } });
  },
  handle: async ({ input, deps, context }) => {
    const principal = taxonomyPrincipal({ context });
    try {
      const term = await renameTerm({
        deps: {
          ...taxonomyWriteServiceDeps({ deps, contentTargets: postContentTargets({ deps }) }),
          transaction: (required) => deps.taxonomyRepo.transaction(required),
        },
        principalId: principal.id,
        termId: input.termId,
        newName: input.newName,
      });
      return ok({ value: { term } });
    } catch (err) {
      return rejectTaxonomyError({ err, refusals: [FORBIDDEN_REFUSAL, { classes: [TermRecordNotFoundError], status: 404, code: "TERM_NOT_FOUND" }] });
    }
  },
});
