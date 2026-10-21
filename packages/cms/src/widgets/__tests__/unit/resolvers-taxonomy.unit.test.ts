import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import type { Taxonomy, TaxonomyListPort, Term, TermListPort } from "../../../taxonomy/index.js";
import type { PageHtmlEmbedRef } from "../../html/html-embeds.js";
import { resolveTaxonomyEmbeds } from "../../resolvers/index.js";

/**
 * @file `taxonomy` embed resolution — id vs. human-readable name targeting (an ambiguous name stays
 * unresolved rather than picking one), trashed/purged taxonomies and terms hidden, one term query per
 * taxonomy per page, and graceful degradation when the host wires no read ports.
 */

const T0 = "2026-01-01T00:00:00.000Z";

function taxonomy(overrides: Partial<Taxonomy> & Pick<Taxonomy, "id" | "name">): Taxonomy {
  return { hierarchical: false, status: "active", updatedAt: T0, version: 1, ...overrides };
}

function term(overrides: Partial<Term> & Pick<Term, "id" | "taxonomyId" | "name">): Term {
  return { parentId: null, status: "active", updatedAt: T0, version: 1, ...overrides };
}

function ref(id: string | null): PageHtmlEmbedRef {
  return { type: "taxonomy", id, slug: null, name: null, variant: null, header: true };
}

function ports(taxonomies: Taxonomy[], terms: Term[]) {
  const termQueries: string[] = [];
  const taxonomyRepo: TaxonomyListPort = { list: async () => taxonomies };
  const termRepo: TermListPort = {
    listByTaxonomy: async ({ taxonomyId }) => { termQueries.push(taxonomyId); return terms; },
  };
  return { taxonomyRepo, termRepo, termQueries };
}

test("without both read ports wired, nothing resolves (every marker degrades to the placeholder)", async () => {
  const { taxonomyRepo, termRepo } = ports([taxonomy({ id: "tx", name: "Topics" })], []);
  assert.equal((await resolveTaxonomyEmbeds({ refs: [ref("tx")], deps: { taxonomyRepo } })).size, 0);
  assert.equal((await resolveTaxonomyEmbeds({ refs: [ref("tx")], deps: { termRepo } })).size, 0);
  assert.equal((await resolveTaxonomyEmbeds({ refs: [ref("tx")], deps: {} })).size, 0);
});

test("a unique name resolves like an id; an ambiguous or unknown name, or a ref without an id, stays unresolved", async () => {
  const { taxonomyRepo, termRepo } = ports(
    [taxonomy({ id: "tx-topics", name: "Topics" }), taxonomy({ id: "tx-a", name: "Tags" }), taxonomy({ id: "tx-b", name: "Tags" })],
    [],
  );
  const resolved = await resolveTaxonomyEmbeds({ refs: [ref("Topics"), ref("Tags"), ref("Nope"), ref(null)], deps: { taxonomyRepo, termRepo } });

  assert.deepEqual([...resolved.keys()], ["Topics"]);
  assert.equal(resolved.get("Topics")!.props.id, "tx-topics");
});

test("an exact id wins over a different taxonomy that happens to be named the same string", async () => {
  const { taxonomyRepo, termRepo } = ports([taxonomy({ id: "News", name: "Press" }), taxonomy({ id: "tx-2", name: "News" })], []);
  const resolved = await resolveTaxonomyEmbeds({ refs: [ref("News")], deps: { taxonomyRepo, termRepo } });

  assert.equal(resolved.get("News")!.props.name, "Press");
});

test("trashed and purged taxonomies cannot be targeted, and their terms' trashed/purged rows are hidden", async () => {
  const { taxonomyRepo, termRepo } = ports(
    [taxonomy({ id: "tx-live", name: "Live" }), taxonomy({ id: "tx-trash", name: "Old", status: "trash" }), taxonomy({ id: "tx-gone", name: "Gone", status: "purged" })],
    [
      term({ id: "t1", taxonomyId: "tx-live", name: "Kept" }),
      term({ id: "t2", taxonomyId: "tx-live", name: "Trashed", status: "trash" }),
      term({ id: "t3", taxonomyId: "tx-live", name: "Purged", status: "purged" }),
      term({ id: "t4", taxonomyId: "tx-other", name: "Foreign" }),
      term({ id: "t5", taxonomyId: "tx-live", name: "Child", parentId: "t1" }),
    ],
  );
  const resolved = await resolveTaxonomyEmbeds({ refs: [ref("tx-live"), ref("tx-trash"), ref("Gone")], deps: { taxonomyRepo, termRepo } });

  assert.deepEqual([...resolved.keys()], ["tx-live"]);
  assert.deepEqual(resolved.get("tx-live"), {
    componentId: "taxonomy-list",
    props: { id: "tx-live", name: "Live", hierarchical: false, terms: [{ id: "t1", name: "Kept", parentId: null }, { id: "t5", name: "Child", parentId: "t1" }] },
  });
});

test("two markers naming the same taxonomy (by id and by name) share one term query", async () => {
  const { taxonomyRepo, termRepo, termQueries } = ports([taxonomy({ id: "tx-1", name: "Topics" })], [term({ id: "t1", taxonomyId: "tx-1", name: "News" })]);
  const resolved = await resolveTaxonomyEmbeds({ refs: [ref("tx-1"), ref("Topics")], deps: { taxonomyRepo, termRepo } });

  assert.deepEqual(termQueries, ["tx-1"]);
  assert.deepEqual(resolved.get("tx-1"), resolved.get("Topics"));
});
