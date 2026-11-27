import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { buildMediaViewVideoRegistrations, contributeMediaViewVideoTools, createMediaViewVideoCatalog, type MediaViewVideoToolDeps } from "../view-video-tool.js";
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
  const uploadDeps = { ...s.deps, blobRepo: s.deps.assetBlobRepo, renditionRepo: new InMemoryAssetRenditionRepo({}), createHash, clock: { nowMs: () => 0 }, idGen: { newId: () => String(++id) } };
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


it("passes the signal property to the extractor even when undefined", async () => {
  const s = setup();
  const tool = buildMediaViewVideoRegistrations({ deps: s.deps, catalog: s.catalog })[0]!;
  await tool.handler({ ...ctx({ attachmentRef: "attachment:12345678" }), signal: undefined } as unknown as ToolExecutionContext);
  expect(s.deps.extractor.extract).toHaveBeenCalledWith({ bytes }, expect.objectContaining({ signal: undefined }));
  expect(Object.hasOwn(vi.mocked(s.deps.extractor.extract).mock.calls[0]![1]!, "signal")).toBe(true);
});

it("rejects malformed source and sampling arguments before looking up bytes", async () => {
  const s = setup();
  const readAttachment = vi.fn<MediaViewVideoToolDeps["readAttachment"]>(async () => { throw new Error("unexpected attachment read"); });
  const tool = buildMediaViewVideoRegistrations({ deps: { ...s.deps, readAttachment }, catalog: s.catalog })[0]!;
  const source = { attachmentRef: "attachment:12345678" };
  const cases: Array<[unknown, string]> = [
    [{}, "pass exactly one mediaId or attachmentRef"], [{ ...source, mediaId: "m" }, "pass exactly one mediaId or attachmentRef"],
    [{ mediaId: "folder/clip" }, "filesystem paths are refused"], [{ attachmentRef: "attachment:a" }, "pass exactly one mediaId or attachmentRef"],
    [{ ...source, frames: "3" }, "frames must be a finite number"], [{ ...source, frames: Infinity }, "frames must be a finite number"],
    [{ ...source, at: [1, -1, 3] }, "at timestamps must be nonnegative"], [{ ...source, at: [NaN] }, "at must be a nonempty array"],
    [{ ...source, every: 0 }, "every must be a positive finite number"], [{ ...source, start: -1 }, "start must be a nonnegative finite number"],
    [{ ...source, every: 1, at: [2] }, "every cannot be combined with at"],
  ];
  for (const [input, message] of cases) await expect(tool.handler(ctx(input))).rejects.toThrow(message);
  expect(readAttachment.mock.calls).toEqual([]);
  expect(s.deps.extractor.extract).not.toHaveBeenCalled();
});

it("the contributor returns contact sheets with exact row-major timestamps and calls the image-preparation reader", async () => {
  const s = setup();
  const input = ctx({ attachmentRef: "attachment:12345678", layout: "sheet", every: 2, start: 1, frames: 3 });
  const metadata = { duration: 9, width: 1920, height: 1080, codec: "vp9", container: "webm" as const, sizeBytes: 8, hasAudio: true };
  const tiles = [
    { index: 1, row: 1, column: 1, at: 1 },
    { index: 2, row: 1, column: 2, at: 3 },
    { index: 3, row: 2, column: 1, at: 5 },
  ];
  const sheet = { bytes: Uint8Array.from([2, 7]), mimeType: "image/jpeg" as const, columns: 2, rows: 2, tileEdgePx: 192, tiles };
  const extract = vi.fn<MediaViewVideoToolDeps["extractor"]["extract"]>(async () => ({ ok: true, metadata, frames: [], sheets: [sheet] }));
  const readAttachment = vi.fn<MediaViewVideoToolDeps["readAttachment"]>(async () => ({ ok: true, bytes }));
  const reads: unknown[] = [];
  const prepareImages: MediaViewVideoToolDeps["prepareImages"] = async ({ read, refs }) => ({
    images: await Promise.all(refs.map(async ref => {
      const image = await read({ ref }, {});
      reads.push([ref, image]);
      return { mimeType: image.mimeType, data: Buffer.from(image.bytes).toString("base64") };
    })),
  });
  const [tool] = contributeMediaViewVideoTools({ ports: { extractor: { extract }, readAttachment, prepareImages }, catalog: s.catalog }).build(s.deps, {});
  expect(await tool!.handler(input)).toEqual({ content: [
    { type: "text", text: JSON.stringify({
      video: metadata, layout: "sheet", frames: [], sheets: [{ sheet: 1, columns: 2, rows: 2, tileEdgePx: 192, mimeType: "image/jpeg", tiles }],
      sampling: "Tiles are row-major with one-based index/row/column mapped to seconds in each sheet. Events between samples and audio content are not analyzed.",
    }) }, { type: "image", mimeType: "image/jpeg", data: "Agc=" },
  ] });
  expect(reads).toEqual([["0", { name: "Video contact sheet 1", mimeType: "image/jpeg", bytes: Uint8Array.from([2, 7]) }]]);
  expect(readAttachment.mock.calls).toEqual([[{ ref: "attachment:12345678", ownerId: "owner" }, { maxBytes: 64 * 1024 * 1024 }]]);
  expect(extract.mock.calls).toEqual([[{ bytes }, { layout: "sheet", frames: 3, every: 2, start: 1, signal: input.signal }]]);
});

it("refuses a sheet without a row-major map, and refuses an empty frame result", async () => {
  const s = setup();
  const metadata = { duration: 9, width: 1920, height: 1080, codec: "vp9", container: "webm" as const, sizeBytes: 8, hasAudio: false };
  const tile = { index: 1, row: 1, column: 1, at: 1 };
  const sheet = { bytes: Uint8Array.from([2, 7]), mimeType: "image/jpeg" as const, columns: 2, rows: 2, tileEdgePx: 192, tiles: [tile] };
  const extract = vi.fn<MediaViewVideoToolDeps["extractor"]["extract"]>();
  const [tool] = buildMediaViewVideoRegistrations({ catalog: s.catalog, deps: { ...s.deps, extractor: { extract } } });
  for (const broken of [
    { ...sheet, columns: 0 }, { ...sheet, tileEdgePx: 769 }, { ...sheet, tiles: [] },
    { ...sheet, tiles: [{ ...tile, index: 2 }] }, { ...sheet, tiles: [{ ...tile, column: 2 }] },
    { ...sheet, tiles: [{ ...tile, row: 2 }] }, { ...sheet, tiles: [{ ...tile, at: -1 }] },
  ]) {
    extract.mockResolvedValueOnce({ ok: true, metadata, frames: [], sheets: [broken] });
    await expect(tool!.handler(ctx({ attachmentRef: "attachment:12345678", layout: "sheet" }))).rejects.toThrow("sheet output limit");
  }
  extract.mockResolvedValueOnce({ ok: true, metadata, frames: [] });
  await expect(tool!.handler(ctx({ attachmentRef: "attachment:12345678" }))).rejects.toThrow("frame output limit");
  expect(s.prepareImages.mock.calls).toEqual([]);
});

// --- Gap fill (cloud A2): library-owned bytes, frame naming, and the remaining refusals. ---

const METADATA = { duration: 3, width: 4, height: 4, codec: "vp9", container: "webm" as const, sizeBytes: 8, hasAudio: false };
const jpeg = (size: number) => ({ mimeType: "image/jpeg" as const, bytes: new Uint8Array(size) });

/** Uploads `bytes` as `owner`'s library video and returns its id with deps that can read it. */
async function ownedVideo(s: ReturnType<typeof setup>) {
  let id = 0;
  const uploadDeps = { ...s.deps, blobRepo: s.deps.assetBlobRepo, renditionRepo: new InMemoryAssetRenditionRepo({}), createHash, clock: { nowMs: () => 0 }, idGen: { newId: () => `m-${++id}` } };
  const { media } = await uploadMedia({ deps: uploadDeps, input: { workspaceId: "w", bytes, filename: "own.webm", contentType: "video/webm", createdByPrincipal: "owner" } });
  return media.id;
}

/** A prepareImages port that reads every ref through the tool's reader, recording what it was handed. */
function readingPrepare(reads: unknown[]): MediaViewVideoToolDeps["prepareImages"] {
  return async ({ read, refs }) => ({ images: await Promise.all(refs.map(async ref => {
    const image = await read({ ref }, {});
    reads.push([ref, image.name, image.bytes.byteLength]);
    return { mimeType: image.mimeType, data: "x" };
  })) });
}

it("previews the caller's own library video and names each frame by its time", async () => {
  const s = setup();
  const mediaId = await ownedVideo(s);
  const extract = vi.fn<MediaViewVideoToolDeps["extractor"]["extract"]>(async () => ({ ok: true, metadata: METADATA,
    frames: [{ at: 0, ...jpeg(2) }, { at: 1.5, ...jpeg(3) }] }));
  const reads: unknown[] = [];
  const [tool] = buildMediaViewVideoRegistrations({ deps: { ...s.deps, extractor: { extract }, prepareImages: readingPrepare(reads) }, catalog: s.catalog });
  const input = ctx({ mediaId, frames: 2, at: [0, 1.5] });
  const result = await tool!.handler(input) as { content: unknown[] };
  expect(result.content).toHaveLength(3);
  expect(extract.mock.calls).toEqual([[{ bytes }, { frames: 2, at: [0, 1.5], signal: input.signal }]]);
  expect(reads).toEqual([["0", "Video frame at 0s", 2], ["1", "Video frame at 1.5s", 3]]);
});

it("refuses library media with no stored blob, or whose stored size cannot be read", async () => {
  const s = setup();
  const mediaId = await ownedVideo(s);
  const [unsized] = buildMediaViewVideoRegistrations({ catalog: s.catalog, deps: { ...s.deps,
    blobStore: new Proxy(s.deps.blobStore, { get: (target, key, receiver) => (key === "sizeOf" ? undefined : Reflect.get(target, key, receiver)) }) } });
  await expect(unsized!.handler(ctx({ mediaId }))).rejects.toThrow("media_view_video: video size is unknown or exceeds the preview size limit (64 MiB).");
  const [unstored] = buildMediaViewVideoRegistrations({ catalog: s.catalog, deps: { ...s.deps, assetBlobRepo: new InMemoryAssetBlobRepo({}) } });
  await expect(unstored!.handler(ctx({ mediaId }))).rejects.toThrow("media_view_video: media has no stored video.");
  expect(s.deps.extractor.extract).not.toHaveBeenCalled();
});

it("refuses an unknown argument, an unknown layout and a negative frame count", async () => {
  const s = setup();
  const [tool] = buildMediaViewVideoRegistrations({ deps: s.deps, catalog: s.catalog });
  const source = { attachmentRef: "attachment:12345678" };
  await expect(tool!.handler(ctx({ ...source, path: "/tmp/x" }))).rejects.toThrow("only mediaId, attachmentRef, frames, at, every, start and layout are accepted");
  await expect(tool!.handler(ctx({ ...source, layout: "grid" }))).rejects.toThrow("layout must be frames or sheet.");
  await expect(tool!.handler(ctx({ ...source, frames: -1 }))).rejects.toThrow("frames must be nonnegative.");
  expect(s.deps.extractor.extract).not.toHaveBeenCalled();
});

it("refuses an unreadable attachment, an oversized one and one that is not a video", async () => {
  const s = setup();
  const source = { attachmentRef: "attachment:12345678" };
  const tool = (readAttachment: MediaViewVideoToolDeps["readAttachment"]) => buildMediaViewVideoRegistrations({ deps: { ...s.deps, readAttachment }, catalog: s.catalog })[0]!;
  await expect(tool(async () => ({ ok: false, refusal: "no-record" })).handler(ctx(source))).rejects.toThrow("attachment is unavailable or not owned by the caller.");
  const oversized = new Uint8Array(64 * 1024 * 1024 + 1);
  oversized.set(bytes);
  await expect(tool(async () => ({ ok: true, bytes: oversized })).handler(ctx(source))).rejects.toThrow("video exceeds the preview size limit (64 MiB).");
  await expect(tool(async () => ({ ok: true, bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) })).handler(ctx(source)))
    .rejects.toThrow("the stored file is not an MP4 or WebM video.");
  expect(s.deps.extractor.extract).not.toHaveBeenCalled();
});

it("refuses sheet results with no sheets or stray frames, frame results over the total budget, and a reader asked for a missing image", async () => {
  const s = setup();
  const extract = vi.fn<MediaViewVideoToolDeps["extractor"]["extract"]>();
  const sheet = { ...jpeg(2), columns: 1, rows: 1, tileEdgePx: 1, tiles: [{ index: 1, row: 1, column: 1, at: 0 }] };
  const [tool] = buildMediaViewVideoRegistrations({ deps: { ...s.deps, extractor: { extract } }, catalog: s.catalog });
  const source = { attachmentRef: "attachment:12345678" };
  extract.mockResolvedValueOnce({ ok: true, metadata: METADATA, frames: [], sheets: [] });
  await expect(tool!.handler(ctx({ ...source, layout: "sheet" }))).rejects.toThrow("the video extractor exceeded the sheet output limit.");
  extract.mockResolvedValueOnce({ ok: true, metadata: METADATA, frames: [{ at: 0, ...jpeg(1) }], sheets: [sheet] });
  await expect(tool!.handler(ctx({ ...source, layout: "sheet" }))).rejects.toThrow("the video extractor exceeded the sheet output limit.");
  const seventeen = Array.from({ length: 17 }, (_, index) => ({ at: index, ...jpeg(512 * 1024) }));
  extract.mockResolvedValueOnce({ ok: true, metadata: METADATA, frames: seventeen });
  await expect(tool!.handler(ctx(source))).rejects.toThrow("the video extractor exceeded the total output limit (8 MiB).");
  expect(s.prepareImages).not.toHaveBeenCalled();
  extract.mockResolvedValueOnce({ ok: true, metadata: METADATA, frames: [{ at: 0, ...jpeg(1) }] });
  const [probing] = buildMediaViewVideoRegistrations({ catalog: s.catalog, deps: { ...s.deps, extractor: { extract },
    prepareImages: async ({ read }) => { await read({ ref: "5" }, {}); return { images: [] }; } } });
  await expect(probing!.handler(ctx(source))).rejects.toThrow("Video preview has no image for its attachment");
});

it("refuses a frame result carrying sheets or a frame over the per-frame byte cap", async () => {
  const s = setup();
  const extract = vi.fn<MediaViewVideoToolDeps["extractor"]["extract"]>();
  const [tool] = buildMediaViewVideoRegistrations({ deps: { ...s.deps, extractor: { extract } }, catalog: s.catalog });
  const sheet = { ...jpeg(2), columns: 1, rows: 1, tileEdgePx: 1, tiles: [{ index: 1, row: 1, column: 1, at: 0 }] };
  extract.mockResolvedValueOnce({ ok: true, metadata: METADATA, frames: [{ at: 0, ...jpeg(1) }], sheets: [sheet] });
  await expect(tool!.handler(ctx({ attachmentRef: "attachment:12345678" }))).rejects.toThrow("the video extractor exceeded the frame output limit.");
  extract.mockResolvedValueOnce({ ok: true, metadata: METADATA, frames: [{ at: 0, ...jpeg(512 * 1024 + 1) }] });
  await expect(tool!.handler(ctx({ attachmentRef: "attachment:12345678" }))).rejects.toThrow("the video extractor exceeded the frame output limit.");
  expect(s.prepareImages).not.toHaveBeenCalled();
});
