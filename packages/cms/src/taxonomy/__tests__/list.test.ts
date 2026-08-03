import assert from "node:assert/strict";
import { test } from "vitest";

import { listTaxonomiesWithTerms } from "../list.js";
import type { Taxonomy, Term } from "../write-service.js";

/**
 * @file design-spec.md §2.8 backend-gap closure — `listTaxonomiesWithTerms` (this dispatch).
 */

function taxonomy(overrides: Partial<Taxonomy> = {}): Taxonomy {
  return { id: "tax-1", name: "category", hierarchical: true, status: "active", updatedAt: "2026-07-15T00:00:00.000Z", version: 1, ...overrides };
}

function term(overrides: Partial<Term> = {}): Term {
  return { id: "term-1", taxonomyId: "tax-1", parentId: null, name: "Food", status: "active", updatedAt: "2026-07-15T00:00:00.000Z", version: 1, ...overrides };
}

test("listTaxonomiesWithTerms: pairs each taxonomy with only its own terms", async () => {
  const taxonomies = { list: async () => [taxonomy({ id: "tax-1" }), taxonomy({ id: "tax-2", name: "tag", hierarchical: false })] };
  const terms = {
    listByTaxonomy: async ({ taxonomyId }: { taxonomyId: string }) =>
      [term({ id: "t1", taxonomyId: "tax-1" }), term({ id: "t2", taxonomyId: "tax-2" })].filter((t) => t.taxonomyId === taxonomyId),
  };

  const result = await listTaxonomiesWithTerms({ taxonomies, terms });

  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.find((i) => i.taxonomy.id === "tax-1")?.terms.map((t) => t.id),
    ["t1"]
  );
  assert.deepEqual(
    result.items.find((i) => i.taxonomy.id === "tax-2")?.terms.map((t) => t.id),
    ["t2"]
  );
});

test("listTaxonomiesWithTerms: a taxonomy with zero terms yields an empty terms array, not an omitted entry", async () => {
  const taxonomies = { list: async () => [taxonomy({ id: "tax-1" })] };
  const terms = { listByTaxonomy: async () => [] as Term[] };

  const result = await listTaxonomiesWithTerms({ taxonomies, terms });

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0]?.terms, []);
});

test("listTaxonomiesWithTerms: zero taxonomies yields an empty items array", async () => {
  const taxonomies = { list: async () => [] as Taxonomy[] };
  const terms = { listByTaxonomy: async () => [] as Term[] };

  const result = await listTaxonomiesWithTerms({ taxonomies, terms });

  assert.deepEqual(result.items, []);
});
