import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { createTaxonomy, type Taxonomy } from "../../../taxonomy/index.js";
import {
  FORBIDDEN_REFUSAL,
  postContentTargets,
  rejectTaxonomyError,
  taxonomyPrincipal,
  taxonomyWriteServiceDeps,
  type TaxonomyRoutePrincipal,
  type TaxonomyWriteRouteDeps,
} from "./shared.js";

/** The deps this route reads. */
export type TaxonomyCreateRouteDeps = TaxonomyWriteRouteDeps;

/** The validated create body. */
export interface TaxonomyCreateInput { name: string; hierarchical: boolean }

/**
 * @file design-spec.md §2.3/§2.8 — `POST /api/admin/v1/taxonomy` (creates a taxonomy, AC-01/
 * AC-26). Gated by `admin.taxonomy.manage`.
 */
export const taxonomyCreateRoute = defineJsonRoute<TaxonomyCreateInput, { taxonomy: Taxonomy }, TaxonomyCreateRouteDeps, TaxonomyRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/taxonomy",
  parse: (raw) => {
    const { name, hierarchical } = (raw.body ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || typeof hierarchical !== "boolean") {
      rejectRoute({ status: 400, error: "'name' (string) and 'hierarchical' (boolean) are required", code: "VALIDATION_ERROR" });
    }
    return ok({ value: { name, hierarchical } });
  },
  handle: async ({ input, deps, context }) => {
    const principal = taxonomyPrincipal({ context });
    try {
      const taxonomy = await createTaxonomy({
        deps: taxonomyWriteServiceDeps({ deps, contentTargets: postContentTargets({ deps }) }),
        principalId: principal.id,
        name: input.name,
        hierarchical: input.hierarchical,
      });
      return ok({ value: { taxonomy } });
    } catch (err) {
      return rejectTaxonomyError({ err, refusals: [FORBIDDEN_REFUSAL] });
    }
  },
}, { successStatus: 201 });
