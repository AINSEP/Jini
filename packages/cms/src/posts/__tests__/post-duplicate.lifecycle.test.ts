import assert from "node:assert/strict";
import { expect, it, vi } from "vitest";
import { executeCommand, ForbiddenError } from "../../core/index.js";
import { InMemoryChangeSetRepo } from "../../core/commands/repo.memory.js";
import { deriveDuplicateName } from "../../content-duplication/derive-available-name.js";
import { copyBodyJsonWithFreshEmbedPlacements } from "../../widgets/duplicate-embeds.js";
import { InMemoryPagesHtmlDocumentStore } from "../../pages/html-document-store.memory.js";
import { type PostRecord } from "../post.js";
import { PostNotFoundError, PostValidationError } from "@jini-ai/cms/posts/post";
import type { PostToolDeps } from "../post-tool-deps.js";
import { contributePostDuplicateHandlers } from "../post-tool-duplicate.js";
import { NOW, WORKSPACE, postClock, postRepo, postRow, recordingPostOutbox } from "./post-coverage.fixture.js";

const source = postRow({
  id: "source", title: "Market Notes", slug: "market-notes", status: "published", author: "Author", showAuthor: true,
  bodyJson: { type: "doc", content: [{ type: "widgetEmbed", attrs: { widgetEntryId: "newsletter", placementId: "source-placement" } }] },
});
const htmlSource = postRow({ id: "source", kind: "page", slug: "original-page", bodyFormat: "html", bodyHtml: "<h1>Page</h1>" });
const request = { principalId: "editor", id: "source", overrides: {} };

function fixture(rows: PostRecord[] = [source]) {
  const repo = postRepo(rows);
  const { events, outbox } = recordingPostOutbox();
  const changeSets = new InMemoryChangeSetRepo([], [], outbox);
  const authorize = vi.fn<PostToolDeps["authorize"]>(async ({ workspaceId, principalId, permission }) => ({
    allowed: workspaceId === WORKSPACE && principalId === "editor" && ["post.inspect", "post.change"].includes(permission),
    reason: "test grant",
  }));
  let id = 0;
  const processOutbox = vi.fn<PostToolDeps["processOutbox"]>(async () => undefined);
  const pluginBeforeSaveHook = vi.fn<PostToolDeps["pluginBeforeSaveHook"]>(async () => ({}));
  const sourceDeps = {
    workspaceId: WORKSPACE, postRepo: repo, reservedSegments: new Set<string>(), authorize, idGen: { newId: () => `id-${++id}` },
    contentReadPermission: "post.inspect", contentWritePermission: "post.change",
    outbox, changeSets, clock: postClock, executeCommand, processOutbox, copyBodyJsonWithFreshEmbedPlacements, pluginBeforeSaveHook,
    bus: { async publish() {}, async publishBatch() {}, async subscribe() { return async () => {}; }, async subscribeAll() { return async () => {}; } },
    postToolViewDeps: () => ({
      workspaceId: WORKSPACE, entryPublicPath: ({ post }: { post: { status: string; slug: string } }) =>
        post.status === "published" ? { path: `/${post.slug}`, canonicalUrl: `/${post.slug}` } : null,
      runtimeMode: () => "local" as const, publishedWhere: { live: "live", local: "local" },
    }),
  } satisfies Pick<PostToolDeps, "workspaceId" | "postRepo" | "reservedSegments" | "authorize" | "idGen" |
    "contentReadPermission" | "contentWritePermission" | "outbox" | "changeSets" | "clock" | "executeCommand" |
    "processOutbox" | "copyBodyJsonWithFreshEmbedPlacements" | "pluginBeforeSaveHook" | "bus" | "postToolViewDeps">;
  // The `satisfies` above pins the slice the duplicate handlers read; the rest of the host bag is unused here.
  const deps = sourceDeps as unknown as PostToolDeps;
  const naming = vi.fn<Parameters<typeof contributePostDuplicateHandlers>[0]["deriveDuplicateName"]>((required, options) =>
    deriveDuplicateName(required, { ...options, withSuffix: ({ base, suffix }) => `${base} ${suffix}`, exhaustionMessage: ({ base }) => `No free copy of ${base}` }));
  const select = (resource: "page" | "post") => {
    const contributor = contributePostDuplicateHandlers({ deriveDuplicateName: naming }).find(c => c.resource === resource);
    if (!contributor) throw new Error(`Missing ${resource} contributor`);
    return contributor.build(deps);
  };
  return { repo, events, deps, changeSets, authorize, processOutbox, pluginBeforeSaveHook, naming, select };
}

it("copies a rich-text post with a free same-kind title and fresh widget placement but the same widget target", async () => {
  const s = fixture([
    source, postRow({ id: "taken", title: "Market Notes 2", slug: "taken-notes" }),
    postRow({ id: "unrelated-page", kind: "page", title: "Market Notes 3", slug: "unrelated" }),
  ]);
  const handler = s.select("post");
  expect(handler.permission).toBe("post.change");
  const bodyJson = { type: "doc", content: [{ type: "widgetEmbed", attrs: { widgetEntryId: "newsletter", placementId: "id-1" } }] };
  expect(await handler.duplicate(request)).toEqual({ post: {
    id: "id-2", kind: "post", title: "Market Notes 3", slug: "market-notes-3", status: "draft", updatedAt: NOW,
    version: 1, bodyJson, author: "Author", showAuthor: true, publicUrl: null, adminUrl: "/admin/posts/id-2",
  } });
  expect(await s.repo.findById({ workspaceId: WORKSPACE, id: "id-2" })).toMatchObject({
    title: "Market Notes 3", slug: "market-notes-3", status: "draft", bodyJson, createdByPrincipalId: "editor", createdByKind: "agent",
  });
  expect(await s.repo.findById({ workspaceId: WORKSPACE, id: "source" })).toEqual(source);
  expect(s.processOutbox).toHaveBeenCalledExactlyOnceWith({ outbox: s.deps.outbox, bus: s.deps.bus, clock: postClock });
  expect((await s.changeSets.listByWorkspace({ workspaceId: WORKSPACE })).map(c => [c.summary, c.actor])).toEqual([
    ["Agent duplicate post 'Market Notes' as 'Market Notes 3'", { id: "editor", kind: "agent" }],
  ]);
});

it("returns an explicit published copy with routed URL and does not call name derivation", async () => {
  const s = fixture();
  expect(await s.select("post").duplicate({ ...request, overrides: { title: "Release Copy", slug: "released", status: "published" } }))
    .toMatchObject({ post: { id: "id-2", title: "Release Copy", slug: "released", status: "published", publicUrl: "/released", publishedWhere: "local" } });
  expect(s.naming).not.toHaveBeenCalled();
  expect(await s.repo.findById({ workspaceId: WORKSPACE, id: "id-2" })).toMatchObject({ status: "published" });
  expect(s.events.find(e => e.name === "entry.published")).toMatchObject({ id: "id-2-entry.published-1", actor: { id: "editor", kind: "agent" } });
});

it("does not read a duplicate source when the actor lacks the read grant", async () => {
  const s = fixture();
  s.authorize.mockResolvedValueOnce({ allowed: false, reason: "no grant" });
  const find = vi.spyOn(s.repo, "findById");
  await assert.rejects(s.select("post").duplicate(request), {
    constructor: ForbiddenError, message: "principal 'editor' is not authorized for 'post.inspect' (no grant)",
  });
  expect(s.authorize).toHaveBeenCalledExactlyOnceWith({ principalId: "editor", permission: "post.inspect", workspaceId: WORKSPACE, entityType: "post", entityId: "source" });
  expect(find).not.toHaveBeenCalled();
  expect(await s.repo.list({ workspaceId: WORKSPACE })).toEqual([source]);
});

it("refuses a post in the page contributor and rejects a bad public status before opening the copy", async () => {
  const s = fixture();
  await assert.rejects(s.select("page").duplicate(request), { constructor: PostNotFoundError, message: "page 'source' was not found" });
  await assert.rejects(s.select("post").duplicate({ ...request, overrides: { status: "scheduled" } }), {
    constructor: PostValidationError, message: "status must be 'draft' or 'published'",
  });
  expect(s.naming).not.toHaveBeenCalled();
  expect(s.events).toEqual([]);
  expect(await s.repo.list({ workspaceId: WORKSPACE })).toEqual([source]);
});

it("refuses to duplicate raw HTML without the optional store rather than silently making a doc copy", async () => {
  const s = fixture([htmlSource]);
  await expect(s.select("page").duplicate({ ...request, overrides: { title: "Other page" } })).rejects.toThrow(
    "content_duplicate: 'source' is a bespoke-HTML page, and this workspace has no HTML-body store wired for duplication. Nothing was copied — its content is never silently dropped.",
  );
  expect(await s.repo.list({ workspaceId: WORKSPACE })).toEqual([htmlSource]);
  expect(await s.changeSets.listByWorkspace({ workspaceId: WORKSPACE })).toEqual([]);
  expect(s.processOutbox).not.toHaveBeenCalled();
});

it("converts an HTML duplicate and records the converted body's actual version", async () => {
  const s = fixture([htmlSource]);
  const open = vi.fn<NonNullable<PostToolDeps["pagesHtmlStore"]>>(scope =>
    new InMemoryPagesHtmlDocumentStore({ scope, deps: { repo: s.repo, clock: postClock, reportUnindexedRef: () => {}, restoredEntryRefs: () => [] } }));
  s.deps.pagesHtmlStore = open;
  expect(await s.select("page").duplicate({ ...request, overrides: { title: "Other page" } }))
    .toMatchObject({ post: { id: "id-1", title: "Other page", kind: "page", version: 2, adminUrl: "/admin/pages/other-page" } });
  expect(open.mock.calls).toEqual([[{ workspaceId: WORKSPACE, postId: "source" }], [{ workspaceId: WORKSPACE, postId: "id-1" }]]);
  expect(await s.repo.findById({ workspaceId: WORKSPACE, id: "id-1" })).toMatchObject({ bodyFormat: "html", bodyHtml: "<h1>Page</h1>", version: 2 });
  const changes = await s.changeSets.listByWorkspace({ workspaceId: WORKSPACE });
  expect(changes).toEqual([expect.objectContaining({ summary: "Agent duplicate page 'Default article' as 'Other page'" })]);
  expect(await s.changeSets.findById({ workspaceId: WORKSPACE, id: changes[0]!.id })).toMatchObject({ items: [
    { entityType: "post", entityId: "id-1", entityVersionAtApply: 2, operation: "create" },
  ] });
});

it("rolls back an HTML copy when the host store becomes unavailable during creation", async () => {
  const s = fixture([htmlSource]);
  s.deps.pagesHtmlStore = scope =>
    new InMemoryPagesHtmlDocumentStore({ scope, deps: { repo: s.repo, clock: postClock, reportUnindexedRef: () => {}, restoredEntryRefs: () => [] } });
  s.pluginBeforeSaveHook.mockImplementationOnce(async () => {
    delete s.deps.pagesHtmlStore;
    return {};
  });
  await expect(s.select("page").duplicate({ ...request, overrides: { title: "Other page" } }))
    .rejects.toThrow("Post duplication has no HTML page store");
  expect(await s.repo.list({ workspaceId: WORKSPACE })).toEqual([htmlSource]);
  expect(await s.repo.listRevisions({ workspaceId: WORKSPACE, postId: "id-1" })).toEqual([]);
  expect(await s.changeSets.listByWorkspace({ workspaceId: WORKSPACE })).toEqual([]);
  expect(s.processOutbox).not.toHaveBeenCalled();
});
