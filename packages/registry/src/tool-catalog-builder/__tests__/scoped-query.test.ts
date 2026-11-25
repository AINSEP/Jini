import assert from "node:assert/strict";
import { test } from "vitest";

import type { ToolCatalogEntry, ToolCatalogHit, ToolCatalogQuery } from "../ports.js";
import {
  createScopedToolCatalog,
  type ScopedToolCatalogCache,
  type ScopedToolCatalogResult,
  type ToolCatalogScope,
} from "../scoped-query.js";

/**
 * @file `createScopedToolCatalog` — one shared, identity-neutral index served per principal: the
 * scope (workspace, principal, permission version, registry revision, allowed tools) decides what
 * a request may discover, cached results never cross scopes, and an entity discriminator enum is
 * projected onto a cloned schema per tool and principal.
 */

interface FakeRequest { readonly scope: ToolCatalogScope | null }

const ENTITY_SCHEMA = {
  type: "object",
  properties: { entityType: { type: "string", enum: ["page", "post", "media"] }, entityId: { type: "string" } },
  required: ["entityType", "entityId"],
} as const;

/** Shared index over three tools; `restore` carries the entity discriminator. Counts every call. */
function fakeCatalog(): { catalog: ToolCatalogQuery; calls: () => number; schema: typeof ENTITY_SCHEMA } {
  let calls = 0;
  const schema = structuredClone(ENTITY_SCHEMA);
  const entries: ToolCatalogEntry[] = [
    { id: "hidden_a", source: "test", description: "hidden a" },
    { id: "hidden_b", source: "test", description: "hidden b" },
    { id: "list", source: "test", description: "list things" },
    { id: "restore", source: "test", description: "restore things", inputSchema: schema },
  ];
  return {
    schema,
    calls: () => calls,
    catalog: {
      search: ({ query }, { limit = 10 } = {}) => {
        calls += 1;
        return entries.slice(0, limit).map((entry, index): ToolCatalogHit => ({
          ...entry, score: entries.length - index, description: `${entry.description} (${query})`,
          signature: entry.id === "restore" ? 'entityType: "page"|"post"|"media", entityId: string' : "",
        }));
      },
      describe: ({ id }) => {
        calls += 1;
        return entries.find(entry => entry.id === id) ?? null;
      },
    },
  };
}

function mapCache(): ScopedToolCatalogCache & { readonly writes: () => number } {
  const store = new Map<string, ScopedToolCatalogResult>();
  let writes = 0;
  return {
    get: ({ key }) => store.get(key),
    set: ({ key, value }) => { writes += 1; store.set(key, value); },
    writes: () => writes,
  };
}

function scope(overrides: Partial<ToolCatalogScope> & { allowed: readonly string[] }): ToolCatalogScope {
  const { allowed, ...rest } = overrides;
  return { workspaceId: "ws-1", principalId: "p-1", permissionVersion: "v1", registryRevision: 1, allowedToolIds: new Set(allowed), ...rest };
}

function scoped(required: { catalog: ToolCatalogQuery; types?: Record<string, readonly string[]> }, optional: { cache?: ScopedToolCatalogCache } = {}) {
  return createScopedToolCatalog<FakeRequest>({
    catalog: required.catalog,
    resolveScope: ({ request }) => request.scope,
    entityTypesFor: ({ toolId, scope: current }) => (toolId === "restore"
      ? { property: "entityType", types: required.types?.[current.principalId] ?? [] }
      : undefined),
  }, optional);
}

const ids = (hits: readonly ToolCatalogHit[]): string[] => hits.map(hit => hit.id);

test("permission change invalidates the same principal's discovery view", async () => {
  const { catalog } = fakeCatalog();
  const cache = mapCache();
  const discovery = scoped({ catalog, types: { "p-1": ["page"] } }, { cache });
  const before = await discovery.catalogFor({ request: { scope: scope({ allowed: ["list", "restore"] }) } });
  assert.deepEqual(ids(before.search({ query: "things" }, { limit: 5 })), ["list", "restore"]);

  const after = await discovery.catalogFor({ request: { scope: scope({ allowed: ["list"], permissionVersion: "v2" }) } });
  assert.deepEqual(ids(after.search({ query: "things" }, { limit: 5 })), ["list"]);
  assert.equal(after.describe({ id: "restore" }), null);

  // A host that cannot name a current permission version is scoped anew and never cached.
  const writesBefore = cache.writes();
  const { permissionVersion: _omitted, ...unversioned } = scope({ allowed: ["list"] });
  const fresh = await discovery.catalogFor({ request: { scope: unversioned } });
  fresh.search({ query: "things" }, { limit: 5 });
  fresh.describe({ id: "list" });
  assert.equal(cache.writes(), writesBefore);
});

test("same principal id in a different workspace never shares a scoped result", async () => {
  const { catalog } = fakeCatalog();
  const cache = mapCache();
  const discovery = scoped({ catalog, types: { "p-1": ["post"] } }, { cache });
  const first = await discovery.catalogFor({ request: { scope: scope({ allowed: ["list"] }) } });
  assert.deepEqual(ids(first.search({ query: "q" })), ["list"]);
  assert.equal(first.describe({ id: "restore" }), null);

  const other = await discovery.catalogFor({ request: { scope: scope({ allowed: ["restore"], workspaceId: "ws-2" }) } });
  assert.deepEqual(ids(other.search({ query: "q" })), ["restore"]);
  assert.equal(other.describe({ id: "restore" })?.id, "restore");
});

test("one principal's entity enum never mutates another principal's schema", async () => {
  const { catalog, schema } = fakeCatalog();
  const discovery = scoped({ catalog, types: { "p-1": ["page"], "p-2": ["post", "media", "comment"] } });
  const allowed = ["list", "restore"];
  const one = await discovery.catalogFor({ request: { scope: scope({ allowed }) } });
  const two = await discovery.catalogFor({ request: { scope: scope({ allowed, principalId: "p-2" }) } });
  const none = await discovery.catalogFor({ request: { scope: scope({ allowed, principalId: "p-3" }) } });

  const firstSchema = one.describe({ id: "restore" })?.inputSchema;
  const secondSchema = two.describe({ id: "restore" })?.inputSchema;
  assert.deepEqual(firstSchema, { ...ENTITY_SCHEMA, properties: { ...ENTITY_SCHEMA.properties, entityType: { type: "string", enum: ["page"] } } });
  // Projection narrows the declared enum; a permitted type the schema never declared is not added.
  assert.deepEqual(secondSchema, { ...ENTITY_SCHEMA, properties: { ...ENTITY_SCHEMA.properties, entityType: { type: "string", enum: ["post", "media"] } } });
  assert.deepEqual(schema, ENTITY_SCHEMA);
  assert.notEqual(firstSchema, schema);

  const [hit] = one.search({ query: "restore" }).filter(entry => entry.id === "restore");
  assert.equal(hit?.signature, 'entityType: "page", entityId: string');

  // No permitted entity type is no offer at all, never an unconstrained string.
  assert.equal(none.describe({ id: "restore" }), null);
  assert.deepEqual(ids(none.search({ query: "q" })), ["list"]);
});

test("unknown scope returns nothing without touching the global view", async () => {
  const { catalog, calls } = fakeCatalog();
  const discovery = scoped({ catalog }, { cache: mapCache() });
  const view = await discovery.catalogFor({ request: { scope: null } });
  assert.deepEqual(view.search({ query: "list" }), []);
  assert.equal(view.describe({ id: "list" }), null);
  assert.equal(calls(), 0);
});

test("hidden tools ranked first do not starve the requested limit", async () => {
  const { catalog } = fakeCatalog();
  const discovery = scoped({ catalog, types: { "p-1": ["page"] } });
  const view = await discovery.catalogFor({ request: { scope: scope({ allowed: ["list", "restore"] }) } });
  assert.deepEqual(ids(view.search({ query: "q" }, { limit: 2 })), ["list", "restore"]);
  assert.deepEqual(ids(view.search({ query: "q" }, { limit: 1 })), ["list"]);
  assert.deepEqual(view.search({ query: "q" }, { limit: 0 }), []);
  assert.throws(() => view.search({ query: "q" }, { limit: -1 }), RangeError);
});

test("equivalent queries share one cached result within a scope", async () => {
  const { catalog, calls } = fakeCatalog();
  const cache = mapCache();
  const discovery = scoped({ catalog }, { cache });
  const view = await discovery.catalogFor({ request: { scope: scope({ allowed: ["list"] }) } });
  const first = view.search({ query: "  list   things " }, { limit: 3 });
  const callsAfterFirst = calls();
  assert.deepEqual(view.search({ query: "list things" }, { limit: 3 }), first);
  assert.equal(calls(), callsAfterFirst);
});
