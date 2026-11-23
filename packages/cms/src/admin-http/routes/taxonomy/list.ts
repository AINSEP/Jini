import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { listTaxonomiesWithTerms, type TaxonomyListPort, type TaxonomyWithTerms, type TermListPort } from "../../../taxonomy/index.js";
import { authorizeTaxonomyManage, type TaxonomyRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface TaxonomyListRouteDeps {
  taxonomyRepo: TaxonomyListPort;
  termRepo: TermListPort;
}

/**
 * @file design-spec.md §2.2/§2.8 — `GET /api/admin/v1/taxonomy` (Categories & Tags' two-pane
 * source, ADR-044). Gated by `admin.taxonomy.manage` — ADR-044 registers exactly one permission
 * for this whole domain (no `.read`/`.write` split), so this list route reuses it rather than
 * inventing an unratified `admin.taxonomy.read` string.
 */
export const taxonomyListRoute = defineJsonRoute<Record<string, never>, { items: TaxonomyWithTerms[] }, TaxonomyListRouteDeps, TaxonomyRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/taxonomy",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeTaxonomyManage({ authorize, entityType: "taxonomy" });
    return ok({ value: await listTaxonomiesWithTerms({ taxonomies: deps.taxonomyRepo, terms: deps.termRepo }) });
  },
});
