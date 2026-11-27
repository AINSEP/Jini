import { isoBmffVideoBytes } from "../../__tests__/iso-bmff-fixture.js";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { InMemoryMediaRepo, InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryBlobStore, uploadMedia } from "../../index.js";
import { createConvertingUploader, operatorLogVideoNote, withVideoConversionOnImport, type ImportVideoConversion } from "../import-video-conversion.js";

it("conversion failure after upload keeps and returns the persisted original", async () => {
  let id = 0;
  const deps = { mediaRepo: new InMemoryMediaRepo({}), blobRepo: new InMemoryAssetBlobRepo({}), renditionRepo: new InMemoryAssetRenditionRepo({}),
    blobStore: new InMemoryBlobStore(), createHash, clock: { nowMs: () => 0 }, idGen: { newId: () => String(++id) } };
  const reportNote = vi.fn<ImportVideoConversion["reportNote"]>();
  const failure = new Error("private failure");
  let rowsAtTranscode: Awaited<ReturnType<typeof deps.mediaRepo.list>> | undefined;
  const transcode = vi.fn(async () => {
    rowsAtTranscode = await deps.mediaRepo.list({ workspaceId: "w" });
    throw failure;
  });
  const store = withVideoConversionOnImport({ storeUpload: (input: Parameters<typeof uploadMedia>[0]["input"]) => uploadMedia({ deps, input }), conversion: { deps: { ...deps, transcoder: { transcode }, linkDerivedMedia: async () => {} }, reportNote, thresholdBytes: 1 } });
  const input = { workspaceId: "w", bytes: new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, ...Buffer.from("isomiso2")]), filename: "clip.mov", contentType: "video/mp4", createdByPrincipal: "owner" };
  const result = await store(input);
  expect(transcode).toHaveBeenCalledTimes(1);
  expect(rowsAtTranscode).toEqual([result.media]);
  expect(result.conversionNotice).toBe("web-copy-unavailable");
  expect(await deps.mediaRepo.findById({ workspaceId: "w", id: result.media.id })).toEqual(result.media);
  expect(reportNote).toHaveBeenCalledWith({ note: "The video was saved as uploaded, but a web-playable copy could not be made.", cause: failure });
  expect(reportNote.mock.calls[0]?.[0].cause).toBe(failure);
});

it("a configured converter keeps the upload receipt about the original and persists a linked web copy", async () => {
  let id = 0;
  const uploadDeps = { mediaRepo: new InMemoryMediaRepo({}), blobRepo: new InMemoryAssetBlobRepo({}), renditionRepo: new InMemoryAssetRenditionRepo({}),
    blobStore: new InMemoryBlobStore(), createHash, clock: { nowMs: () => 0 }, idGen: { newId: () => `row-${++id}` } };
  const output = isoBmffVideoBytes("isom");
  const original = isoBmffVideoBytes("qt  ");
  const transcode = vi.fn<ImportVideoConversion["deps"]["transcoder"]["transcode"]>(async () => ({ ok: true, bytes: output }));
  const linkDerivedMedia = vi.fn<ImportVideoConversion["deps"]["linkDerivedMedia"]>(async () => {});
  const warn = vi.fn((_line: string, _cause: unknown) => {});
  const reportNote = operatorLogVideoNote({ warn });
  const input = { workspaceId: "w", bytes: original, filename: "Holiday.mov", contentType: "video/quicktime", createdByPrincipal: "owner" };
  const store = createConvertingUploader({ uploadDeps, caps: { maxUploadBytes: 1024 } }, { video: {
    ports: { transcoder: { transcode } }, reportNote, linkDerivedMedia, thresholdBytes: 1,
  } });
  const result = await store(input);
  expect(result).not.toHaveProperty("conversionNotice");
  expect(result.media).toMatchObject({ id: "row-2", title: "Holiday", createdBy: "owner" });
  expect(result.media.source.contentType).toBe("video/quicktime");
  expect(transcode.mock.calls.map(([request]) => request)).toEqual([{ input: original, target: "mp4-h264-aac-faststart" }]);
  const copy = await uploadDeps.mediaRepo.findBySlug({ workspaceId: "w", slug: "holiday-web" });
  expect(copy).toMatchObject({ id: "row-5", title: "Holiday (web)", source: { contentType: "video/mp4" } });
  expect(linkDerivedMedia.mock.calls).toEqual([[{ workspaceId: "w", originalId: result.media.id, derivedId: "row-5", target: "mp4-h264-aac-faststart" }]]);
  expect(warn.mock.calls).toEqual([]);

  const cause = new Error("private codec diagnostic");
  reportNote({ note: "The upload was kept.", cause });
  expect(warn.mock.calls).toEqual([["[media-import] The upload was kept.", cause]]);
});
