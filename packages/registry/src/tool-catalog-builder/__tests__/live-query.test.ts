import assert from "node:assert/strict";
import { test } from "vitest";

import type { ToolCatalogQuery } from "../ports.js";

import { createLiveToolCatalogQuery } from "../query.js";

/**
 * @file `createLiveToolCatalogQuery` — the discovery-side half of federation hot-reload. See that
 * module's own header for why the host route registrar needs an object whose
 * IDENTITY never changes even though what it delegates to does.
 */

function stubCatalog(label: string): ToolCatalogQuery {
  return {
    search: ({ query }) => [{ id: `${label}:${query}`, description: label, source: "test", score: 1 }],
    describe: ({ id }) => ({ id: `${label}:${id}`, description: label, source: "test" }),
  };
}

test("query delegates to the initially-bound catalog before any rebind", () => {
  const live = createLiveToolCatalogQuery({ initial: stubCatalog("first") });
  assert.deepEqual(live.query.search({ query: "q" }), [{ id: "first:q", description: "first", source: "test", score: 1 }]);
  assert.deepEqual(live.query.describe({ id: "x" }), { id: "first:x", description: "first", source: "test" });
});

test("rebind swaps what the SAME query object delegates to — object identity never changes", () => {
  const live = createLiveToolCatalogQuery({ initial: stubCatalog("first") });
  const queryReference = live.query;

  live.rebind({ next: stubCatalog("second") });

  assert.equal(live.query, queryReference, "the object handed to registerToolCatalogRoutes must stay the same reference across a rebind");
  assert.deepEqual(live.query.search({ query: "q" }), [{ id: "second:q", description: "second", source: "test", score: 1 }]);
});

test("multiple rebinds always reflect the MOST RECENT catalog, never an earlier one", () => {
  const live = createLiveToolCatalogQuery({ initial: stubCatalog("boot") });
  live.rebind({ next: stubCatalog("reload-1") });
  live.rebind({ next: stubCatalog("reload-2") });

  assert.deepEqual(live.query.describe({ id: "x" }), { id: "reload-2:x", description: "reload-2", source: "test" });
});

test('live methods forward the full argument objects, including optional search limits and missing descriptions', () => {
  let observed: { query: string; limit: number | undefined } | undefined;
  const live = createLiveToolCatalogQuery({ initial: {
    search({ query }, optional) { observed = { query, limit: optional?.limit }; return []; },
    describe() { return null; },
  } });
  assert.deepEqual(live.query.search({ query: 'request' }, { limit: 4 }), []);
  assert.deepEqual(observed, { query: 'request', limit: 4 });
  assert.equal(live.query.describe({ id: 'missing' }), null);
});
