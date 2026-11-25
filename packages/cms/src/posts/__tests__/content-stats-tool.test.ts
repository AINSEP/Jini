import { expect, it, vi } from "vitest";
import { buildContentStatsRegistrations, type ContentStatsToolDeps } from "../content-stats-tool.js";
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
