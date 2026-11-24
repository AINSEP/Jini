import assert from "node:assert/strict";
import { test } from "vitest";
import { createToolRegistrationScope, createToolRegistry } from "@jini-ai/core";

import type { ToolCatalogQuery } from "../ports.js";
import { createRefreshingToolCatalogQuery } from "../query.js";

/**
 * @file `createRefreshingToolCatalogQuery` — reseeds the disposable discovery snapshot only when
 * the registry's revision moves, so a revocable scope's add/remove is discoverable while an
 * unchanged registry never pays for a reseed.
 */

function stubSnapshot(label: string): { query: ToolCatalogQuery; label: string } {
  return {
    label,
    query: {
      search: ({ query }, { limit = 10 } = {}) => [{ id: `${label}:${query}:${limit}`, description: label, source: "test", score: 1 }],
      describe: ({ id }) => ({ id: `${label}:${id}`, description: label, source: "test" }),
    },
  };
}

function countingSeed() {
  let seeds = 0;
  return { seed: () => stubSnapshot(`seed-${++seeds}`), count: () => seeds };
}

test("seeds once at construction and never again while the revision is unchanged", () => {
  const registry = createToolRegistry();
  const seeding = countingSeed();
  const catalog = createRefreshingToolCatalogQuery({ seed: seeding.seed, registry });
  assert.deepEqual(catalog.search({ query: "q" }, { limit: 3 }), [{ id: "seed-1:q:3", description: "seed-1", source: "test", score: 1 }]);
  assert.deepEqual(catalog.describe({ id: "x" }), { id: "seed-1:x", description: "seed-1", source: "test" });
  assert.equal(catalog.current().label, "seed-1");
  assert.equal(seeding.count(), 1);
});

test("a scope replacement advances the revision, so the next request reseeds exactly once", () => {
  const registry = createToolRegistry();
  const seeding = countingSeed();
  const catalog = createRefreshingToolCatalogQuery({ seed: seeding.seed, registry });
  const scope = createToolRegistrationScope({ registry });
  scope.replace({ registrations: [{
    descriptor: { id: "scoped_tool", description: "scoped", inputSchema: { type: "object" }, readOnly: true },
    handler: async () => ({ ok: true }),
    policy: { authorize: () => ({ allowed: true }) },
  } as never] });
  assert.equal(catalog.current().label, "seed-2");
  assert.equal(catalog.describe({ id: "y" })?.id, "seed-2:y");
  assert.equal(seeding.count(), 2);
});

test("a registry without a revision (not a core registry) stays a plain snapshot", () => {
  const seeding = countingSeed();
  const catalog = createRefreshingToolCatalogQuery({ seed: seeding.seed, registry: { list: () => [] } });
  catalog.search({ query: "a" });
  catalog.describe({ id: "b" });
  assert.equal(catalog.current().label, "seed-1");
  assert.equal(seeding.count(), 1);
});
