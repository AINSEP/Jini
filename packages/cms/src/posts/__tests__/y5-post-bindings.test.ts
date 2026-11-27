import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { bindInMemoryPostRepo } from "../repo.memory.js";
import { createMediaAccessEvidence } from "../../media/site/access-evidence.js";
import { createPostFeaturedImageRefusals } from "../post-tool-policy.js";
import { bindPostPreviewTools, contributePostPreviewTools, createPostPreviewAgentToolCatalog } from "../preview-tool.js";
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

function contributedPreview() {
  const saved = { ...row, slug: "welcome-guide" };
  const deps = { workspaceId: "site", authorize: async () => ({ allowed: true, reason: "editor" }),
    postRepo: new InMemoryPostRepo({}, { initialRows: [saved] }) };
  type Renderer = Parameters<ReturnType<typeof bindPostPreviewTools>["contributePostPreviewTools"]>[0];
  const renderPostPreview = vi.fn<Renderer["renderPostPreview"]>(async ({ input }) => ({
    html: input.bodyHtml ?? "<p>Saved preview</p>", templateChoice: input.templateChoice ?? null,
  }));
  const binding = bindPostPreviewTools({
    catalog: createPostPreviewAgentToolCatalog({ fetchPublishedPageToolId: "page.local", fetchLiveUrlToolId: "page.live" }),
    readPageBodyOptions: ({ input }) => input.textOnly === true ? { textOnly: true } : {},
    shapePageBody: ({ body }, options) => ({ body: options?.textOnly ? body.replace(/<[^>]+>/g, "") : body, bodyBytes: body.length, truncated: false }),
    readPostTemplateOptions: async ({ kind }) => kind === "page" ? ["page.html"] : ["post.html"],
    readPermission: "content.read", contentPostReadToolId: "post.find",
  });
  const contributor = binding.contributePostPreviewTools({ renderPostPreview });
  expect(contributor.domain).toBe("post-preview");
  expect(contributor.risk?.get("content_post_preview")).toBe("none");
  const [tool] = contributor.build(deps, {});
  if (!tool) throw new Error("Missing preview registration");
  const invoke = (input: unknown) => tool.handler({ executionId: "e", run: { id: "run" }, principal: { id: "human" }, signal: new AbortController().signal, input });
  return { saved, deps, invoke, renderPostPreview };
}

it("contributes preview with unsaved overrides and forwards shaping options without saving the draft", async () => {
  const { saved, deps, invoke, renderPostPreview } = contributedPreview();
  const bodyJson = { type: "doc", content: [{ type: "paragraph" }] };
  const bodyHtml = "<p>Unsaved copy</p>";
  expect(await invoke({ id: "post", postId: "wrong", bodyJson, bodyHtml, templateChoice: "", textOnly: true })).toEqual({
    postId: "post", title: "Post", status: "draft", templateChoice: "", availableTemplates: ["post.html"],
    body: "Unsaved copy", bodyBytes: 19, truncated: false,
  });
  expect(renderPostPreview).toHaveBeenCalledExactlyOnceWith({ deps, input: { post: saved, bodyJson, bodyHtml, templateChoice: "" } });
  expect(await deps.postRepo.findById({ workspaceId: "site", id: "post" })).toEqual(saved);
});

it.each([
  { input: { id: " ", postId: "post" }, message: "content_post_preview: id must be a non-empty id or slug (postId is a legacy alias)." },
  { input: { id: "post", bodyJson: null }, message: "content_post_preview: bodyJson must be a JSON object." },
  { input: { id: "post", bodyJson: [] }, message: "content_post_preview: bodyJson must be a JSON object." },
  { input: { id: "post", bodyJson: "text" }, message: "content_post_preview: bodyJson must be a JSON object." },
  { input: { id: "post", templateChoice: 3 }, message: "content_post_preview: templateChoice must be a string." },
])("refuses malformed preview input $input before loading the row", async ({ input, message }) => {
  const { deps, invoke, renderPostPreview } = contributedPreview();
  const find = vi.spyOn(deps.postRepo, "findById");
  await expect(invoke(input)).rejects.toMatchObject({ name: "ToolInputError", message });
  expect(find).not.toHaveBeenCalled();
  expect(renderPostPreview).not.toHaveBeenCalled();
});

it("propagates a storage failure instead of claiming the preview target is missing", async () => {
  const { deps, invoke, renderPostPreview } = contributedPreview();
  const failure = new Error("storage disconnected");
  vi.spyOn(deps.postRepo, "findById").mockRejectedValueOnce(failure);
  await expect(invoke({ id: "post" })).rejects.toBe(failure);
  expect(renderPostPreview).not.toHaveBeenCalled();
});

it("previews a post by the slug advertised in the tool schema", async () => {
  const { invoke, saved, renderPostPreview, deps } = contributedPreview();
  expect(await invoke({ id: "welcome-guide" })).toEqual({
    postId: "post", title: "Post", status: "draft", templateChoice: null, availableTemplates: ["post.html"],
    body: "<p>Saved preview</p>", bodyBytes: 20, truncated: false,
  });
  expect(renderPostPreview).toHaveBeenCalledExactlyOnceWith({ deps, input: { post: saved } });
});

test("featured image refusal has caller guidance even when the type is unavailable", () => {
  const refusals = createPostFeaturedImageRefusals({ mediaAssetReadToolId: "media.find" });
  expect(refusals["not-image"]({ ref: "asset" })).toBe("featuredImage: media asset 'asset' is not an image, not an image. A featured image must be an image.");
});

test("the standalone preview contribution retains the legacy selector and uses the injected read scope", async () => {
  const repo = new InMemoryPostRepo({}, { initialRows: [row] });
  const renderPostPreview = vi.fn<Parameters<typeof contributePostPreviewTools>[0]["renderPostPreview"]>(async ({ input }) => {
    if (input.post.id !== "post") throw new Error("wrong render target");
    return { html: "<p>Preview</p>", templateChoice: "post.html" };
  });
  const contributor = contributePostPreviewTools({ renderPostPreview });
  const authorize = vi.fn(async () => ({ allowed: true, reason: "grant" }));
  const deps = {
    workspaceId: "site", postRepo: repo, authorize, readPermission: "article.inspect",
    catalog: createPostPreviewAgentToolCatalog({ fetchPublishedPageToolId: "page.local", fetchLiveUrlToolId: "page.live" }),
    readPageBodyOptions: () => ({ maxBytes: 40 }),
    shapePageBody: ({ body }: { body: string }) => ({ body, bodyBytes: body.length, truncated: false }),
    readPostTemplateOptions: async () => ["post.html"],
    missingPostMessage: (id: string) => `Missing article ${id}`,
  } satisfies Parameters<typeof contributor.build>[0];
  const [tool] = contributor.build(deps, {});
  if (!tool) throw new Error("Missing preview registration");
  expect(await tool.handler({ executionId: "e", run: { id: "run" }, principal: { id: "reader" }, signal: new AbortController().signal, input: { postId: "post" } }))
    .toEqual({ postId: "post", title: "Post", status: "draft", templateChoice: "post.html", availableTemplates: ["post.html"], body: "<p>Preview</p>", bodyBytes: 14, truncated: false });
  expect(authorize).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", principalId: "reader", permission: "article.inspect", entityType: "post" });
  expect(renderPostPreview).toHaveBeenCalledExactlyOnceWith({ deps, input: { post: row } });
});
