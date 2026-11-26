import { expect, it, vi } from "vitest";
import { buildMediaViewVideoRegistrations, createMediaViewVideoCatalog, type MediaViewVideoToolDeps } from "../view-video-tool.js";
import type { ToolExecutionContext } from "@jini-ai/core";
import { InMemoryMediaRepo, InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo } from "../../repo.memory.js";
import { InMemoryBlobStore } from "../../blob-store.memory.js";
import { uploadMedia, VIDEO_MAX_SHEET_BYTES } from "../../index.js";

const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
const ctx = (input: unknown): ToolExecutionContext => ({ executionId: "e", principal: { id: "owner" }, run: { id: "r" }, input, signal: new AbortController().signal });
function setup() {
  const prepareImages = vi.fn(async () => ({ images: [] }));
  const extractor: MediaViewVideoToolDeps["extractor"] = { extract: vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const, message: "unavailable" })) };
  const deps: MediaViewVideoToolDeps = { workspaceId: "w", authorize: async () => ({ allowed: true, reason: "matched" }),
    mediaRepo: new InMemoryMediaRepo({}), assetBlobRepo: new InMemoryAssetBlobRepo({}), blobStore: new InMemoryBlobStore(),
    extractor, readAttachment: async () => ({ ok: true, bytes }), prepareImages };
  return { deps, prepareImages, catalog: createMediaViewVideoCatalog({ mediaAssetReadToolId: "assets_read" }) };
}
it("shared blob does not make another creator’s video readable", async () => {
  const s = setup();
  let id = 0;
  const uploadDeps = { ...s.deps, blobRepo: s.deps.assetBlobRepo, renditionRepo: new InMemoryAssetRenditionRepo({}), clock: { nowMs: () => 0 }, idGen: { newId: () => String(++id) } };
  await uploadMedia({ deps: uploadDeps, input: { workspaceId: "w", bytes, filename: "owner.webm", contentType: "video/webm", createdByPrincipal: "owner" } });
  const { media } = await uploadMedia({ deps: uploadDeps, input: { workspaceId: "w", bytes, filename: "other.webm", contentType: "video/webm", createdByPrincipal: "other" } });
  const tool = buildMediaViewVideoRegistrations({ deps: s.deps, catalog: s.catalog })[0];
  if (!tool) throw new Error("missing tool");
  await expect(tool.handler(ctx({ mediaId: media.id }))).rejects.toThrow("not owned by the caller");
  expect(s.deps.extractor.extract).not.toHaveBeenCalled();
});
it("an oversized sheet never reaches image preparation", async () => {
  const s = setup();
  Object.assign(s.deps, { extractor: { extract: async () => ({ ok: true, metadata: { duration: 1, width: 1, height: 1, codec: "vp9", container: "webm", sizeBytes: 8, hasAudio: false }, frames: [],
    sheets: [{ bytes: new Uint8Array(VIDEO_MAX_SHEET_BYTES + 1), mimeType: "image/jpeg", columns: 1, rows: 1, tileEdgePx: 1, tiles: [{ index: 1, row: 1, column: 1, at: 0 }] }] }) } });
  const tool = buildMediaViewVideoRegistrations({ deps: s.deps, catalog: s.catalog })[0];
  if (!tool) throw new Error("missing tool");
  await expect(tool.handler(ctx({ attachmentRef: "attachment:12345678", layout: "sheet" }))).rejects.toThrow("sheet output limit");
  expect(s.prepareImages).not.toHaveBeenCalled();
});

it("returns the existing video summary and image result envelope", async () => {
  const s = setup();
  const metadata = { duration: 1, width: 1, height: 1, codec: "vp9", container: "webm", sizeBytes: 8, hasAudio: false };
  Object.assign(s.deps, { extractor: { extract: async () => ({ ok: true, metadata, frames: [{ at: 0, mimeType: "image/jpeg", bytes: new Uint8Array([1]) }] }) },
    prepareImages: async () => ({ images: [{ mimeType: "image/jpeg", data: "AQ==" }] }) });
  const tool = buildMediaViewVideoRegistrations({ deps: s.deps, catalog: s.catalog })[0]!;
  expect(await tool.handler(ctx({ attachmentRef: "attachment:12345678", layout: "frames" }))).toEqual({ content: [
    { type: "text", text: JSON.stringify({ video: metadata, layout: "frames", frames: [{ at: 0, mimeType: "image/jpeg" }], sampling: "Still frames at requested times; events between samples and audio content are not analyzed." }) },
    { type: "image", mimeType: "image/jpeg", data: "AQ==" },
  ] });
});
