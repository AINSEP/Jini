import assert from "node:assert/strict";
import { test } from "vitest";
import { OriginNotVerifiedError } from "@jini-ai/http-kit/verified-origin";
import { createSitemapService, SITEMAP_INVALIDATED_EVENT } from "../sitemap.js";
import { setEntrySeoOverrides } from "../write-service.js";
import { SeoFieldValidationError } from "../errors.js";
import { buildPostRecord, InMemoryPostRepo } from "./support/post.fixture.js";
import { InMemorySettingsRepo, seoDeps } from "./support/legacy-api.fixture.js";
import { InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";
import type { EventBusPort, OutboxPort } from "../../core/index.js";

function harness(slug: string) {
  const postRepo = new InMemoryPostRepo([buildPostRecord({ slug })]);
  const deps = seoDeps({ postRepo, settingsRepo: new InMemorySettingsRepo(),
    originRegistry: { canonicalOrigin: async () => { throw new OriginNotVerifiedError({ message: "unverified" }); },
      isAllowedRedirectTarget: async () => false, isAllowedEgressTarget: async () => false },
    media: { mediaRepo: new InMemoryMediaRepo({}, { initialRows: [] }),
      transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }) } });
  return { deps, postRepo, service: createSitemapService({ deps }) };
}

test("two services isolate hooks, caches, invalidation and unregister for the same workspace", async () => {
  const a = harness("a");
  const b = harness("b");
  const input = { workspaceId: "workspace-1" };
  const unregister = a.service.registerSitemapCollectHook({ hook: { priority: 1, handle: async () => [{ loc: "/a-hook" }] } });
  assert.deepEqual((await a.service.buildSitemap(input)).map(e => e.loc), ["/a", "/a-hook"]);
  assert.deepEqual((await b.service.buildSitemap(input)).map(e => e.loc), ["/b"]);
  await a.postRepo.save(buildPostRecord({ slug: "a-new" }));
  await b.postRepo.save(buildPostRecord({ slug: "b-new" }));
  unregister();
  unregister();
  a.service.invalidateSitemapCache(input);
  assert.deepEqual((await a.service.buildSitemap(input)).map(e => e.loc), ["/a-new"]);
  assert.deepEqual((await b.service.buildSitemap(input)).map(e => e.loc), ["/b"]);
  await b.service.createSeoEventSubscriptions({}).onSitemapInvalidated(input);
  assert.deepEqual((await b.service.buildSitemap(input)).map(e => e.loc), ["/b-new"]);
});

test("an older build cannot publish over a newer build inside one service", async () => {
  const { deps, postRepo, service } = harness("old");
  const input = { workspaceId: "workspace-1" };
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const list = deps.postRepo.list;
  deps.postRepo.list = async required => {
    const rows = await list(required);
    if (++calls === 1) await held;
    return rows;
  };
  const oldBuild = service.regenerateSitemapCache(input);
  try {
    await postRepo.save(buildPostRecord({ slug: "new" }));
    await service.regenerateSitemapCache(input);
  } finally {
    release();
    await oldBuild;
  }
  assert.deepEqual((await service.buildSitemap(input)).map(e => e.loc), ["/new"]);
});

test("invalidation clears the local snapshot, enqueues the exact event and calls the dispatch port", async () => {
  const { service, postRepo } = harness("before");
  const input = { workspaceId: "workspace-1" };
  await service.buildSitemap(input);
  await postRepo.save(buildPostRecord({ slug: "after" }));
  const events: unknown[] = [];
  const order: string[] = [];
  const outbox = { enqueue: async (event: unknown) => { events.push(event); order.push("enqueue"); } } as OutboxPort;
  const bus = {} as EventBusPort;
  await service.requestSitemapInvalidation({ input, deps: { outbox, bus,
    clock: { nowIso: () => "2026-10-07T00:00:00.000Z" }, idGen: { newId: () => "event-1" },
    dispatch: async required => {
      assert.equal(required.outbox, outbox);
      assert.equal(required.bus, bus);
      assert.equal(required.clock.nowMs(), Date.parse("2026-10-07T00:00:00.000Z"));
      order.push("dispatch");
    } } });
  assert.deepEqual(order, ["enqueue", "dispatch"]);
  assert.deepEqual(events, [{ id: "event-1", name: SITEMAP_INVALIDATED_EVENT,
    occurredAt: "2026-10-07T00:00:00.000Z", aggregateId: "workspace-1", workspaceId: "workspace-1", payload: {} }]);
  assert.deepEqual((await service.buildSitemap(input)).map(e => e.loc), ["/after"]);
});

test("known non-images are refused through the required featured-image port before any write", async () => {
  const { deps, postRepo } = harness("post");
  const before = await postRepo.findById({ workspaceId: "workspace-1", id: "post-1" });
  await assert.rejects(setEntrySeoOverrides({ deps: { postRepo, clock: { nowMs: () => 0 },
    authorize: async () => ({ allowed: true, reason: "matched" }), invalidateSitemapCache: () => {},
    media: { featuredImage: { ...deps.media.featuredImage,
      resolveFeaturedImageRef: async () => ({ ok: false, reason: "not-image", contentType: "video/mp4" }) } } },
    input: { workspaceId: "workspace-1", entryId: "post-1", callerPrincipalId: "p1", patch: { ogImage: "video:public" } } }),
  (error: unknown) => error instanceof SeoFieldValidationError && error.message === "ogImage: media asset 'video' is video/mp4, not an image. A social share image must be an image.");
  assert.deepEqual(await postRepo.findById({ workspaceId: "workspace-1", id: "post-1" }), before);
  assert.deepEqual(await postRepo.listRevisions({ workspaceId: "workspace-1", postId: "post-1" }), []);
});
