import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { expect, it, vi } from "vitest";
import { createPost, type CreatePostInput, type PostAuthorAccountPort } from "../post-create.js";
import { updatePost, type UpdatePostInput } from "../post-update.js";
import { EMAIL_TEMPLATE_KIND, type PostRecord } from "../post.js";
import { PostNotFoundError, PostValidationError, PostVersionConflictError } from "@jini-ai/cms/posts/post";
import type { BeforeSaveHookPort } from "../post-before-save.js";
import { NOW, WORKSPACE, postClock, postRepo, postRow, recordingPostOutbox } from "./post-coverage.fixture.js";

const scope = { workspaceId: WORKSPACE, id: "post-id" };
const original = postRow();
function setup(rows: PostRecord[] = []) {
  const repo = postRepo(rows);
  const { events, outbox } = recordingPostOutbox();
  const deps = { repo, clock: postClock, outbox, reservedSegments: new Set(["admin"]), postPublicPath: ({ slug }: { slug: string }) => `/journal/${slug}`, isDeepStrictEqual };
  return { deps, repo, events };
}
const createInput = { ...scope, title: "New article" };
const updateInput: UpdatePostInput = { ...scope, title: "New title", slug: original.slug, bodyJson: original.bodyJson, status: "draft", expectedVersion: 4 };

it.each([
  { field: "bodyJson", value: [1, 2], message: "bodyJson must be a JSON object" },
  { field: "status", value: "scheduled", message: "status must be 'draft' or 'published'" },
])("create refuses invalid $field before slug checks or side effects", async ({ field, value, message }) => {
  const s = setup();
  const findBySlug = vi.spyOn(s.repo, "findBySlug");
  const beforeSaveHook = vi.fn<BeforeSaveHookPort>(async () => ({}));
  const input = { ...createInput, [field]: value } as CreatePostInput;
  await assert.rejects(createPost({ deps: { ...s.deps, beforeSaveHook }, input }), { constructor: PostValidationError, message });
  expect(findBySlug).not.toHaveBeenCalled();
  expect(beforeSaveHook).not.toHaveBeenCalled();
  expect(await s.repo.findById(scope)).toBeNull();
  expect(s.events).toEqual([]);
});

it("uses a scoped account for the default credit but never replaces an explicit author or clear", async () => {
  const s = setup();
  const findByPrincipalId = vi.fn<PostAuthorAccountPort["findByPrincipalId"]>(async ({ workspaceId, principalId }) =>
    workspaceId === WORKSPACE && principalId === "editor" ? { username: "  account-name  " } : null);
  const deps = { ...s.deps, authorAccounts: { findByPrincipalId } };
  const create = (input: Partial<CreatePostInput>) => createPost({ deps, input: { ...createInput, ...input } });
  const expected = [
    { id: "post-id", author: "account-name", showAuthor: true },
    { id: "custom", author: "Guest editor", showAuthor: false },
    { id: "clear", author: null, showAuthor: false },
    { id: "anon", author: null, showAuthor: false },
    { id: "missing-account", author: null, showAuthor: false },
  ];
  await create({ actorId: "editor", showAuthor: true });
  await create({ id: "custom", actorId: "editor", author: " Guest editor ", showAuthor: false });
  await create({ id: "clear", actorId: "editor", author: null });
  await create({ id: "anon" });
  await create({ id: "missing-account", actorId: "missing" });
  expect(findByPrincipalId.mock.calls).toEqual([
    [{ workspaceId: WORKSPACE, principalId: "editor" }], [{ workspaceId: WORKSPACE, principalId: "missing" }],
  ]);
  expect((await s.repo.list({ workspaceId: WORKSPACE })).map(({ id, author, showAuthor }) => ({ id, author, showAuthor }))).toEqual(expected);
});

it.each([
  { field: "bodyJson", value: null, message: "bodyJson must be a JSON object" },
  { field: "status", value: "scheduled", message: "status must be 'draft' or 'published'" },
])("update refuses invalid $field without calling the hook or persisting the change", async ({ field, value, message }) => {
  const s = setup([original]);
  const beforeSaveHook = vi.fn<BeforeSaveHookPort>(async () => ({}));
  const input = { ...updateInput, [field]: value } as UpdatePostInput;
  await assert.rejects(updatePost({ deps: { ...s.deps, beforeSaveHook }, input }), { constructor: PostValidationError, message });
  expect(beforeSaveHook).not.toHaveBeenCalled();
  expect(await s.repo.findById(scope)).toEqual(original);
  expect(await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: original.id })).toEqual([]);
  expect(s.events).toEqual([]);
});

it.each([
  { name: "absent", row: null }, { name: "trashed", row: postRow({ deletedAt: NOW }) },
  { name: "internal template", row: postRow({ kind: EMAIL_TEMPLATE_KIND }) },
])("does not allow editing a $name record even with an expected version", async ({ row }) => {
  const s = setup(row ? [row] : []);
  await assert.rejects(updatePost({ deps: s.deps, input: updateInput }), { constructor: PostNotFoundError, message: "post 'post-id' was not found" });
  expect(await s.repo.list({ workspaceId: WORKSPACE })).toEqual(row ? [row] : []);
  expect(s.events).toEqual([]);
});

it("rederives a never-published automatic slug and releases the exact trash holder without changing its version", async () => {
  const holder = postRow({ id: "old-holder", slug: "fresh-take", deletedAt: NOW, version: 8 });
  const s = setup([original, holder, postRow({ id: "blocker", slug: "fresh-take-trashed" })]);
  const result = await updatePost({ deps: s.deps, input: { ...updateInput, title: "Fresh Take", slugFromTitle: true } });
  const expected = { ...original, title: "Fresh Take", slug: "fresh-take", version: 5, updatedAt: NOW };
  expect(result).toEqual({ post: expected, revisionId: "revision-1", previousRevisionId: null });
  expect(await s.repo.findById(scope)).toEqual(expected);
  expect(await s.repo.findById({ workspaceId: WORKSPACE, id: holder.id })).toEqual({ ...holder, slug: "fresh-take-trashed-2" });
  expect(await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: original.id })).toMatchObject([{ op: "update", seq: 5, stateJson: expected }]);
  expect(s.events.map(event => event.id)).toEqual(["post-id-content.saved-5"]);
});

it.each([
  { name: "previously published", post: original, publishedRevision: true },
  { name: "manually chosen", post: postRow({ slug: "hand-picked" }), publishedRevision: false },
  { name: "page", post: postRow({ kind: "page" }), publishedRevision: false },
])("keeps a $name slug when the title changes", async ({ post, publishedRevision }) => {
  const s = setup([post]);
  if (publishedRevision) await s.repo.appendRevision({ workspaceId: WORKSPACE, postId: post.id, seq: 3, op: "update",
    stateJson: { ...post, status: "published", version: 3 }, actorId: "author", recordedAt: post.updatedAt });
  await updatePost({ deps: s.deps, input: { ...updateInput, title: "Not a new address", slugFromTitle: true } });
  expect(await s.repo.findById(scope)).toMatchObject({ slug: post.slug, title: "Not a new address", version: 5 });
  expect(await s.repo.findBySlug({ workspaceId: WORKSPACE, slug: "not-a-new-address" })).toBeNull();
});

it("rejects a stale no-op after the hook and keeps the other editor's save and only its revision", async () => {
  const s = setup([original]);
  const input = { ...updateInput, title: original.title };
  const concurrent = { ...input, title: "Other editor's change" };
  const result = updatePost({ deps: { ...s.deps, beforeSaveHook: async () => {
    await updatePost({ deps: s.deps, input: concurrent });
    return {};
  } }, input });
  await expect(result).rejects.toBeInstanceOf(PostVersionConflictError);
  await expect(result).rejects.toMatchObject({ expectedVersion: 4, currentVersion: 5, message: "post 'post-id' was modified by another save (expected version 4, current version 5)" });
  expect(await s.repo.findById(scope)).toMatchObject({ title: "Other editor's change", version: 5 });
  expect(await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: original.id })).toMatchObject([{ op: "update", seq: 5, stateJson: { title: "Other editor's change" } }]);
  expect(s.events.map(event => event.id)).toEqual(["post-id-content.saved-5"]);
});

it("rejects a no-op when the record moves to Trash while its hook is running", async () => {
  const s = setup([original]);
  const result = updatePost({ deps: { ...s.deps, beforeSaveHook: async () => {
    await s.repo.softDelete({ ...scope, version: 5, deletedAt: NOW, updatedAt: NOW });
    return {};
  } }, input: { ...updateInput, title: original.title } });
  await assert.rejects(result, { constructor: PostNotFoundError, message: "post 'post-id' was not found" });
  expect(await s.repo.findById(scope)).toMatchObject({ version: 5, deletedAt: NOW, title: original.title });
  expect(s.events).toEqual([]);
});

it("passes the persisted HTML page placeholder to the hook and preserves its raw body and unrelated metadata", async () => {
  const page = postRow({ kind: "page", bodyFormat: "html", bodyHtml: "<p>Persisted HTML</p>", templateChoice: "old.html", overridesThemePage: true,
    publishAt: "2026-12-01T00:00:00.000Z", featuredMediaId: "old-cover", author: "Old author", showAuthor: true,
    ext: { other: { survives: true }, "post-presentation": { color: "blue", hideCoverImageInBody: true } } });
  const s = setup([page]);
  const beforeSaveHook = vi.fn<BeforeSaveHookPort>(async () => ({ editor: { reviewed: true } }));
  const result = await updatePost({ deps: { ...s.deps, beforeSaveHook }, input: {
    ...updateInput, bodyJson: { type: "doc", content: [{ type: "heading" }] }, author: null, showAuthor: false, publishAt: null,
    featuredMediaId: null, templateChoice: "", overridesThemePage: null, hideCoverImageInBody: false,
  } });
  expect(beforeSaveHook).toHaveBeenCalledExactlyOnceWith({
    ...scope, title: "New title", slug: "default-article", status: "draft", bodyJson: { type: "doc", content: [] }, ext: page.ext,
  });
  const stored = await s.repo.findById(scope);
  expect(stored).toEqual(result.post);
  expect(stored).toMatchObject({
    bodyFormat: "html", bodyHtml: "<p>Persisted HTML</p>", bodyJson: { type: "doc", content: [] }, templateChoice: "", overridesThemePage: null,
    author: null, showAuthor: false, version: 5, ext: { other: { survives: true }, editor: { reviewed: true }, "post-presentation": { color: "blue", hideCoverImageInBody: false } },
  });
  expect(stored).not.toHaveProperty("publishAt");
  expect(stored).not.toHaveProperty("featuredMediaId");
});

it("rolls the post and ledger back if a changed update cannot enqueue its event", async () => {
  const s = setup([original]);
  const failure = new Error("outbox unavailable");
  s.deps.outbox.enqueue = async () => { throw failure; };
  await expect(updatePost({ deps: s.deps, input: updateInput })).rejects.toBe(failure);
  expect(await s.repo.findById(scope)).toEqual(original);
  expect(await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: original.id })).toEqual([]);
});
