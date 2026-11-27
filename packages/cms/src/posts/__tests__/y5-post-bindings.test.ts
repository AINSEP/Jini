import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { bindInMemoryPostRepo } from "../repo.memory.js";
import { createMediaAccessEvidence } from "../../media/site/access-evidence.js";
import { createPostFeaturedImageRefusals } from "../post-tool-policy.js";
import { bindPostPreviewTools, createPostPreviewAgentToolCatalog } from "../preview-tool.js";
import type { PostRecord } from "../post.js";
import type { ToolExecutionContext } from "@jini-ai/core";

const row: PostRecord = { id: "post", workspaceId: "site", title: "Post", slug: "post", kind: "post", status: "draft",
  bodyJson: { type: "doc", content: [] }, bodyFormat: "doc", bodyHtml: null, updatedAt: "2026-11-25T00:00:00.000Z", version: 1 };
const hashJsonText = (text: string) => createHash("sha256").update(text).digest("hex");
const InMemoryPostRepo = bindInMemoryPostRepo({ nowIso: () => "2026-11-25T00:00:00.000Z", newId: () => "revision", hashJsonText, createEvidence: createMediaAccessEvidence });

test("bound memory repos keep independent rows and hash the exact revision JSON text", async () => {
  const a = new InMemoryPostRepo({});
  const b = new InMemoryPostRepo({});
  await a.save(row);
  await a.appendRevision({ workspaceId: "site", postId: "post", seq: 1, op: "create", stateJson: row, actorId: "human", recordedAt: row.updatedAt });
  expect(await b.list({ workspaceId: "site" })).toEqual([]);
  expect(await a.listRevisions({ workspaceId: "site", postId: "post" })).toMatchObject([{ id: "revision", contentHash: hashJsonText(JSON.stringify(row)), stateJson: row }]);
});

test("rollback restores rows, revisions and autosaves and invalidates access evidence on either outcome", async () => {
  const evidence = createMediaAccessEvidence();
  const invalidate = vi.spyOn(evidence, "invalidate");
  const repo = new InMemoryPostRepo({}, { initialRows: [row], mediaAccessEvidence: evidence });
  await expect(repo.transaction({ fn: async () => {
    await repo.writeAutosave({ workspaceId: "site", id: "post", snapshot: { baseVersion: 1 } as never });
    await repo.appendRevision({ workspaceId: "site", postId: "post", seq: 2, op: "update", stateJson: { ...row, version: 2 }, actorId: "human", recordedAt: row.updatedAt });
    await repo.save({ ...row, version: 2 });
    throw new Error("rollback");
  } })).rejects.toThrow("rollback");
  expect(await repo.findById({ workspaceId: "site", id: "post" })).toEqual(row);
  expect(await repo.listRevisions({ workspaceId: "site", postId: "post" })).toEqual([]);
  expect(await repo.readAutosave({ workspaceId: "site", id: "post" })).toBeNull();
  expect(invalidate).toHaveBeenLastCalledWith({ owner: repo });
  invalidate.mockClear();
  await repo.transaction({ fn: async () => {} });
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({ owner: repo });
});

test("memory save and autosave CAS refuse stale versions", async () => {
  const repo = new InMemoryPostRepo({}, { initialRows: [row] });
  expect(await repo.saveIfVersion({ record: { ...row, version: 3 }, ifVersion: 2 })).toEqual({ applied: false });
  expect(await repo.writeAutosave({ workspaceId: "site", id: "post", snapshot: { baseVersion: 2 } as never })).toEqual({ applied: false });
  expect(await repo.findById({ workspaceId: "site", id: "post" })).toEqual(row);
  expect(await repo.readAutosave({ workspaceId: "site", id: "post" })).toBeNull();
});

test("HTML keysets have stable equal-date ordering", async () => {
  const repo = new InMemoryPostRepo({}, { initialRows: ["c", "a", "b"].map(id => ({ ...row, id, bodyFormat: "html", bodyHtml: "<p>Body</p>" })) });
  const first = await repo.listHtmlByKind({ workspaceId: "site", kind: "post", limit: 2 });
  expect(first.map(post => post.id)).toEqual(["a", "b"]);
  expect((await repo.listHtmlByKind({ workspaceId: "site", kind: "post", limit: 2, before: { updatedAt: row.updatedAt, id: "b" } })).map(post => post.id)).toEqual(["c"]);
});

test("featured-image refusals preserve the copy and bind the media read guidance ID", () => {
  const refusals = createPostFeaturedImageRefusals({ mediaAssetReadToolId: "read_media" });
  expect(refusals.missing({ ref: "asset" })).toBe("featuredImage: no media asset has the id or slug 'asset'. Find one with read_media, or upload one first.");
  expect(refusals.trashed({ ref: "asset" })).toBe("featuredImage: media asset 'asset' is in Trash. Restore it first, or pick another image.");
  expect(refusals["not-image"]({ ref: "asset" }, { contentType: "video/mp4" })).toBe("featuredImage: media asset 'asset' is video/mp4, not an image. A featured image must be an image.");
});

test("preview preserves the original host bag for the renderer and template reader", async () => {
  const deps = { workspaceId: "site", authorize: vi.fn(async () => ({ allowed: true, reason: "grant" })),
    postRepo: new InMemoryPostRepo({}, { initialRows: [row] }), hostValue: "kept" };
  type PreviewBinding = Parameters<typeof bindPostPreviewTools>[0];
  type PreviewRenderer = Parameters<ReturnType<typeof bindPostPreviewTools>["buildPostPreviewRegistrations"]>[0]["renderer"];
  // Typed as the production ports: the binding hands the renderer and template reader the host's own bag (asserted by identity below).
  const readPostTemplateOptions = vi.fn<PreviewBinding["readPostTemplateOptions"]>(async () => ["template"]);
  const renderer = { renderPostPreview: vi.fn<PreviewRenderer["renderPostPreview"]>(async () => ({ html: "<p>Preview</p>", templateChoice: null })) };
  const binding = bindPostPreviewTools({ catalog: createPostPreviewAgentToolCatalog({ fetchPublishedPageToolId: "local_page", fetchLiveUrlToolId: "live_page" }),
    readPageBodyOptions: () => ({}), shapePageBody: ({ body }) => ({ body, bodyBytes: body.length, truncated: false }), readPostTemplateOptions, readPermission: "content.read", contentPostReadToolId: "content_read.content_post" });
  const [tool] = binding.buildPostPreviewRegistrations({ deps, renderer });
  const ctx: ToolExecutionContext = { executionId: "e", run: { id: "run" }, principal: { id: "human" }, signal: new AbortController().signal, input: { postId: "post" } };
  expect(await tool!.handler(ctx)).toMatchObject({ postId: "post", availableTemplates: ["template"], body: "<p>Preview</p>" });
  expect(renderer.renderPostPreview.mock.calls[0]?.[0].deps).toBe(deps);
  expect(readPostTemplateOptions.mock.calls[0]?.[0]).toEqual({ deps, kind: "post" });
  expect(readPostTemplateOptions.mock.calls[0]?.[0].deps).toBe(deps);
  await expect(tool!.handler({ ...ctx, input: { id: "post", bodyHtml: 8 } })).rejects.toThrow("bodyHtml must be a string");
  expect(renderer.renderPostPreview).toHaveBeenCalledTimes(1);
  await expect(tool!.handler({ ...ctx, input: { id: "missing" } })).rejects.toThrow("content_read.content_post");
  deps.authorize.mockResolvedValue({ allowed: false, reason: "denied" });
  const find = vi.spyOn(deps.postRepo, "findById");
  await expect(tool!.handler(ctx)).rejects.toThrow("not authorized");
  expect(find).not.toHaveBeenCalled();
});

test("soft delete keeps the slug and updates only the scoped row's trash metadata", async () => {
  const other = { ...row, workspaceId: "other", title: "Other site" };
  const repo = new InMemoryPostRepo({}, { initialRows: [other, row] });
  const change = { workspaceId: "site", id: "post", deletedAt: "2026-11-26T00:00:00.000Z", updatedAt: "2026-11-26T00:01:00.000Z", version: 2 };
  await repo.softDelete({ ...change, workspaceId: "missing" });
  expect(await repo.list({ workspaceId: "site" })).toEqual([row]);
  await repo.softDelete(change);
  expect(await repo.findBySlug({ workspaceId: "site", slug: "post" })).toEqual({
    ...row, deletedAt: change.deletedAt, updatedAt: change.updatedAt, version: 2,
  });
  expect(await repo.findBySlug({ workspaceId: "other", slug: "post" })).toEqual(other);
});

test("hard delete drops the scoped post, autosave and revisions without touching another workspace", async () => {
  const other = { ...row, workspaceId: "other", title: "Other site" };
  const repo = new InMemoryPostRepo({}, { initialRows: [row, other] });
  const snapshot = { baseVersion: 1, bodyFormat: "doc" as const, bodyJson: { type: "doc" }, title: "Parked", slug: "post", savedAt: row.updatedAt, savedByPrincipalId: "editor" };
  for (const record of [row, other]) {
    const { workspaceId, id } = record;
    expect(await repo.writeAutosave({ workspaceId, id, snapshot })).toEqual({ applied: true });
    await repo.appendRevision({ workspaceId, postId: id, seq: 1, op: "create", stateJson: record, actorId: "editor", recordedAt: row.updatedAt });
  }
  expect(await repo.readAutosave({ workspaceId: "site", id: "post" })).toEqual(snapshot);
  expect(await repo.listRevisions({ workspaceId: "site", postId: "post" })).toMatchObject([{ seq: 1, stateJson: row }]);
  await repo.hardDelete({ workspaceId: "site", id: "post" });
  expect(await repo.findById({ workspaceId: "site", id: "post" })).toBeNull();
  expect(await repo.readAutosave({ workspaceId: "site", id: "post" })).toBeNull();
  expect(await repo.listRevisions({ workspaceId: "site", postId: "post" })).toEqual([]);
  expect(await repo.findById({ workspaceId: "other", id: "post" })).toEqual(other);
  expect(await repo.listRevisions({ workspaceId: "other", postId: "post" })).toMatchObject([{ seq: 1, stateJson: other }]);
  expect(await repo.readAutosave({ workspaceId: "other", id: "post" })).toEqual(snapshot);
  await repo.clearAutosave({ workspaceId: "other", id: "post" });
  expect(await repo.readAutosave({ workspaceId: "other", id: "post" })).toBeNull();
  expect(await repo.findById({ workspaceId: "other", id: "post" })).toEqual(other);
});

test("HTML listing filters format, trash, kind and site before using the date and id cursor", async () => {
  const page: PostRecord = { ...row, kind: "page", bodyFormat: "html", bodyHtml: "<p>Page</p>" };
  const repo = new InMemoryPostRepo({}, { initialRows: [
    { ...page, id: "before-id" }, { ...page, id: "cursor" }, { ...page, id: "later-id" },
    { ...page, id: "older", updatedAt: "2026-10-01T00:00:00.000Z" },
    { ...page, id: "newer", updatedAt: "2026-11-26T00:00:00.000Z" },
    { ...page, id: "doc", bodyFormat: "doc" }, { ...page, id: "no-html", bodyHtml: null },
    { ...page, id: "trashed", deletedAt: page.updatedAt },
    { ...page, id: "other-site", workspaceId: "other" }, { ...page, id: "post", kind: "post" },
  ] });
  expect((await repo.listHtmlByKind({ workspaceId: "site", kind: "page", limit: 8,
    before: { updatedAt: page.updatedAt, id: "cursor" },
  })).map(({ id }) => id)).toEqual(["later-id", "older"]);
});

test("revision history reads in version order and keeps recorded restore and delegation fields", async () => {
  let nextId = 0;
  const Repo = bindInMemoryPostRepo({ nowIso: () => row.updatedAt, newId: () => `revision-${++nextId}`, hashJsonText,
    createEvidence: createMediaAccessEvidence });
  const repo = new Repo({}, { initialRows: [row] });
  const revision = { postId: "post", workspaceId: "site", stateJson: row, actorId: "writer", recordedAt: row.updatedAt };
  const first = await repo.appendRevision({ ...revision, seq: 1, op: "create" });
  await repo.appendRevision({ ...revision, seq: 3, op: "restore", restoredFrom: first.id, delegatedByWorkspaceId: "site",
    delegatedById: "human", stateJson: { ...row, version: 3 } });
  await repo.appendRevision({ ...revision, seq: 2, op: "update", stateJson: { ...row, version: 2 } });
  const history = await repo.listRevisions({ workspaceId: "site", postId: "post" });
  expect(history).toMatchObject([
    { seq: 1, op: "create", restoredFrom: null, delegatedByWorkspaceId: null, delegatedById: null },
    { seq: 2, op: "update", stateJson: { id: "post", version: 2 } },
    { seq: 3, op: "restore", restoredFrom: "revision-1", delegatedByWorkspaceId: "site", delegatedById: "human",
      stateJson: { id: "post", version: 3 } },
  ]);
});
