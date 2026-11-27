import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { expect, test, vi } from "vitest";
import { type ToolExecutionContext, type ToolHandler } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { InMemoryChangeSetRepo } from "../../core/commands/repo.memory.js";
import { executeCommand } from "../../core/commands/index.js";
import { InMemoryEventBus } from "../../forms/__tests__/eventing.fixture.js";
import { createMediaAccessEvidence } from "../../media/site/access-evidence.js";
import { copyBodyJsonWithFreshEmbedPlacements } from "../../widgets/duplicate-embeds.js";
import { createPostAgentToolCatalog } from "../agent-tools.js";
import type { PostRecord } from "../post.js";
import type { PostToolDeps } from "../post-tool-deps.js";
import { createPostFeaturedImageRefusals } from "../post-tool-policy.js";
import { bindInMemoryPostRepo } from "../repo.memory.js";
import { contributePostTools, createPostToolPost, deletePostToolPost } from "../tool-registrations.js";
import { updatePostToolPost } from "../tool-registrations.update.js";

const now = "2026-11-26T00:00:00.000Z";
const key = { workspaceId: "site", id: "story" };
const row: PostRecord = { ...key, title: "Story", slug: "story", kind: "post", status: "draft", version: 4, updatedAt: now,
  bodyFormat: "doc", bodyHtml: null, bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original prose" }] }] } };
const catalog = createPostAgentToolCatalog({
  editGuidance: "Use the editors.", featuredImageSchema: { type: ["string", "null"], description: "Cover reference" },
  postIdSchema: { type: "string" }, tiptapDocSchema: { type: "object", description: "Document" },
  copy: { contentPostRead: "cms.read", navigate: "browser.go", menuRead: "menus.read", updateMenuTree: "menus.write",
    fetchPublishedPage: "page.fetch", postPreview: "post.preview", trashRestoreItem: "trash.restore" },
});
const surfaces: AssistantSurfaceDeps = {
  surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: vi.fn() },
};

function ctx(input: unknown, signal = new AbortController().signal): ToolExecutionContext {
  return { executionId: "exec", run: { id: "run" }, principal: { id: "editor" }, input, signal };
}

function fixture(rows: PostRecord[] = [row]) {
  let next = 0;
  const Repo = bindInMemoryPostRepo({ nowIso: () => now, newId: () => `revision-${++next}`,
    hashJsonText: (value) => createHash("sha256").update(value).digest("hex"), createEvidence: createMediaAccessEvidence });
  const postRepo = new Repo({}, { initialRows: rows });
  const outbox: PostToolDeps["outbox"] = { enqueue: vi.fn(async () => {}), claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} };
  const changeSets = new InMemoryChangeSetRepo([], [], outbox);
  const authorize = vi.fn<PostToolDeps["authorize"]>(async ({ principalId, workspaceId, permission }) => ({
    allowed: principalId === "editor" && workspaceId === "site" && ["content.read", "content.write"].includes(permission),
    reason: "fixture grant",
  }));
  const readPostTemplateOptions = vi.fn<PostToolDeps["readPostTemplateOptions"]>(async () => ["profile.html"]);
  const processOutbox = vi.fn<PostToolDeps["processOutbox"]>(async () => undefined);
  const postSearch = { search: vi.fn<PostToolDeps["postSearch"]["search"]>(async () => []) };
  const trash = new Set<string>();
  const forgetRemovedPost = vi.fn<PostToolDeps["forgetRemovedPost"]>(async ({ workspaceId, id }) => { trash.delete(`${workspaceId}:${id}`); });
  const removePost = vi.fn<PostToolDeps["removePost"]>(async ({ workspaceId, id, at, expectedVersion }) => {
    const existing = await postRepo.findById({ workspaceId, id });
    if (!existing) return { ok: false, reason: "not-found" };
    if (existing.version !== expectedVersion) return { ok: false, reason: "version-changed" };
    const version = existing.version + 1;
    await postRepo.softDelete({ workspaceId, id, deletedAt: at, updatedAt: at, version });
    trash.add(`${workspaceId}:${id}`);
    return { ok: true, version };
  });
  const deps: PostToolDeps = {
    copyBodyJsonWithFreshEmbedPlacements, reservedSegments: new Set(), postPublicPath: ({ slug }) => `/blog/${slug}`, isDeepStrictEqual,
    contentReadPermission: "content.read", contentWritePermission: "content.write", contentPostReadToolId: "cms.read",
    assistantActorPluginId: "assistant", catalog: new Map(catalog.map(definition => [definition.name, definition])),
    executeCommand, processOutbox, withPluginHookRefusals: ({ handlers }) => handlers,
    postToolViewDeps: () => ({
      workspaceId: "site", entryPublicPath: ({ post }) => post.status === "published" ? { path: `/${post.slug}`, canonicalUrl: `https://example.test/${post.slug}` } : null,
      runtimeMode: () => "local", publishedWhere: { live: "Live site", local: "Local draft site" },
    }),
    headerNavigationView: ({ kind }) => ({ navKind: kind }),
    readPostTemplateOptions, findMediaByIdOrSlug: async () => { throw new Error("unexpected media lookup"); },
    featuredImageRefusals: createPostFeaturedImageRefusals({ mediaAssetReadToolId: "media.read" }),
    authorize, workspaceId: "site", clock: { nowMs: () => Date.parse(now) }, idGen: { newId: () => `id-${++next}` },
    changeSets, outbox, bus: new InMemoryEventBus(), postRepo, postSearch,
    pluginBeforeSaveHook: async () => ({}), slugChangeCapture: () => undefined, removePost, forgetRemovedPost,
  };
  const call = (name: string, input: unknown) => {
    const handler: ToolHandler = contributePostTools().build(deps, surfaces).find(({ descriptor }) => descriptor.id === name)!.handler;
    return handler(ctx(input));
  };
  return { deps, postRepo, authorize, postSearch, changeSets, processOutbox, removePost, forgetRemovedPost, trash, readPostTemplateOptions, call };
}

test("registered search authorizes the workspace and returns only ranked summaries", async () => {
  const f = fixture();
  const hit = { id: "a", kind: "page" as const, title: "Café", slug: "coffee", status: "published" as const, updatedAt: now, snippet: "Opening hours.", score: 0.9 };
  f.postSearch.search.mockResolvedValueOnce([hit]);
  expect(await f.call("content_post_search", { query: "CAFÉ", status: "published", kind: "page", limit: 3 })).toEqual({ hits: [hit] });
  expect(f.authorize).toHaveBeenCalledExactlyOnceWith({ principalId: "editor", workspaceId: "site", permission: "content.read", entityType: "post" });
  expect(f.postSearch.search).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", terms: ["café"], kind: "page", status: "published", limit: 3 });
  f.authorize.mockResolvedValueOnce({ allowed: false, reason: "no grant" });
  await expect(f.call("content_post_search", { query: "CAFÉ" })).rejects.toThrow("not authorized");
  expect(f.postSearch.search).toHaveBeenCalledTimes(1);
});

test("registered get enforces page kind while the default get exposes the actual article body and admin link", async () => {
  const f = fixture();
  expect(await f.call("content_post_get", { id: "story" })).toMatchObject({
    post: { id: "story", title: "Story", bodyJson: row.bodyJson, publicUrl: null, adminUrl: "/admin/posts/story" },
  });
  await expect(f.call("content_post_get", { id: "story", kind: "page" })).rejects.toThrow("page 'story' was not found");
  expect(f.authorize.mock.calls).toEqual([
    [{ principalId: "editor", workspaceId: "site", permission: "content.read", entityType: "post", entityId: "story" }],
    [{ principalId: "editor", workspaceId: "site", permission: "content.read", entityType: "post", entityId: "story" }],
  ]);
});

test("registered listing filters before the cap and supports compact, body and explicit field projections", async () => {
  const f = fixture([
    { ...row, id: "no-match", title: "Budget", slug: "budget", status: "published" },
    { ...row, id: "hidden", title: "Story", deletedAt: now, status: "published" },
    { ...row, id: "matching", title: "Matching Story", slug: "article", status: "published" },
    { ...row, id: "second", title: "Second Story", slug: "second", status: "published", kind: "page" }, row,
  ]);
  expect(await f.call("content_post_list", { query: "STORY", status: "published", limit: 1, fields: "title,slug", includeBody: true }))
    .toEqual({ posts: [{ id: "matching", title: "Matching Story", slug: "article" }], total: 2, hasMore: true });
  expect(await f.call("content_post_list", { status: "draft", includeBody: true }))
    .toMatchObject({ total: 1, hasMore: false, posts: [{ id: "story", bodyJson: row.bodyJson }] });
  const compact = await f.call("content_post_list", { status: "draft" });
  expect(compact).toMatchObject({ posts: [{ id: "story", excerpt: "Original prose", bodyChars: 14 }], total: 1, hasMore: false });
  expect(compact).not.toHaveProperty("posts.0.bodyJson");
});

test("registered create persists agent attribution, normalized byline and an audited first revision", async () => {
  const f = fixture([]);
  const result = await f.call("content_post_create", { title: "First story", slug: "first-story", author: "  Guest  ", showAuthor: true, bodyJson: row.bodyJson });
  expect(result).toMatchObject({ navKind: "post", post: { id: "id-1", slug: "first-story", version: 1, status: "draft",
    author: "Guest", showAuthor: true, publicUrl: null, adminUrl: "/admin/posts/id-1" } });
  expect(await f.postRepo.findById({ workspaceId: "site", id: "id-1" })).toMatchObject({
    title: "First story", bodyJson: row.bodyJson, createdByKind: "agent", createdByPrincipalId: "editor", author: "Guest", showAuthor: true,
  });
  expect(await f.postRepo.listRevisions({ workspaceId: "site", postId: "id-1" }))
    .toMatchObject([{ seq: 1, op: "create", actorId: "editor", delegatedByWorkspaceId: "site", delegatedById: "editor" }]);
  const [changeSet] = await f.changeSets.listByWorkspace({ workspaceId: "site" });
  expect(await f.changeSets.findById({ workspaceId: "site", id: changeSet!.id })).toMatchObject({
    changeSet: { actor: { id: "editor", kind: "agent" } }, items: [{ operation: "create", entityId: "id-1", entityVersionAtApply: 1 }],
  });
  expect(f.processOutbox).toHaveBeenCalledExactlyOnceWith({ outbox: f.deps.outbox, bus: f.deps.bus, clock: f.deps.clock });
});

test("partial update merges against a guarded version and saves a template pre-image for undo", async () => {
  const f = fixture([{ ...row, templateChoice: "old.html" }]);
  const cas = vi.spyOn(f.postRepo, "saveIfVersion");
  try {
    expect(await f.call("content_post_update", { id: "story", title: "Revised", template: "profile.html" }))
      .toMatchObject({ post: { id: "story", title: "Revised", slug: "story", bodyJson: row.bodyJson, template: "profile.html", version: 5 } });
    expect(cas.mock.calls.map(([request]) => request.ifVersion)).toEqual([4]);
    expect(f.readPostTemplateOptions).toHaveBeenCalledExactlyOnceWith({ deps: f.deps, kind: "post" });
    expect(await f.postRepo.findById(key)).toMatchObject({ title: "Revised", status: "draft", templateChoice: "profile.html", version: 5 });
    const [change] = await f.changeSets.listByWorkspace({ workspaceId: "site" });
    expect(await f.changeSets.findById({ workspaceId: "site", id: change!.id })).toMatchObject({
      items: [{ operation: "update", entityId: "story", entityVersionAtApply: 5, inversePayload: {
        title: "Story", slug: "story", bodyJson: row.bodyJson, status: "draft", templateChoice: "old.html",
        publishAt: null, featuredMediaId: null, author: null, showAuthor: false,
      } }],
    });
    await expect(f.call("content_post_update", { id: "story", title: "Stale", expectedVersion: 4 })).rejects.toThrow("VERSION_CONFLICT");
    expect((await f.postRepo.findById(key))?.title).toBe("Revised");
    expect(f.processOutbox).toHaveBeenCalledTimes(1);
  } finally { cas.mockRestore(); }
});

test("full updates without an expected version keep last-write-wins and failed schema or HTML edits write nothing", async () => {
  const page: PostRecord = { ...row, id: "page", slug: "page", kind: "page", bodyFormat: "html", bodyHtml: "<p>Authored HTML</p>" };
  const f = fixture([row, page]);
  const cas = vi.spyOn(f.postRepo, "saveIfVersion");
  try {
    await expect(updatePostToolPost({ routeDeps: f.deps, ctx: ctx({ id: "page", bodyJson: { type: "doc" } }) }))
      .rejects.toThrow("CONTENT_POST_HTML_BODY: page 'page' is a bespoke-HTML page");
    await expect(updatePostToolPost({ routeDeps: f.deps, ctx: ctx({ id: "story", title: "New", expectedVersion: -1 }) }))
      .rejects.toThrow("'expectedVersion' must be a non-negative integer when present");
    await expect(updatePostToolPost({ routeDeps: f.deps, ctx: ctx({ id: "story" }) })).rejects.toThrow("send at least one");
    expect(await f.postRepo.findById({ workspaceId: "site", id: "page" })).toEqual(page);
    expect(await f.postRepo.findById(key)).toEqual(row);
    expect(await f.changeSets.listByWorkspace({ workspaceId: "site" })).toEqual([]);
    await f.call("content_post_update", { id: "story", kind: "post", title: "Full replacement", slug: "new",
      bodyJson: { type: "doc", content: [] }, status: "draft" });
    expect(cas).not.toHaveBeenCalled();
    expect(await f.postRepo.findById(key)).toMatchObject({ title: "Full replacement", slug: "new", version: 5 });
  } finally { cas.mockRestore(); }
});

test("registered delete parks the scoped row, records its inverse, and rejects a second deletion", async () => {
  const f = fixture();
  expect(await f.call("content_post_delete", { id: "story" })).toMatchObject({
    deleted: true, cancelled: false, post: { id: "story", title: "Story", version: 5 },
  });
  expect(await f.postRepo.findById(key)).toMatchObject({ deletedAt: now, title: "Story", version: 5 });
  expect(f.trash.has("site:story")).toBe(true);
  expect(f.removePost).toHaveBeenCalledExactlyOnceWith({ ...key, display: { title: "Story", subtitle: "story" },
    at: now, expectedVersion: 4, actor: { principalId: "editor", pluginId: "assistant" } });
  const [change] = await f.changeSets.listByWorkspace({ workspaceId: "site" });
  expect(await f.changeSets.findById({ workspaceId: "site", id: change!.id })).toMatchObject({
    items: [{ entityId: "story", operation: "delete", entityVersionAtApply: 5, inversePayload: { deletedAt: null } }],
  });
  await expect(f.call("content_post_delete", { id: "story", kind: "post" })).rejects.toThrow("post 'story' was not found");
  expect(f.removePost).toHaveBeenCalledTimes(1);
});

test("failed audit writes compensate create, update and delete without leaving an unaudited edit or trash marker", async () => {
  const failure = new Error("audit store down");
  const f = fixture();
  const insert = vi.spyOn(f.changeSets, "insert").mockRejectedValue(failure);
  try {
    await expect(createPostToolPost({ routeDeps: f.deps, ctx: ctx({ kind: "page", title: "Unaudited page", slug: "unaudited" }) })).rejects.toBe(failure);
    expect(await f.postRepo.findBySlug({ workspaceId: "site", slug: "unaudited" })).toBeNull();
    expect(await f.postRepo.listRevisions({ workspaceId: "site", postId: "id-1" })).toEqual([]);
    await expect(updatePostToolPost({ routeDeps: f.deps, ctx: ctx({ id: "story", title: "Unaudited title" }) })).rejects.toBe(failure);
    expect(await f.postRepo.findById(key)).toMatchObject({ title: "Story", version: 6 });
    await expect(deletePostToolPost({ routeDeps: f.deps, ctx: ctx({ id: "story", kind: "post" }) })).rejects.toBe(failure);
    expect(await f.postRepo.findById(key)).toMatchObject({ title: "Story", version: 8 });
    expect((await f.postRepo.findById(key))?.deletedAt ?? null).toBeNull();
    expect(f.forgetRemovedPost).toHaveBeenCalledExactlyOnceWith(key);
    expect(f.trash.has("site:story")).toBe(false);
    expect(f.processOutbox).not.toHaveBeenCalled();
    expect((await f.postRepo.listRevisions({ workspaceId: "site", postId: "story" })).map(({ seq, op }) => [seq, op]))
      .toEqual([[5, "update"], [6, "restore"], [7, "delete"], [8, "restore"]]);
  } finally { insert.mockRestore(); }
});

test("an already-cancelled edit cannot enter the command or change a row", async () => {
  const f = fixture();
  let commands = 0;
  const trackedExecute: PostToolDeps["executeCommand"] = (required, optional) => {
    commands++;
    return executeCommand(required, optional);
  };
  const controller = new AbortController();
  const reason = new Error("caller cancelled");
  controller.abort(reason);
  await expect(updatePostToolPost({ routeDeps: { ...f.deps, executeCommand: trackedExecute },
    ctx: ctx({ id: "story", title: "Cancelled title" }, controller.signal) })).rejects.toBe(reason);
  expect(commands).toBe(0);
  expect(await f.postRepo.findById(key)).toEqual(row);
  expect(f.processOutbox).not.toHaveBeenCalled();
});
