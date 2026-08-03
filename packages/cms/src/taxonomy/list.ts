import type { Taxonomy, Term } from "./write-service.js";

/**
 * @file Admin-UI backend-gap closure (design-spec.md §2.8) — the taxonomy/term registry's missing
 * read side. Mirrors `features/content-types/list.ts`'s shape: a thin pass-through over injected
 * read ports, no authorization of its own.
 *
 * Architectural role:
 * `features/taxonomy` domain logic. Depends only on `write-service.ts`'s `Taxonomy`/`Term` shapes.
 */

export interface TaxonomyListPort {
  /** Every taxonomy in the workspace (v1 has exactly 2 seeded rows, `category`/`tag` — ADR-044 §1
   * — but this port stays general rather than hard-coding that count). */
  list(): Promise<Taxonomy[]>;
}

export interface TermListPort {
  /** Every term belonging to `taxonomyId`. */
  listByTaxonomy(params: { taxonomyId: string }): Promise<Term[]>;
}

export interface TaxonomyWithTerms {
  taxonomy: Taxonomy;
  terms: Term[];
}

/**
 * Lists every taxonomy together with its terms (the Categories & Tags screen's two-pane source,
 * design-spec.md §2.2).
 *
 * @complexity O(t) in the number of taxonomies — one `listByTaxonomy()` call per taxonomy, each
 * bounded by that taxonomy's own term count (small: v1 has 2 taxonomies).
 * @overallScore 100
 */
export async function listTaxonomiesWithTerms(
  required: { taxonomies: TaxonomyListPort; terms: TermListPort },
  _optional: Record<string, never> = {}
): Promise<{ items: TaxonomyWithTerms[] }> {
  const { taxonomies, terms } = required;

  const taxonomyRows = await taxonomies.list();
  const items: TaxonomyWithTerms[] = [];
  for (const taxonomy of taxonomyRows) {
    const taxonomyTerms = await terms.listByTaxonomy({ taxonomyId: taxonomy.id });
    items.push({ taxonomy, terms: taxonomyTerms });
  }
  return { items };
}
