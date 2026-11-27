import assert from "node:assert/strict";
import { test } from "vitest";
import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { setEntrySeoOverrides } from "../write-service.js";
import { buildPostRecord, InMemoryPostRepo } from "./support/post.fixture.js";

function fixture() {
  const repo = new InMemoryPostRepo([buildPostRecord({ id: "post", workspaceId: "ws", version: 1, seoExtJson: null })]);
  const postRepo = {
    findById: (input: { workspaceId: string; id: string }) => repo.findById(input),
    isTrashed: repo.isTrashed.bind(repo), extractPlainText: repo.extractPlainText.bind(repo),
    saveIfVersion: repo.saveIfVersion.bind(repo), appendRevision: repo.appendRevision.bind(repo),
    transaction: <T>({ fn }: { fn: () => Promise<T> }) => repo.transaction(fn),
  };
  const media = { featuredImage: {
    findMediaByIdOrSlug: async () => null, mediaUrlKey: () => "", mediaPublicPath: () => "",
    resolveFeaturedImageRef: async () => ({ ok: false as const, reason: "not-found" }),
  } };
  const deps = { postRepo, media, authorize: async () => ({ allowed: true, reason: "test" }),
    invalidateSitemapCache: async () => {}, clock: { nowMs: () => 0 } };
  return { repo, postRepo, deps };
}

test("SEO edit refuses an editor's stale version and preserves the first change", async () => {
  const { repo, deps } = fixture();
  const input = { workspaceId: "ws", entryId: "post", callerPrincipalId: "editor" };
  await setEntrySeoOverrides({ deps, input: { ...input, patch: { title: "First" } } }, { expectedVersion: 1 });
  await assert.rejects(setEntrySeoOverrides({ deps, input: { ...input, patch: { title: "Second" } } }, { expectedVersion: 1 }),
    (error: unknown) => error instanceof RecordVersionConflictError && error.currentVersion === 2);
  assert.equal((await repo.findById({ workspaceId: "ws", id: "post" }))?.seoExtJson, '{"title":"First"}');
});

test("a race after the initial read is refused without retrying against a newer version", async () => {
  const { repo, postRepo, deps } = fixture();
  const save = postRepo.saveIfVersion;
  let attempts = 0;
  postRepo.saveIfVersion = async (input) => {
    attempts++;
    const current = await repo.findById({ workspaceId: "ws", id: "post" });
    assert.ok(current);
    await repo.save({ ...current, title: "Concurrent", version: 2 });
    return save(input);
  };
  await assert.rejects(setEntrySeoOverrides({ deps, input: { workspaceId: "ws", entryId: "post", callerPrincipalId: "editor", patch: { title: "SEO" } } }, { expectedVersion: 1 }),
    (error: unknown) => error instanceof RecordVersionConflictError && error.currentVersion === 2);
  assert.equal(attempts, 1);
  assert.equal((await repo.findById({ workspaceId: "ws", id: "post" }))?.title, "Concurrent");
});

test("deletion during a conditional save reports the vanished editor basis without recreating the post", async () => {
  const { repo, deps, postRepo } = fixture();
  const target = { workspaceId: "ws", id: "post" };
  const save = postRepo.saveIfVersion;
  const attemptedVersions: number[] = [];
  postRepo.saveIfVersion = async (request) => {
    attemptedVersions.push(request.ifVersion);
    await repo.hardDelete(target);
    return save(request);
  };

  await assert.rejects(setEntrySeoOverrides({
    deps, input: { workspaceId: "ws", entryId: "post", callerPrincipalId: "editor", patch: { title: "Do not restore" } },
  }, { expectedVersion: 1 }), (error: unknown) =>
    error instanceof RecordVersionConflictError && error.code === "VERSION_CONFLICT" &&
    error.currentVersion === null && error.recordId === "post" && error.message.includes("it has since been deleted")
  );
  assert.deepEqual(attemptedVersions, [1]);
  assert.equal(await repo.findById(target), null);
  assert.deepEqual(await repo.listRevisions({ workspaceId: "ws", postId: "post" }), []);
});
