import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";

import { InMemoryPostRepo, type PostRecord } from "./support/post.fixture.js";
import { InMemorySettingsRepo } from "./support/legacy-api.fixture.js";
import { InMemoryAssetRenditionRepo, InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";
import { OriginNotVerifiedError, type OriginRegistryPort } from "@jini-ai/http-kit/verified-origin";
import { ensureSeoSettingDefinitions } from "./support/legacy-api.fixture.js";
import { buildSitemap, invalidateSitemapCache, regenerateSitemapCache } from "./support/legacy-api.fixture.js";
import { buildPostRecord } from "./support/post.fixture.js";

/**
 * @file T035 — failing-first unit certification of `regenerateSitemapCache`/
 * `invalidateSitemapCache` (REQ-13, AC-27, INV-08, EC-08): force-rebuild
 * bypassing a cache hit; idempotent invalidation (repeat call on an
 * already-clear key is a no-op); two concurrent regenerate calls converge to
 * one final value; two workspaces get independent cache entries.
 */

const WORKSPACE_A = "workspace-cache-a";
const WORKSPACE_B = "workspace-cache-b";
const clock = { nowIso: () => "2026-07-13T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `cache-test-id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

function post(workspaceId: string, overrides: Partial<PostRecord> = {}): PostRecord {
  return buildPostRecord({
    id: "a",
    workspaceId,
    title: "Post",
    slug: "post",
    bodyJson: { type: "doc", content: [] },
    status: "published",
    kind: "post",
    updatedAt: "2026-07-13T00:00:00.000Z",
    version: 1,
    seoExtJson: null,
    ...overrides,
  });
}

/** No verified origin registered — mirrors `seo.test.ts`'s own copy of this fake. */
function fakeOriginRegistry(): OriginRegistryPort {
  return {
    async canonicalOrigin() {
      throw new OriginNotVerifiedError({ message: "no verified origin registered for this workspace" });
    },
    async isAllowedRedirectTarget() {
      return false;
    },
    async isAllowedEgressTarget() {
      return false;
    },
  };
}

async function makeDeps(workspaceId: string, posts: PostRecord[]) {
  invalidateSitemapCache({ workspaceId });
  const postRepo = new InMemoryPostRepo(posts);
  const settingsRepo = new InMemorySettingsRepo();
  const settingsDeps = { settingsRepo, clock, ids, authorize: alwaysAllow, principals: { findById: async () => null } as never };
  await ensureSeoSettingDefinitions(settingsDeps, { workspaceId, systemPrincipalId: "system-seo" });

  return {
    postRepo,
    settingsRepo,
    media: {
      mediaRepo: new InMemoryMediaRepo({}, { initialRows: [] }),
      assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [] }),
      transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }),
    },
    originRegistry: fakeOriginRegistry(),
  };
}

test("invalidateSitemapCache: a repeat call on an already-clear key is a no-op, never an error", () => {
  assert.doesNotThrow(() => invalidateSitemapCache({ workspaceId: WORKSPACE_A }));
  assert.doesNotThrow(() => invalidateSitemapCache({ workspaceId: WORKSPACE_A }));
});

test("regenerateSitemapCache: force-rebuilds bypassing a cache hit", async () => {
  const deps = await makeDeps(WORKSPACE_A, [post(WORKSPACE_A, { slug: "first" })]);
  const first = await buildSitemap(deps, { workspaceId: WORKSPACE_A });
  assert.equal(first.length, 1);

  // Mutate the underlying data directly (bypassing any write chokepoint) to prove regenerate
  // actually re-queries rather than returning the stale cached value.
  await deps.postRepo.save({ ...post(WORKSPACE_A, { slug: "first" }), id: "b", slug: "second" });
  assert.deepEqual(await buildSitemap(deps, { workspaceId: WORKSPACE_A }), [{ loc: "/first", lastmod: "2026-07-13T00:00:00.000Z" }]);
  await regenerateSitemapCache(deps, { workspaceId: WORKSPACE_A });

  const after = await buildSitemap(deps, { workspaceId: WORKSPACE_A });
  assert.deepEqual(after, [{ loc: "/first", lastmod: "2026-07-13T00:00:00.000Z" }, { loc: "/second", lastmod: "2026-07-13T00:00:00.000Z" }]);
  await deps.postRepo.save(post(WORKSPACE_A, { id: "c", slug: "third" }));
  assert.deepEqual(await buildSitemap(deps, { workspaceId: WORKSPACE_A }), after);
  invalidateSitemapCache({ workspaceId: WORKSPACE_A });
  invalidateSitemapCache({ workspaceId: WORKSPACE_A });
  assert.deepEqual(await buildSitemap(deps, { workspaceId: WORKSPACE_A }), [
    ...after, { loc: "/third", lastmod: "2026-07-13T00:00:00.000Z" },
  ]);
});

test("regenerateSitemapCache: two concurrent regenerate calls converge to one final value, no error", async () => {
  const deps = await makeDeps(WORKSPACE_A, [post(WORKSPACE_A)]);

  await Promise.all([
    regenerateSitemapCache(deps, { workspaceId: WORKSPACE_A }),
    regenerateSitemapCache(deps, { workspaceId: WORKSPACE_A }),
  ]);

  const entries = await buildSitemap(deps, { workspaceId: WORKSPACE_A });
  assert.equal(entries.length, 1);
});

test("INV-08: two different workspaceIds produce two independent cache entries", async () => {
  const depsA = await makeDeps(WORKSPACE_A, [post(WORKSPACE_A, { slug: "a-only" })]);
  const depsB = await makeDeps(WORKSPACE_B, [post(WORKSPACE_B, { slug: "b-only" }), post(WORKSPACE_B, { id: "b2", slug: "b-only-2" })]);

  const entriesA = await buildSitemap(depsA, { workspaceId: WORKSPACE_A });
  const entriesB = await buildSitemap(depsB, { workspaceId: WORKSPACE_B });

  assert.equal(entriesA.length, 1);
  assert.equal(entriesB.length, 2);
});


test("a slow older rebuild cannot overwrite a newer completed rebuild", async () => {
  const older = await makeDeps(WORKSPACE_A, [post(WORKSPACE_A, { slug: "old" })]);
  const newer = await makeDeps(WORKSPACE_A, [post(WORKSPACE_A, { slug: "new" })]);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const list = older.postRepo.list.bind(older.postRepo);
  older.postRepo.list = async (input) => { await held; return list(input); };
  const pending = regenerateSitemapCache(older, { workspaceId: WORKSPACE_A });
  try {
    await regenerateSitemapCache(newer, { workspaceId: WORKSPACE_A });
    assert.deepEqual(await buildSitemap(newer, { workspaceId: WORKSPACE_A }), [{ loc: "/new", lastmod: "2026-07-13T00:00:00.000Z" }]);
  } finally {
    release();
    await pending;
  }
  assert.deepEqual(await buildSitemap(newer, { workspaceId: WORKSPACE_A }), [{ loc: "/new", lastmod: "2026-07-13T00:00:00.000Z" }]);
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
