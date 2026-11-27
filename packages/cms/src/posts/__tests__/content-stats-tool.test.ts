import { ToolInputError } from "@jini-ai/core";
import { NOW, postRow } from "./post-coverage.fixture.js";
import { expect, it, vi } from "vitest";
import { buildContentStatsRegistrations, contributeContentStatsTools, type ContentStatsToolDeps } from "../content-stats-tool.js";
import type { ToolExecutionContext } from "@jini-ai/core";

const ctx: ToolExecutionContext = { executionId: "e", principal: { id: "caller" }, run: { id: "r" }, input: {}, signal: new AbortController().signal };
function setup(): ContentStatsToolDeps {
  return { workspaceId: "w", authorize: async () => ({ allowed: true, reason: "matched" }), postRepo: { list: vi.fn(async () => []) },
    contentTypeRepo: { listByWorkspace: vi.fn(async () => []) }, entryRepo: { listByWorkspace: vi.fn(async () => []) },
    mediaRepo: { list: vi.fn(async () => [{ status: "active", source: { sha256: "hash" } }]) },
    mediaContentTypeStore: { getMany: vi.fn(async () => new Map([["hash", "video/webm"]])) },
    assetBlobRepo: { list: vi.fn(async () => [{ sha256: "hash", storageKey: "blob" }]) }, blobStore: { get: vi.fn(async () => new Uint8Array([0])) } };
}
it("denied family is omitted without any family repo reads", async () => {
  const deps = setup();
  deps.authorize = async ({ permission }) => ({ allowed: permission === "content.read", reason: "scoped" });
  const tool = buildContentStatsRegistrations({ deps })[0];
  if (!tool) throw new Error("missing tool");
  const result = await tool.handler(ctx);
  expect(result).toMatchObject({ posts: { total: 0 }, pages: { total: 0 }, omitted: ["entries", "media"] });
  expect(result).not.toHaveProperty("entries");
  expect(result).not.toHaveProperty("media");
  expect(deps.contentTypeRepo.listByWorkspace).not.toHaveBeenCalled();
  expect(deps.entryRepo.listByWorkspace).not.toHaveBeenCalled();
  expect(deps.mediaRepo.list).not.toHaveBeenCalled();
  expect(deps.mediaContentTypeStore.getMany).not.toHaveBeenCalled();
  expect(deps.assetBlobRepo.list).not.toHaveBeenCalled();
  expect(deps.blobStore.get).not.toHaveBeenCalled();
});
it("stored media type avoids opening the blob", async () => {
  const deps = setup();
  const tool = buildContentStatsRegistrations({ deps })[0];
  if (!tool) throw new Error("missing tool");
  expect(await tool.handler(ctx)).toMatchObject({ media: { total: 1, images: 0, videos: 1, other: 0 } });
  expect(deps.mediaContentTypeStore.getMany).toHaveBeenCalledWith({ workspaceId: "w", sha256s: ["hash"] });
  expect(deps.assetBlobRepo.list).not.toHaveBeenCalled();
  expect(deps.blobStore.get).not.toHaveBeenCalled();
});

function execute(deps: ContentStatsToolDeps, input: unknown = {}) {
  const [tool] = contributeContentStatsTools().build(deps, {});
  if (!tool) throw new Error("missing contributed content statistics tool");
  expect(tool.descriptor.id).toBe("content_stats");
  return tool.handler({ ...ctx, input });
}

it("counts only non-trashed public content and ranks longest text across body formats", async () => {
  const deps = setup();
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "four\twords live here" }] }] };
  deps.postRepo.list = vi.fn(async () => [
    postRow({ id: "b", title: "Second tie", slug: "second", bodyJson: doc }),
    postRow({ id: "z", title: "Draft note", slug: "short" }),
    postRow({ id: "a", title: "First tie", slug: "first", bodyJson: doc, status: "published" }),
    postRow({ id: "html", kind: "page", slug: "page", title: "Plain HTML", bodyFormat: "html", bodyHtml: "<p>one</p><p>two three</p>", status: "published" }),
    postRow({ id: "empty", kind: "page", slug: "empty", bodyFormat: "html", bodyHtml: null }),
    postRow({ id: "removed", deletedAt: NOW, bodyJson: doc, kind: "page" }),
  ]);
  expect(await execute(deps, { longest: 2 })).toMatchObject({
    posts: { total: 3, byStatus: { draft: 2, published: 1 }, words: { total: 8, average: 8 / 3, longest: [
      { id: "a", title: "First tie", slug: "first", words: 4 }, { id: "b", title: "Second tie", slug: "second", words: 4 },
    ] } },
    pages: { total: 2, byStatus: { published: 1, draft: 1 }, words: { total: 3, average: 1.5, longest: [
      { id: "html", title: "Plain HTML", slug: "page", words: 3 }, { id: "empty", title: "Default article", slug: "empty", words: 0 },
    ] } },
  });
  const countsOnly = await execute(deps, { includeWordCounts: false });
  expect(countsOnly).toMatchObject({ posts: { total: 3 }, pages: { total: 2 } });
  expect(countsOnly).not.toHaveProperty("posts.words");
  expect(countsOnly).not.toHaveProperty("pages.words");
  expect(await execute(deps, { longest: 0 })).toMatchObject({ posts: { words: { total: 8, longest: [] } } });
  expect(await execute(deps, { longest: 20 })).toMatchObject({ posts: { words: { longest: [{ id: "a" }, { id: "b" }, { id: "z" }] } } });
});

it.each([
  [{ includeWordCounts: "false" }, "content_stats: includeWordCounts must be a boolean."],
  [{ longest: "2" }, "content_stats: longest must be an integer from 0 to 20."],
  [{ longest: 2.5 }, "content_stats: longest must be an integer from 0 to 20."],
  [{ longest: -1 }, "content_stats: longest must be an integer from 0 to 20."],
  [{ longest: 21 }, "content_stats: longest must be an integer from 0 to 20."],
] as const)("rejects invalid statistics options %j before reading rows", async (input, message) => {
  const deps = setup();
  const authorize = vi.fn(deps.authorize);
  deps.authorize = authorize;
  const result = execute(deps, input);
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toMatchObject({ message });
  expect(authorize).not.toHaveBeenCalled();
  expect(deps.postRepo.list).not.toHaveBeenCalled();
});

it("counts live collections by key and retains empty types without exposing widget internals", async () => {
  const deps = setup();
  deps.contentTypeRepo.listByWorkspace = vi.fn(async () => [
    { key: "team", status: "active" }, { key: "widget", status: "active" }, { key: "dept", status: "active" },
    { key: "widget_area", status: "active" }, { key: "retired", status: "tombstone" },
  ]);
  deps.entryRepo.listByWorkspace = vi.fn(async () => [
    { type: "widget", status: "published" }, { type: "team", status: "draft" }, { type: "team", status: "published" },
    { type: "team", status: "published" }, { type: "retired", status: "draft" }, { type: "unknown", status: "draft" },
  ]);
  const result = await execute(deps);
  expect(result).toMatchObject({ entries: [
    { contentType: "dept", total: 0, byStatus: {} }, { contentType: "team", total: 3, byStatus: { draft: 1, published: 2 } },
  ] });
  expect(result).not.toHaveProperty("omitted");
  expect(deps.contentTypeRepo.listByWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: "w" });
  expect(deps.entryRepo.listByWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: "w" });
});

it("uses MIME metadata first and sniffs a shared legacy blob once for all referring assets", async () => {
  const deps = setup();
  deps.mediaRepo.list = vi.fn(async () => ["png", "video", "png", "other", "trash"].map(sha256 =>
    ({ status: sha256 === "trash" ? "trashed" : "active", source: { sha256 } })));
  deps.mediaContentTypeStore.getMany = vi.fn(async () => new Map([["video", "video/webm"], ["other", "application/pdf"]]));
  deps.assetBlobRepo.list = vi.fn(async () => [{ sha256: "png", storageKey: "old-png" }]);
  deps.blobStore.get = vi.fn<ContentStatsToolDeps["blobStore"]["get"]>(async ({ storageKey }) => {
    if (storageKey !== "old-png") throw new Error("unexpected blob");
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
  expect(await execute(deps)).toMatchObject({ media: { total: 4, images: 2, videos: 1, other: 1 } });
  expect(deps.mediaContentTypeStore.getMany).toHaveBeenCalledExactlyOnceWith({ workspaceId: "w", sha256s: ["png", "video", "other"] });
  expect(deps.assetBlobRepo.list).toHaveBeenCalledExactlyOnceWith({ workspaceId: "w" });
  expect(deps.blobStore.get).toHaveBeenCalledExactlyOnceWith({ storageKey: "old-png" });
});

it("refuses to report a partial inventory when a legacy media blob is missing", async () => {
  const deps = setup();
  deps.mediaContentTypeStore.getMany = vi.fn(async () => new Map<string, string>());
  deps.assetBlobRepo.list = vi.fn(async () => []);
  const result = execute(deps);
  await expect(result).rejects.toBeInstanceOf(ToolInputError);
  await expect(result).rejects.toMatchObject({ message: "content_stats: media blob 'hash' is missing. Inspect the media library before retrying the count." });
  expect(deps.blobStore.get).not.toHaveBeenCalled();
});
