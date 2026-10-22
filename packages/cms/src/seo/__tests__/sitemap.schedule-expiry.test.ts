import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";

import { InMemoryPostRepo, type PostRecord } from "./support/post.fixture.js";
import { InMemorySettingsRepo } from "./support/legacy-api.fixture.js";
import { InMemoryAssetRenditionRepo, InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";
import { OriginNotVerifiedError, type OriginRegistryPort } from "@jini-ai/http-kit/verified-origin";
import { ensureSeoSettingDefinitions } from "./support/legacy-api.fixture.js";
import { buildSitemap, invalidateSitemapCache } from "./support/legacy-api.fixture.js";
import { buildPostRecord } from "./support/post.fixture.js";

/**
 * @file Scheduled publishing (2026-10-05): nothing emits an event when a scheduled post goes live,
 * so the cached sitemap carries an expiry at the earliest future `publishAt` and is rebuilt on the
 * first read at or after it. The wall clock is faked with `mock.timers` (Date only), because
 * `currentIso()` reads `new Date()`.
 */

const WORKSPACE = "workspace-sitemap-expiry";
const T0 = Date.parse("2026-10-05T12:00:00.000Z");
const GO_LIVE = "2026-10-05T13:00:00.000Z";
const clock = { nowIso: () => new Date(T0).toISOString() };
let idCounter = 0;
const ids = { newId: () => `sitemap-expiry-id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

function post(overrides: Partial<PostRecord>): PostRecord {
  return buildPostRecord({
    workspaceId: WORKSPACE,
    title: "Post",
    bodyJson: { type: "doc", content: [] },
    status: "published",
    kind: "post",
    updatedAt: "2026-10-01T00:00:00.000Z",
    version: 1,
    seoExtJson: null,
    ...overrides,
  });
}

function originRegistry(): OriginRegistryPort {
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

async function makeDeps(posts: PostRecord[]) {
  invalidateSitemapCache({ workspaceId: WORKSPACE });
  const settingsRepo = new InMemorySettingsRepo();
  const settingsDeps = { settingsRepo, clock, ids, authorize: alwaysAllow, principals: { findById: async () => null } as never };
  await ensureSeoSettingDefinitions(settingsDeps, { workspaceId: WORKSPACE, systemPrincipalId: "system-seo" });
  return {
    postRepo: new InMemoryPostRepo(posts),
    settingsRepo,
    media: {
      mediaRepo: new InMemoryMediaRepo({}, { initialRows: [] }),
      assetRenditionRepo: new InMemoryAssetRenditionRepo({}, { initialRows: [] }),
      transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }),
    },
    originRegistry: originRegistry(),
  };
}

const locs = (entries: ReadonlyArray<{ loc: string }>) => entries.map((entry) => entry.loc).sort();

test("buildSitemap: the cached sitemap expires at a scheduled post's go-live time, and the post appears", async (t) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);

  const deps = await makeDeps([post({ id: "live", slug: "live" }), post({ id: "later", slug: "later", publishAt: GO_LIVE })]);

  assert.deepEqual(locs(await buildSitemap(deps, { workspaceId: WORKSPACE })), ["/live"], "a scheduled post is not in the sitemap before it goes live");

  // A row written without any invalidation proves the next read is still the cache, not a rebuild.
  await deps.postRepo.save(post({ id: "silent", slug: "silent" }));
  tickDate(Date.parse(GO_LIVE) - T0 - 1);
  assert.deepEqual(locs(await buildSitemap(deps, { workspaceId: WORKSPACE })), ["/live"], "the cache holds until the go-live instant");

  tickDate(1);
  assert.deepEqual(locs(await buildSitemap(deps, { workspaceId: WORKSPACE })), ["/later", "/live", "/silent"], "the cache is rebuilt at go-live");
});

test("buildSitemap: with nothing scheduled the cache has no expiry", async (t) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);

  const deps = await makeDeps([post({ id: "live", slug: "live" })]);

  assert.deepEqual(locs(await buildSitemap(deps, { workspaceId: WORKSPACE })), ["/live"]);
  await deps.postRepo.save(post({ id: "silent", slug: "silent" }));
  tickDate(365 * 24 * 60 * 60 * 1000);
  assert.deepEqual(locs(await buildSitemap(deps, { workspaceId: WORKSPACE })), ["/live"]);
});

test("buildSitemap: the expiry tracks the EARLIEST future go-live, and a past publishAt sets none", async (t) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);

  const deps = await makeDeps([
    post({ id: "past", slug: "past", publishAt: "2026-10-01T00:00:00.000Z" }),
    post({ id: "late", slug: "late", publishAt: "2026-10-05T15:00:00.000Z" }),
    post({ id: "soon", slug: "soon", publishAt: GO_LIVE }),
  ]);

  assert.deepEqual(locs(await buildSitemap(deps, { workspaceId: WORKSPACE })), ["/past"]);
  tickDate(Date.parse(GO_LIVE) - T0);
  assert.deepEqual(locs(await buildSitemap(deps, { workspaceId: WORKSPACE })), ["/past", "/soon"]);
  tickDate(2 * 60 * 60 * 1000);
  assert.deepEqual(locs(await buildSitemap(deps, { workspaceId: WORKSPACE })), ["/late", "/past", "/soon"]);
});

function tickDate(ms: number) { vi.setSystemTime(Date.now() + ms); }

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
