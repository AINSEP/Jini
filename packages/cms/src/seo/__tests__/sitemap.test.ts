import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";

import { InMemoryPostRepo, type PostRecord } from "./support/post.fixture.js";
import { InMemorySettingsRepo } from "./support/legacy-api.fixture.js";
import { InMemoryAssetRenditionRepo, InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";
import { OriginNotVerifiedError, OriginRegistry, type OriginRegistryPort } from "@jini-ai/http-kit/verified-origin";
import { ensureSeoSettingDefinitions } from "./support/legacy-api.fixture.js";
import { buildSitemap, invalidateSitemapCache, registerSitemapCollectHook, resetSitemapCollectHooksForTests } from "./support/legacy-api.fixture.js";
import { buildPostRecord } from "./support/post.fixture.js";

/**
 * @file T033 — failing-first unit certification of `buildSitemap`
 * (INV-04/05, AC-16/17, EC-04): excludes effective-`noindex` and non-
 * `published` entries; empty workspace -> valid empty array; entries ordered
 * by keyset `id` ascending (behavior.spec.md §2.2).
 */

const WORKSPACE = "workspace-sitemap-1";
const clock = { nowIso: () => "2026-07-13T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `sitemap-test-id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

function post(overrides: Partial<PostRecord>): PostRecord {
  return buildPostRecord({
    id: "a",
    workspaceId: WORKSPACE,
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

/** Mirrors `seo.test.ts`'s own copy of this fake — `origin` undefined (the default, and every
 *  pre-existing test's implicit behavior) means no verified origin registered, which keeps every
 *  `loc` assertion below unchanged (still relative). */
function fakeOriginRegistry(origin?: import("@jini-ai/http-kit/verified-origin").VerifiedOrigin): OriginRegistryPort {
  return {
    async canonicalOrigin() {
      if (!origin) throw new OriginNotVerifiedError({ message: "no verified origin registered for this workspace" });
      return origin;
    },
    async isAllowedRedirectTarget() {
      return false;
    },
    async isAllowedEgressTarget() {
      return false;
    },
  };
}

async function makeDeps(posts: PostRecord[], origin?: import("@jini-ai/http-kit/verified-origin").VerifiedOrigin) {
  invalidateSitemapCache({ workspaceId: WORKSPACE });
  const postRepo = new InMemoryPostRepo(posts);
  const settingsRepo = new InMemorySettingsRepo();
  const settingsDeps = { settingsRepo, clock, ids, authorize: alwaysAllow, principals: { findById: async () => null } as never };
  await ensureSeoSettingDefinitions(settingsDeps, { workspaceId: WORKSPACE, systemPrincipalId: "system-seo" });

  return {
    postRepo,
    settingsRepo,
    media: {
      mediaRepo: new InMemoryMediaRepo({}, { initialRows: [] }),
      assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [] }),
      transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }),
    },
    originRegistry: fakeOriginRegistry(origin),
  };
}

test("buildSitemap: an empty workspace resolves a valid empty array, never null", async () => {
  const deps = await makeDeps([]);
  const entries = await buildSitemap(deps, { workspaceId: WORKSPACE });
  assert.deepEqual(entries, []);
});

// 2026-09-03 absolute-URL fix side effect: `computeSitemapEntries` builds `loc` from
// `getEntryMeta`'s own `meta.canonical` — once that became absolute, sitemap entries did too, for
// free. The sitemap protocol requires `loc` to be absolute, the same requirement `og:url` has.
test("buildSitemap: with a verified origin, entries' loc is absolute (2026-09-03 fix side effect)", async () => {
  const deps = await makeDeps([post({ id: "a", slug: "published-visible", status: "published" })], {
    scheme: "https",
    host: "example.test",
    verifiedAt: "2026-09-03T00:00:00.000Z",
    source: "workspace-setting",
  });
  const entries = await buildSitemap(deps, { workspaceId: WORKSPACE });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.loc, "https://example.test/published-visible");
});

// 2026-09-18 production bug (reproduced live on tovu.fly.dev via WebFetch before this fix):
// `seedDevCapabilityOrigin` (server/runtime/composition/deps.ts) durably persisted
// `http://localhost:3000` as the registered origin on Fly's first boot, and every sitemap entry's
// `loc` inherited it verbatim -- exactly the shape asserted as the (pre-fix) wrong value below.
// `resolveWorkspaceOrigin` (absolute-url.ts) now degrades a dev-capability origin to "unverified"
// under production runtime mode, so `buildSitemap` must fall back to the pre-existing bare-relative-
// path behavior instead, never a localhost URL.
test("buildSitemap: a dev-capability localhost origin never leaks into loc when running in production (regression pin, 2026-09-18)", async () => {
  const originalMode = process.env.TOVU_RUNTIME_MODE;
  process.env.TOVU_RUNTIME_MODE = "production";
  try {
    const deps = await makeDeps([post({ id: "a", slug: "published-visible", status: "published" })], {
      scheme: "http",
      host: "localhost",
      port: 3000,
      verifiedAt: "2026-07-16T00:00:00.000Z",
      source: "dev-capability",
    });
    const entries = await buildSitemap(deps, { workspaceId: WORKSPACE });
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.loc, "/published-visible", "must degrade to the bare relative path, never http://localhost:3000/published-visible");
    assert.ok(!entries[0]!.loc.includes("localhost"), "sitemap loc must never contain the dev-capability localhost origin in production");
  } finally {
    if (originalMode === undefined) delete process.env.TOVU_RUNTIME_MODE;
    else process.env.TOVU_RUNTIME_MODE = originalMode;
  }
});

test("buildSitemap: excludes drafts and effective-noindex entries, includes only eligible published entries (AC-16/17)", async () => {
  const deps = await makeDeps([
    post({ id: "a", slug: "published-visible", status: "published" }),
    post({ id: "b", slug: "draft-post", status: "draft" }),
    post({ id: "c", slug: "noindex-post", status: "published", seoExtJson: JSON.stringify({ noindex: true }) }),
  ]);

  const entries = await buildSitemap(deps, { workspaceId: WORKSPACE });
  assert.equal(entries.length, 1);
  assert.ok(entries[0]!.loc.includes("published-visible"));
});

test("buildSitemap: a members/paid/tiers-gated published post is excluded — a crawler must not be told a gated post's URL/existence exists (ADR-030 §4, 2026-09-03 sweep)", async () => {
  const deps = await makeDeps([
    post({ id: "a", slug: "public-post", status: "published" }),
    post({ id: "b", slug: "members-only-post", status: "published", memberAccessJson: JSON.stringify({ visibility: "members" }) }),
    post({ id: "c", slug: "paid-only-post", status: "published", memberAccessJson: JSON.stringify({ visibility: "paid" }) }),
    post({ id: "d", slug: "tiers-only-post", status: "published", memberAccessJson: JSON.stringify({ visibility: "tiers", tierIds: ["t-1"] }) }),
  ]);

  const entries = await buildSitemap(deps, { workspaceId: WORKSPACE });
  assert.equal(entries.length, 1, "only the ungated post may appear");
  assert.ok(entries[0]!.loc.includes("public-post"));
  for (const gatedSlug of ["members-only-post", "paid-only-post", "tiers-only-post"]) {
    assert.ok(
      !entries.some((e) => e.loc.includes(gatedSlug)),
      `${gatedSlug} must not appear in the sitemap`
    );
  }
});

test("buildSitemap: a post with malformed memberAccessJson fails CLOSED (excluded), same as resolvePostMemberAccess's own fail-closed contract", async () => {
  const deps = await makeDeps([post({ id: "a", slug: "malformed-access-post", status: "published", memberAccessJson: "{not json" })]);

  const entries = await buildSitemap(deps, { workspaceId: WORKSPACE });
  assert.deepEqual(entries, []);
});

test("buildSitemap: a post with a NULL memberAccessJson (every pre-existing row) is treated as public, unchanged from pre-gating behavior", async () => {
  const deps = await makeDeps([post({ id: "a", slug: "legacy-ungated-post", status: "published", memberAccessJson: null })]);

  const entries = await buildSitemap(deps, { workspaceId: WORKSPACE });
  assert.equal(entries.length, 1);
  assert.ok(entries[0]!.loc.includes("legacy-ungated-post"));
});

test("buildSitemap: a trashed post that still carries status: 'published' is excluded (softDelete never clears status, so the status guard alone can't catch it)", async () => {
  const deps = await makeDeps([
    post({ id: "a", slug: "still-live-post", status: "published" }),
    post({ id: "b", slug: "trashed-but-published-post", status: "published", deletedAt: "2026-09-04T00:00:00.000Z" }),
  ]);

  const entries = await buildSitemap(deps, { workspaceId: WORKSPACE });
  assert.equal(entries.length, 1, "only the non-trashed post may appear");
  assert.ok(entries[0]!.loc.includes("still-live-post"));
  assert.ok(
    !entries.some((e) => e.loc.includes("trashed-but-published-post")),
    "a trashed post must never appear in the sitemap, even though its status column still reads 'published'"
  );
});

test("buildSitemap: entries are ordered by keyset id ascending with lastmod from updatedAt", async () => {
  const deps = await makeDeps([
    post({ id: "c", slug: "a-post", updatedAt: "2026-07-15T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" }),
    post({ id: "a", slug: "z-post", updatedAt: "2026-07-13T00:00:00.000Z", createdAt: "2026-01-02T00:00:00.000Z" }),
    post({ id: "b", slug: "m-post", updatedAt: "2026-07-14T00:00:00.000Z", createdAt: "2026-01-03T00:00:00.000Z" }),
  ]);
  const entries = await buildSitemap(deps, { workspaceId: WORKSPACE });
  assert.deepEqual(entries.map(e => e.loc), ["/z-post", "/m-post", "/a-post"]);
  assert.deepEqual(entries, [
    { loc: "/z-post", lastmod: "2026-07-13T00:00:00.000Z" },
    { loc: "/m-post", lastmod: "2026-07-14T00:00:00.000Z" },
    { loc: "/a-post", lastmod: "2026-07-15T00:00:00.000Z" },
  ]);
});

test("sitemap contributors append entries in priority order with workspace context and reset removes them", async () => {
  resetSitemapCollectHooksForTests();
  const calls: unknown[] = [];
  try {
    const deps = await makeDeps([post({ slug: "base-post" })]);
    registerSitemapCollectHook({ priority: 20, handle: async ctx => { calls.push(["later", ctx]); return [{ loc: "/later", lastmod: "2026-07-02" }]; } });
    registerSitemapCollectHook({ priority: 5, handle: async ctx => { calls.push(["earlier", ctx]); return [{ loc: "/earlier", lastmod: "2026-07-01" }]; } });
    assert.deepEqual(await buildSitemap(deps, { workspaceId: WORKSPACE }), [
      { loc: "/base-post", lastmod: "2026-07-13T00:00:00.000Z" },
      { loc: "/earlier", lastmod: "2026-07-01" }, { loc: "/later", lastmod: "2026-07-02" },
    ]);
    assert.deepEqual(calls, [["earlier", { workspaceId: WORKSPACE, baseUrl: "" }], ["later", { workspaceId: WORKSPACE, baseUrl: "" }]]);
    resetSitemapCollectHooksForTests();
    invalidateSitemapCache({ workspaceId: WORKSPACE });
    assert.deepEqual(await buildSitemap(deps, { workspaceId: WORKSPACE }), [{ loc: "/base-post", lastmod: "2026-07-13T00:00:00.000Z" }]);
    assert.equal(calls.length, 2);
  } finally {
    resetSitemapCollectHooksForTests();
    invalidateSitemapCache({ workspaceId: WORKSPACE });
  }
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
