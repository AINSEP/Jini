import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import type { ChangeSetItemRecord } from "@jini-ai/core/contracts/events";
import { createMediaAccessEvidence } from "../../media/site/access-evidence.js";
import { PostVersionConflictError, type PostRecord } from "@jini-ai/cms/posts/post";
import { bindInMemoryPostRepo } from "../repo.memory.js";
import { createPostRevertRegistry, createPostReverters, type PostReverterDeps } from "../reverters.js";

const now = "2026-11-26T12:00:00.000Z";
const old = "2026-11-24T09:00:00.000Z";
const row: PostRecord = { id: "story", workspaceId: "site", title: "New title", slug: "story-replaced", kind: "post", status: "draft",
  bodyJson: { type: "doc" }, bodyFormat: "doc", bodyHtml: null, updatedAt: old, version: 6,
  ext: { plugin: { counter: 9 } }, author: "Current author", showAuthor: true, templateChoice: "new.html",
  publishAt: "2026-11-27T09:00:00.000Z", featuredMediaId: "cover" };
const key = { workspaceId: "site", id: "story" };
const identity = { workspaceId: "site", entityId: "story" };
const ledger = { workspaceId: "site", postId: "story" };

function fixture(initialRows: PostRecord[]) {
  let next = 0;
  const Repo = bindInMemoryPostRepo({ nowIso: () => now, newId: () => `revision-${++next}`,
    hashJsonText: (value) => createHash("sha256").update(value).digest("hex"), createEvidence: createMediaAccessEvidence });
  const postRepo = new Repo({}, { initialRows });
  const enqueue = vi.fn<PostReverterDeps["outbox"]["enqueue"]>(async () => {});
  const forgetRemoved = vi.fn<PostReverterDeps["forgetRemoved"]>(async () => {});
  const deps: PostReverterDeps = { postRepo, clock: { nowMs: () => Date.parse(now) }, forgetRemoved,
    outbox: { enqueue, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} } };
  return { postRepo, enqueue, forgetRemoved, deps, reverters: createPostReverters(deps) };
}

const item = (operation: "update" | "delete", inversePayload?: ChangeSetItemRecord["inversePayload"]): ChangeSetItemRecord => ({
  id: "item", changeSetId: "change", entityType: "post", entityId: "story", operation, position: 0, entityVersionAtApply: 6,
  ...(inversePayload === undefined ? {} : { inversePayload }),
});

test("the registered update restores the exact pre-image as a new revision and resolves the current actor by version", async () => {
  const f = fixture([row]);
  const registry = createPostRevertRegistry(f.deps);
  const update = registry.resolve("post", "update")!;
  expect(registry.resolve("post", "create")).toBeUndefined();
  expect(await registry.resolve("post", "delete")!.currentVersion(identity)).toBe(6);
  expect(await update.currentVersion(identity)).toBe(6);
  expect(await update.currentActor!(identity)).toBeNull();
  for (const [seq, actorId] of [[6, "current-writer"], [8, "different-writer"]] as const) {
    await f.postRepo.appendRevision({ ...ledger, seq, actorId, op: "update", stateJson: { ...row, version: seq }, recordedAt: old });
  }
  expect(await update.currentActor!(identity)).toBe("current-writer");
  const before = { title: "Historical", slug: "previous", bodyJson: { type: "doc", content: [] }, status: "published" as const,
    ext: { oldPlugin: { theme: "amber" } }, publishAt: null, featuredMediaId: null, author: null, showAuthor: false, templateChoice: "" };
  await update.applyInverse({ workspaceId: "site", item: item("update", before) });
  const restored = await f.postRepo.findById(key);
  expect(restored).toMatchObject({ id: "story", kind: "post", title: "Historical", slug: "previous", bodyJson: before.bodyJson,
    status: "published", ext: { oldPlugin: { theme: "amber" } }, author: null, showAuthor: false, templateChoice: "", version: 7, updatedAt: now });
  expect(restored).not.toHaveProperty("ext.plugin");
  expect(restored).not.toHaveProperty("publishAt");
  expect(restored).not.toHaveProperty("featuredMediaId");
  expect(await update.currentActor!(identity)).toBe("system");
  expect((await f.postRepo.listRevisions(ledger)).find(revision => revision.seq === 7))
    .toMatchObject({ actorId: "system", op: "restore", recordedAt: now, stateJson: restored });
  expect(f.enqueue).toHaveBeenCalledExactlyOnceWith({ id: "story-entry.published-7", name: "entry.published",
    occurredAt: now, aggregateId: "story", workspaceId: "site", payload: { entryId: "story", contentType: "post" } });
});

test("an older update inverse preserves newer presentation fields but drops plugin data absent from the saved pre-image", async () => {
  const f = fixture([row]);
  await f.reverters.update.applyInverse({ workspaceId: "site", item: item("update",
    { title: "Before", slug: "story-replaced", bodyJson: {}, status: "draft" }) });
  const restored = await f.postRepo.findById(key);
  expect(restored).toMatchObject({ title: "Before", version: 7, publishAt: "2026-11-27T09:00:00.000Z",
    featuredMediaId: "cover", author: "Current author", showAuthor: true, templateChoice: "new.html" });
  expect(restored).not.toHaveProperty("ext");
  expect(f.enqueue).not.toHaveBeenCalled();
});

test("update and delete refuse missing posts and an update without an inverse cannot change a row", async () => {
  const f = fixture([row]);
  const unknown = { workspaceId: "site", entityId: "unknown" };
  for (const reverter of [f.reverters.update, f.reverters.delete]) {
    expect(await reverter.currentVersion(unknown)).toBeNull();
    expect(await reverter.currentActor!(unknown)).toBeNull();
  }
  await expect(f.reverters.update.applyInverse({ workspaceId: "site", item: item("update") }))
    .rejects.toThrow("post reverter called without an inverse payload");
  await expect(f.reverters.update.applyInverse({ workspaceId: "site", item: { ...item("update", { title: "Prior" }), entityId: "unknown" } }))
    .rejects.toThrow("post 'unknown' was not found");
  await expect(f.reverters.delete.applyInverse({ workspaceId: "site", item: { ...item("delete"), entityId: "unknown" } }))
    .rejects.toThrow("post 'unknown' was not found");
  expect(await f.postRepo.findById(key)).toEqual(row);
  expect(await f.postRepo.listRevisions(ledger)).toEqual([]);
});

test("delete undo restores the old address only when vacant and forgets only the reverted trash entry", async () => {
  const trashed = { ...row, deletedAt: old };
  const holder = { ...row, id: "other", slug: "original", deletedAt: old };
  for (const occupied of [false, true]) {
    const f = fixture(occupied ? [holder, trashed] : [trashed]);
    await f.reverters.delete.applyInverse({ workspaceId: "site", item: item("delete", { slug: "original", deletedAt: null }) });
    expect(await f.postRepo.findById(key)).toMatchObject({
      id: "story", slug: occupied ? "story-replaced" : "original", deletedAt: null, updatedAt: now, version: 7,
    });
    expect(await f.postRepo.findById({ workspaceId: "site", id: "other" })).toEqual(occupied ? holder : null);
    expect(f.forgetRemoved).toHaveBeenCalledExactlyOnceWith(key);
  }
});

test("delete undo does not untrash or rewrite a row already in Trash before retirement", async () => {
  const existing = { ...row, deletedAt: old };
  const f = fixture([existing]);
  await f.reverters.delete.applyInverse({ workspaceId: "site", item: item("delete", { deletedAt: old, slug: "original" }) });
  expect(await f.postRepo.findById(key)).toEqual(existing);
  expect(await f.postRepo.listRevisions(ledger)).toEqual([]);
  expect(f.forgetRemoved).not.toHaveBeenCalled();
});

test("an update inverse that loses its compare-and-set reports the winning version without writing history", async () => {
  const f = fixture([row]);
  const current = { ...row, version: 9, title: "Concurrent writer" };
  const save = vi.spyOn(f.postRepo, "saveIfVersion");
  const read = vi.spyOn(f.postRepo, "findById");
  try {
    // The row changed after the reverter's first read. Seed the actual winner then return the
    // read snapshot once so all later reads and the CAS operate against the real repository.
    await f.postRepo.save(current);
    read.mockResolvedValueOnce(row);
    const failed = f.reverters.update.applyInverse({ workspaceId: "site", item: item("update",
      { title: "Old", slug: "old", bodyJson: {}, status: "draft" }) });
    await expect(failed).rejects.toBeInstanceOf(PostVersionConflictError);
    await expect(failed).rejects.toMatchObject({ expectedVersion: 6, currentVersion: 9,
      message: "post 'story' was modified while it was being reverted (expected version 6, current version 9)" });
    expect(save.mock.calls[0]?.[0].ifVersion).toBe(6);
    expect(await f.postRepo.findById(key)).toEqual(current);
    expect(await f.postRepo.listRevisions(ledger)).toEqual([]);
    expect(f.enqueue).not.toHaveBeenCalled();
  } finally { read.mockRestore(); save.mockRestore(); }
});
