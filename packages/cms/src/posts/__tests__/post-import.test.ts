import assert from "node:assert/strict";
import { expect, it, vi } from "vitest";
import { importPostEntity, type ImportPostEntityInput } from "../post-import.js";
import { PostConflictError, PostNotFoundError, PostVersionConflictError, type PostRecord } from "../post.js";
import type { BeforeSaveHookPort } from "../post-before-save.js";
import { NOW, WORKSPACE, postClock, postRepo, postRow, recordingPostOutbox } from "./post-coverage.fixture.js";

const source = postRow({
  workspaceId: "source", id: "page", kind: "page", title: "Replicated page", slug: "about", version: 79, status: "published",
  bodyFormat: "html", bodyHtml: " <h1>About</h1> ", seoExtJson: '{"description":"From source"}',
  createdByPrincipalId: "original-creator", createdByKind: "agent", createdAt: "2026-11-11T00:00:00.000Z",
  ext: { imported: { tag: "carry" }, shared: { old: true } },
});
const scoped = { workspaceId: WORKSPACE, id: "page" };

function setup(rows: PostRecord[] = []) {
  const repo = postRepo(rows);
  const { events, outbox } = recordingPostOutbox();
  const deps = { repo, outbox, clock: postClock };
  const run = (input: Partial<ImportPostEntityInput> = {}, hook?: BeforeSaveHookPort) =>
    importPostEntity({ deps: { ...deps, ...(hook === undefined ? {} : { beforeSaveHook: hook }) },
      input: { workspaceId: WORKSPACE, record: source, ...input } });
  return { deps, repo, events, run };
}

it("replicates source body, metadata and creator but assigns destination version and importer attribution", async () => {
  const s = setup();
  const sourceBeforeImport = structuredClone(source);
  const hook = vi.fn<BeforeSaveHookPort>(async draft => {
    expect(draft).toEqual({
      ...scoped, title: "Replicated page", slug: "about", status: "published", bodyJson: { type: "doc", content: [] },
      ext: { imported: { tag: "carry" }, shared: { old: true } },
    });
    expect(await s.repo.findById(scoped)).toBeNull();
    return { shared: { required: 8 } };
  });
  const result = await s.run({ actorId: "release-operator", delegatedByWorkspaceId: "local", delegatedById: "owner" }, hook);
  const expected = { ...source, workspaceId: WORKSPACE, version: 1, updatedAt: NOW,
    ext: { imported: { tag: "carry" }, shared: { required: 8 } } };
  expect(result).toEqual({ post: expected, revisionId: "revision-1", previousRevisionId: null });
  expect(await s.repo.findById(scoped)).toEqual(expected);
  expect(source).toEqual(sourceBeforeImport);
  expect(await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: "page" })).toMatchObject([{
    id: "revision-1", op: "create", seq: 1, stateJson: expected, actorId: "release-operator", delegatedByWorkspaceId: "local", delegatedById: "owner", recordedAt: NOW,
  }]);
  expect(s.events).toEqual([
    { id: "page-content.created-1", name: "content.created", workspaceId: WORKSPACE, aggregateId: "page", occurredAt: NOW,
      payload: { contentType: "page", entryId: "page", actorId: "release-operator", source: "service", initialStatus: "published" } },
    { id: "page-entry.published-1", name: "entry.published", workspaceId: WORKSPACE, aggregateId: "page", occurredAt: NOW,
      payload: { contentType: "page", entryId: "page", actorId: "release-operator", source: "service" } },
  ]);
});

it("replaces destination content across formats while retaining its write-once authorship", async () => {
  const original = postRow({ ...scoped, kind: "page", slug: "about", createdByPrincipalId: "local-editor", createdByKind: "person", createdAt: "2026-10-01T00:00:00.000Z", ext: { local: { value: "old" } } });
  const s = setup([original]);
  const { ext: _ext, ...withoutExt } = source;
  const incoming = { ...withoutExt, status: "draft" as const };
  const result = await s.run({ record: incoming, expectedVersion: 4 });
  const expected = { ...incoming, ...scoped, version: 5, updatedAt: NOW, createdByPrincipalId: "local-editor",
    createdByKind: "person", createdAt: "2026-10-01T00:00:00.000Z" };
  expect(result.post).toEqual(expected);
  expect(await s.repo.findById(scoped)).toEqual(expected);
  expect(await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: "page" })).toMatchObject([{
    seq: 5, op: "update", actorId: "system", delegatedByWorkspaceId: null, delegatedById: null, stateJson: expected,
  }]);
  expect(s.events.map(event => event.id)).toEqual(["page-content.saved-5"]);
});

it("cannot overwrite an existing target when the caller planned a create", async () => {
  const local = postRow({ ...scoped, slug: "about", kind: "page" });
  const s = setup([local]);
  const result = s.run();
  await expect(result).rejects.toBeInstanceOf(PostVersionConflictError);
  await expect(result).rejects.toMatchObject({ expectedVersion: 0, currentVersion: 4, message: "post 'page' already exists at this destination (version 4) but was published as new" });
  expect(await s.repo.findById(scoped)).toEqual(local);
  expect(s.events).toEqual([]);
});

it.each([
  { name: "trashed target", row: postRow({ ...scoped, kind: "page", deletedAt: NOW }), expectedVersion: 4,
    message: "post 'page' is in the trash at this destination — restore it before publishing over it" },
  { name: "different kind", row: postRow(scoped), expectedVersion: 4,
    message: "post 'page' is a 'post' at this destination but a 'page' at the source — kind is fixed at creation" },
  { name: "live slug clash", row: postRow({ id: "other", slug: "about" }), expectedVersion: undefined, message: "slug 'about' already exists" },
  { name: "trashed slug clash", row: postRow({ id: "discarded", slug: "about", deletedAt: NOW }), expectedVersion: undefined, message: "slug 'about' already exists" },
])("does not modify either row on $name", async ({ row, expectedVersion, message }) => {
  const s = setup([row]);
  const hook = vi.fn<BeforeSaveHookPort>(async () => ({}));
  await assert.rejects(s.run({ expectedVersion }, hook), { constructor: PostConflictError, message });
  expect(hook).not.toHaveBeenCalled();
  expect(await s.repo.list({ workspaceId: WORKSPACE })).toEqual([row]);
  expect(await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: "page" })).toEqual([]);
  expect(s.events).toEqual([]);
});

it("refuses a versioned import whose destination disappeared", async () => {
  const s = setup();
  await assert.rejects(s.run({ expectedVersion: 4 }), { constructor: PostNotFoundError, message: "post 'page' was not found" });
  expect(await s.repo.findById(scoped)).toBeNull();
  expect(s.events).toEqual([]);
});

it("preserves a newer save that landed while an import hook was running", async () => {
  const original = postRow({ ...scoped, slug: "about", kind: "page" });
  const newer = { ...original, version: 5, title: "Human edit" };
  const s = setup([original]);
  const result = s.run({ expectedVersion: 4 }, async () => { await s.repo.save(newer); return {}; });
  await expect(result).rejects.toBeInstanceOf(PostVersionConflictError);
  await expect(result).rejects.toMatchObject({
    expectedVersion: 4, currentVersion: 5, message: "post 'page' was modified by another save (expected version 4, current version 5)",
  });
  expect(await s.repo.findById(scoped)).toEqual(newer);
  expect(await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: "page" })).toEqual([]);
  expect(s.events).toEqual([]);
});

it("aborts an import when a plugin refuses and rolls back the row and revision when enqueue fails", async () => {
  const s = setup();
  const refusal = new Error("destination rejects import");
  await expect(s.run({}, async () => { throw refusal; })).rejects.toBe(refusal);
  expect(await s.repo.findById(scoped)).toBeNull();
  expect(s.events).toEqual([]);
  const unavailable = new Error("outbox not writable");
  s.deps.outbox.enqueue = async () => { throw unavailable; };
  await expect(s.run()).rejects.toBe(unavailable);
  expect(await s.repo.findById(scoped)).toBeNull();
  expect(await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: "page" })).toEqual([]);
});
