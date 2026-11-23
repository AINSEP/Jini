import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import {
  TaxonomyRecordNotFoundError,
  HierarchyCycleDetectedError,
  ParentCrossTaxonomyError,
  TaxonomyNotHierarchicalError,
  TermNotFoundError,
  createTerm,
  type Term,
} from "../../../taxonomy/index.js";
import {
  FORBIDDEN_REFUSAL,
  postContentTargets,
  rejectTaxonomyError,
  taxonomyPrincipal,
  taxonomyWriteServiceDeps,
  type TaxonomyErrorRefusal,
  type TaxonomyRoutePrincipal,
  type TaxonomyWriteRouteDeps,
} from "./shared.js";

/** The deps this route reads. */
export type TaxonomyCreateTermRouteDeps = TaxonomyWriteRouteDeps;

/** The validated create-term request: the owning taxonomy, the name and an optional parent. */
export interface TaxonomyCreateTermInput { taxonomyId: string; name: string; parentId: string | null }

const CREATE_TERM_REFUSALS: readonly TaxonomyErrorRefusal[] = [
  FORBIDDEN_REFUSAL,
  { classes: [TaxonomyRecordNotFoundError], status: 404, code: "TAXONOMY_NOT_FOUND" },
  { classes: [HierarchyCycleDetectedError, ParentCrossTaxonomyError, TaxonomyNotHierarchicalError, TermNotFoundError], status: 400, code: "VALIDATION_ERROR" },
];

/**
 * @file design-spec.md §2.3/§2.8 — `POST /api/admin/v1/taxonomy/:taxonomyId/terms` (creates a
 * term, AC-03/AC-13/EC-04). Gated by `admin.taxonomy.manage`.
 */
export const taxonomyCreateTermRoute = defineJsonRoute<TaxonomyCreateTermInput, { term: Term }, TaxonomyCreateTermRouteDeps, TaxonomyRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/taxonomy/:taxonomyId/terms",
  parse: (raw) => {
    const { name, parentId } = (raw.body ?? {}) as Record<string, unknown>;
    if (typeof name !== "string") rejectRoute({ status: 400, error: "'name' (string) is required", code: "VALIDATION_ERROR" });
    return ok({ value: { taxonomyId: String(raw.params.taxonomyId), name, parentId: typeof parentId === "string" ? parentId : null } });
  },
  handle: async ({ input, deps, context }) => {
    const principal = taxonomyPrincipal({ context });
    try {
      const term = await createTerm({
        deps: taxonomyWriteServiceDeps({ deps, contentTargets: postContentTargets({ deps }) }),
        principalId: principal.id,
        taxonomyId: input.taxonomyId,
        name: input.name,
      }, {
        parentId: input.parentId,
      });
      return ok({ value: { term } });
    } catch (err) {
      return rejectTaxonomyError({ err, refusals: CREATE_TERM_REFUSALS });
    }
  },
}, { successStatus: 201 });
