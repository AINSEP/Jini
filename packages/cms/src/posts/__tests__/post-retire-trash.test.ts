import assert from "node:assert/strict";
import { expect, it, vi } from "vitest";
import { PostConflictError, PostNotFoundError, PostVersionConflictError, type PostRecord } from "../post.js";
import { retirePostForReplacement } from "../post-retire.js";
import { deletePost, restorePostForward } from "../post-trash.js";
import { NOW, WORKSPACE, postClock, postRepo, postRow, recordingPostOutbox, removeFromPostRepo } from "./post-coverage.fixture.js";

const scope = { workspaceId: WORKSPACE, id: "post-id" };
const published = postRow({ status: "published", slug: "story", title: "Old story" });
const input = { ...scope, expectedVersion: 4, today: "20261125" };
function setup(rows: PostRecord[]) {
  const repo = postRepo(rows);
  const { events, outbox } = recordingPostOutbox();
  const remove = vi.fn(removeFromPostRepo(repo));
  const forgetRemoved = vi.fn(async () => {});
  const deps = { repo, outbox, clock: postClock, remove, forgetRemoved };
  return { repo, remove, events, deps, forgetRemoved, revisions: () => repo.listRevisions({ workspaceId: WORKSPACE, postId: scope.id }) };
}

it("trashes a published post with the authorized marker and only one unpublish event", async () => {
  const s = setup([published]);
  const result = await deletePost({ deps: s.deps, input: { ...scope, actorId: "editor", actorPluginId: "assistant", actor: { id: "editor", kind: "agent" } } });
  const post = { ...published, version: 5, updatedAt: NOW, deletedAt: NOW };
  expect(result).toEqual({ post, revisionId: "revision-1", previousRevisionId: null });
  expect(await s.repo.findById(scope)).toEqual(post);
  expect(s.remove).toHaveBeenCalledExactlyOnceWith({
    ...scope, display: { title: "Old story", subtitle: "story" }, at: NOW, expectedVersion: 4, actor: { principalId: "editor", pluginId: "assistant" },
  });
  expect(await s.revisions()).toMatchObject([{ op: "delete", seq: 5, stateJson: post, actorId: "editor" }]);
  expect(s.events).toEqual([{
    id: "post-id-entry.unpublished-5", name: "entry.unpublished", aggregateId: "post-id", workspaceId: WORKSPACE, occurredAt: NOW,
    actorId: "editor", actor: { id: "editor", kind: "agent" }, payload: { entryId: "post-id", contentType: "post", actorId: "editor" },
  }]);
  await assert.rejects(deletePost({ deps: s.deps, input: scope }), { constructor: PostNotFoundError, message: "post 'post-id' was not found" });
  expect(s.remove).toHaveBeenCalledTimes(1);
  expect(s.events.map(event => event.id)).toEqual(["post-id-entry.unpublished-5"]);
});

it("a removal port not-found refuses deletion without recording an effect", async () => {
  const s = setup([published]);
  s.remove.mockResolvedValueOnce({ ok: false, reason: "not-found" });
  await assert.rejects(deletePost({ deps: s.deps, input: scope }), { constructor: PostNotFoundError, message: "post 'post-id' was not found" });
  expect(await s.repo.findById(scope)).toEqual(published);
  expect(await s.revisions()).toEqual([]);
  expect(s.events).toEqual([]);
});

it.each([
  { name: "missing", row: null, version: 4, error: PostNotFoundError, message: "post 'post-id' was not found" },
  { name: "homepage", row: { ...published, slug: "/", kind: "page" as const }, version: 4, error: PostConflictError, message: "the home page cannot be replaced by publishing" },
  { name: "stale plan", row: published, version: 3, error: PostVersionConflictError, message: "post 'post-id' was modified by another save (expected version 3, current version 4)" },
])("publishing cannot retire a $name holder", async ({ row, version, error, message }) => {
  const s = setup(row ? [row] : []);
  await assert.rejects(retirePostForReplacement({ deps: s.deps, input: { ...input, expectedVersion: version } }), { constructor: error, message });
  expect(await s.repo.findById(scope)).toEqual(row);
  expect(s.remove).not.toHaveBeenCalled();
  expect(await s.revisions()).toEqual([]);
  expect(s.events).toEqual([]);
});

it("moves an already-trashed holder aside without retiring it again or changing its restore version", async () => {
  const trashed = { ...published, deletedAt: "2026-11-24T15:00:00.000Z" };
  const s = setup([trashed]);
  const moved = { ...trashed, slug: "story-trashed" };
  expect(await retirePostForReplacement({ deps: s.deps, input })).toEqual({ post: moved, revisionId: null, previousRevisionId: null });
  expect(await s.repo.findBySlug({ workspaceId: WORKSPACE, slug: "story" })).toBeNull();
  expect(await s.repo.findById(scope)).toEqual(moved);
  expect(s.remove).not.toHaveBeenCalled();
  expect(await s.revisions()).toEqual([]);
  expect(s.events).toEqual([]);
});

it("renames past occupied retirement slugs before trashing the new version", async () => {
  const s = setup([published, postRow({ id: "one", slug: "story-replaced-20261125" }), postRow({ id: "two", slug: "story-replaced-20261125-2" })]);
  const result = await retirePostForReplacement({ deps: s.deps, input: { ...input, actorId: "releaser" } });
  const renamed = { ...published, slug: "story-replaced-20261125-3", version: 5, updatedAt: NOW };
  const retired = { ...renamed, version: 6, deletedAt: NOW };
  expect(result).toEqual({ post: retired, revisionId: "revision-2", previousRevisionId: "revision-1" });
  expect(s.remove).toHaveBeenCalledExactlyOnceWith({ ...scope, display: { title: "Old story", subtitle: "story (replaced by publish)" },
    expectedVersion: 5, at: NOW, actor: { principalId: "releaser" } });
  expect(await s.repo.findById(scope)).toEqual(retired);
  expect(await s.revisions()).toMatchObject([{ op: "update", seq: 5, stateJson: renamed }, { op: "delete", seq: 6, stateJson: retired }]);
  expect(s.events.map(event => event.id)).toEqual(["post-id-entry.unpublished-6"]);
});

it.each([
  ["not-found", PostNotFoundError, "post 'post-id' was not found"],
  ["version-changed", PostConflictError, "post 'post-id' changed while it was being retired"],
] as const)("rolls back the rename and its revision on a %s removal response", async (reason, constructor, message) => {
  const s = setup([published]);
  s.remove.mockImplementationOnce(async () => {
    expect(await s.repo.findById(scope)).toMatchObject({ slug: "story-replaced-20261125", version: 5 });
    return { ok: false, reason };
  });
  await assert.rejects(retirePostForReplacement({ deps: s.deps, input }), { constructor, message });
  expect(await s.repo.findById(scope)).toEqual(published);
  expect(await s.revisions()).toEqual([]);
  expect(s.events).toEqual([]);
});

it("never overwrites a save that lands during retirement's slug search", async () => {
  const s = setup([published]);
  const concurrent = { ...published, title: "Newer editor title", version: 5 };
  const lookup = s.repo.findBySlug.bind(s.repo);
  vi.spyOn(s.repo, "findBySlug").mockImplementationOnce(async request => {
    await s.repo.save(concurrent);
    return lookup(request);
  });
  // The planned version must still be authoritative at the first rename, not just at preflight.
  const result = retirePostForReplacement({ deps: s.deps, input });
  await expect(result).rejects.toBeInstanceOf(PostVersionConflictError);
  await expect(result).rejects.toMatchObject({ expectedVersion: 4, currentVersion: 5 });
  expect(await s.repo.findById(scope)).toEqual(concurrent);
  expect(await s.revisions()).toEqual([]);
  expect(s.remove).not.toHaveBeenCalled();
  expect(s.events).toEqual([]);
});

it("undoes an update forward without clearing an unrelated Trash index", async () => {
  const s = setup([{ ...published, title: "Accidental change", version: 6 }]);
  await s.repo.appendRevision({ workspaceId: WORKSPACE, postId: scope.id, seq: 4, op: "create", stateJson: published, actorId: "editor", recordedAt: published.updatedAt });
  const result = await restorePostForward({ deps: s.deps, input: { prior: published, actorId: "operator" } });
  const restored = { ...published, updatedAt: NOW, version: 7 };
  expect(result).toEqual({ post: restored, revisionId: "revision-2" });
  expect(await s.repo.findById(scope)).toEqual(restored);
  expect(await s.revisions()).toMatchObject([{ id: "revision-1" }, { op: "restore", seq: 7, restoredFrom: "revision-1", actorId: "operator" }]);
  expect(s.forgetRemoved).not.toHaveBeenCalled();
  expect(s.events.map(e => e.id)).toEqual(["post-id-entry.updated-7"]);
});

it.each([{ name: "missing", current: null }, { name: "unchanged version", current: published }])("cannot restore over a $name row", async ({ current }) => {
  const s = setup(current ? [current] : []);
  expect(await restorePostForward({ deps: s.deps, input: { prior: published } })).toBeNull();
  expect(await s.repo.findById(scope)).toEqual(current);
  expect(await s.revisions()).toEqual([]);
  expect(s.forgetRemoved).not.toHaveBeenCalled();
  expect(s.events).toEqual([]);
});

it("undo leaves a later save untouched if the restore CAS loses", async () => {
  const trashed = { ...published, version: 5, deletedAt: NOW };
  const s = setup([trashed]);
  const save = vi.spyOn(s.repo, "saveIfVersion").mockResolvedValueOnce({ applied: false });
  expect(await restorePostForward({ deps: s.deps, input: { prior: published } })).toBeNull();
  expect(save).toHaveBeenCalledExactlyOnceWith({ record: { ...published, version: 6, updatedAt: NOW }, ifVersion: 5 });
  expect(await s.repo.findById(scope)).toEqual(trashed);
  expect(await s.revisions()).toEqual([]);
  expect(s.forgetRemoved).not.toHaveBeenCalled();
  expect(s.events).toEqual([]);
});
