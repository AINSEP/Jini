/**
 * Registry-mechanics contract tests: `register`/`list`/`reset`, replace-by-key on double
 * registration, and (the property that makes this the SAFE registry shape rather than the
 * append-only/read-once one — the trap `type-registry.ts`'s header names) `list()` must be a FRESH
 * read every call, so a contributor registered after an earlier `list()` call is still seen by a
 * later one.
 *
 * Deliberately does NOT test any real contributor's pack/inspect/precheck/apply behavior — this
 * file only proves the registry itself.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";

import {
  createPublishContentTypeRegistry,
  PublishContentCatalogConfigurationError,
  type PublishContentDeps,
  type PublishContentContributor,
  type PublishContentHandler,
  type PublishContentTypeRegistry,
} from "../type-registry.js";

type Deps = PublishContentDeps<unknown>;

/** A trivial contributor for exercising the registry mechanism itself, independent of any real
 *  domain's business logic — mirrors the tool-contribution registry tests' `fakeContributor`. */
function fakeContributor(entityType: string, dependsOn: readonly string[] = []): PublishContentContributor<unknown> {
  const handler: PublishContentHandler = {
    entityType,
    schemaVersion: 1,
    permission: "content.write",
    dependsOn,
    pack: async function* () {},
    inspect: async () => null,
    precheck: async () => null,
    apply: async () => ({ changeSetId: `fake-${entityType}` }),
  };
  return { entityType, dependsOn, build: () => handler };
}

let registry: PublishContentTypeRegistry<unknown>;
beforeEach(() => {
  registry = createPublishContentTypeRegistry<unknown>();
});

// ---------------------------------------------------------------------------
// 1. Registry mechanics — register/list/reset, fresh-read, replace-by-key idempotency
// ---------------------------------------------------------------------------

test("a freshly reset registry has no contributors", () => {
  assert.deepEqual(registry.list(), []);
});

test("register appends in call order", () => {
  registry.register({ contributor: fakeContributor("post") });
  registry.register({ contributor: fakeContributor("page") });
  assert.deepEqual(registry.list().map((c) => c.entityType), ["post", "page"]);
});

test("a contributor registered AFTER the first list() call is seen by a SECOND list() call — fresh read, never cached", () => {
  registry.register({ contributor: fakeContributor("post") });
  const first = registry.list();
  assert.deepEqual(first.map((c) => c.entityType), ["post"]);

  // Registered after `first` was already read out — a SECOND, later call must see it. (Whether
  // `first`'s own array reference also reflects it is deliberately unspecified — like its sibling
  // registries, `registry.list()` promises a correct fresh read on every call,
  // not defensive-copy isolation between calls.)
  registry.register({ contributor: fakeContributor("page") });
  const second = registry.list();
  assert.deepEqual(second.map((c) => c.entityType), ["post", "page"]);
});

test("re-registering the same entityType REPLACES the earlier entry in place, not appends", () => {
  registry.register({ contributor: fakeContributor("post") });
  registry.register({ contributor: fakeContributor("page") });
  const replacement = fakeContributor("post");
  registry.register({ contributor: replacement }); // replaces "post", position preserved

  const contributors = registry.list();
  assert.deepEqual(contributors.map((c) => c.entityType), ["post", "page"], "entityType count/order must not change on replacement");
  assert.equal(contributors[0], replacement, "the replaced entry must be the NEW registration, not the old one");
});

test("catalog rebuild includes contributors registered after the first build", () => {
  const deps = {} as Deps;
  registry.register({ contributor: fakeContributor("post") });
  const first = registry.buildCatalog(deps);
  assert.deepEqual(first.applyOrder, ["post"]);

  registry.register({ contributor: fakeContributor("page", ["post"]) });
  const second = registry.buildCatalog(deps);
  assert.deepEqual(second.handlers.map((handler) => handler.entityType), ["post", "page"]);
  assert.equal(second.handlerByType.get("post"), second.handlers[0]);
  assert.equal(second.handlerByType.get("page"), second.handlers[1]);
  assert.deepEqual(second.applyOrder, ["post", "page"]);
});

test("reset clears every registration", () => {
  registry.register({ contributor: fakeContributor("post") });
  registry.register({ contributor: fakeContributor("page") });
  assert.equal(registry.list().length, 2);

  registry.reset();

  assert.deepEqual(registry.list(), []);
});

test("buildCatalog rejects a dependency on an unregistered type before building handlers", () => {
  let buildCalls = 0;
  const contributor = fakeContributor("post", ["media"]);
  registry.register({ contributor: { ...contributor, build: (deps) => (buildCalls++, contributor.build(deps)) } });

  assert.throws(
    () => registry.buildCatalog({} as Deps),
    (error: unknown) =>
      error instanceof PublishContentCatalogConfigurationError &&
      error.message === "publish-content type 'post' depends on unregistered type 'media'"
  );
  assert.equal(buildCalls, 0, "invalid ordering must fail before any handler is built");
});

test("buildCatalog rejects dependency cycles instead of inventing an apply order", () => {
  registry.register({ contributor: fakeContributor("a", ["b"]) });
  registry.register({ contributor: fakeContributor("b", ["a"]) });

  assert.throws(
    () => registry.buildCatalog({} as Deps),
    (error: unknown) =>
      error instanceof PublishContentCatalogConfigurationError &&
      error.message === "publish-content dependency cycle among registered types: a, b"
  );
});

test("buildCatalog derives deterministic apply order without reordering handlers", () => {
  registry.register({ contributor: fakeContributor("post", ["media"]) });
  registry.register({ contributor: fakeContributor("media") });

  const catalog = registry.buildCatalog({} as Deps);

  assert.deepEqual(catalog.applyOrder, ["media", "post"]);
  assert.deepEqual(catalog.handlers.map((handler) => handler.entityType), ["post", "media"]);
});

// ---------------------------------------------------------------------------
// The publish-type stamp a publishing grant authorizes by
// ---------------------------------------------------------------------------

test("every authorize call a built handler makes names its publish type, and a caller cannot override it", async () => {
  const seen: unknown[] = [];
  registry.register({
                                      contributor: {
      entityType: "form",
      dependsOn: [],
      build: (deps) => ({
        ...fakeContributor("form").build(deps),
        apply: async () => {
          // A domain service asks with its OWN entity type, and here even tries to name another type.
          await deps.authorize!({ principalId: "p", permission: "admin.forms.manage", workspaceId: "w", entityType: "form_definition", publishType: "post" } as never);
          return { changeSetId: "c" };
        },
      }),
    }
                                    });
  const deps = {
    workspaceId: "w",
    clock: { nowIso: () => "2026-09-26T00:00:00.000Z" },
    idGen: { newId: () => "id" },
    authorize: async (params: unknown) => {
      seen.push(params);
      return { allowed: true, reason: "test" };
    },
    ports: {},
  } as unknown as Deps;

  await registry.buildCatalog(deps).handlerByType.get("form")!.apply({} as never);

  assert.deepEqual(seen, [
    { principalId: "p", permission: "admin.forms.manage", workspaceId: "w", entityType: "form_definition", publishType: "form" },
  ]);
});

test("permissionsByType lists each type's permission plus what it also authorizes", () => {
  registry.register({ contributor: fakeContributor("post") });
  registry.register({
                                      contributor: {
      entityType: "widget",
      dependsOn: [],
      build: (deps) => ({ ...fakeContributor("widget").build(deps), permission: "widgets.update", alsoAuthorizes: ["widgets.create"] }),
    }
                                    });

  assert.deepEqual(
    [...registry.permissionsByType({ workspaceId: "w", ports: {} } as unknown as Deps)],
    [
      ["post", ["content.write"]],
      ["widget", ["widgets.update", "widgets.create"]],
    ]
  );
});

test("catalog deduplicates dependency edges and preserves stable ready-type ordering", () => {
  registry.register({ contributor: fakeContributor("last", ["first", "first"]) });
  registry.register({ contributor: fakeContributor("unrelated") });
  registry.register({ contributor: fakeContributor("first") });
  const catalog = registry.buildCatalog({} as Deps);
  assert.deepEqual(catalog.applyOrder, ["unrelated", "first", "last"]);
  assert.deepEqual(catalog.handlers.map(h => h.entityType), ["last", "unrelated", "first"]);
});

test("catalog reports every remaining cycle-dependent type before building handlers", () => {
  let builds = 0;
  for (const [type, dependencies] of [["tail", ["cycle"]], ["cycle", ["cycle"]]] as const) {
    const contributor = fakeContributor(type, dependencies);
    registry.register({ contributor: { ...contributor, build: deps => { builds++; return contributor.build(deps); } } });
  }
  assert.throws(() => registry.buildCatalog({} as Deps), { message: "publish-content dependency cycle among registered types: tail, cycle" });
  assert.equal(builds, 0);
  registry.reset();
  assert.deepEqual(registry.buildCatalog({} as Deps).applyOrder, []);
});

test("two registry instances never share registrations", () => {
  const other = createPublishContentTypeRegistry<unknown>();
  registry.register({ contributor: fakeContributor("post") });
  assert.deepEqual(other.list(), []);
  assert.deepEqual(registry.list().map((c) => c.entityType), ["post"]);
});
