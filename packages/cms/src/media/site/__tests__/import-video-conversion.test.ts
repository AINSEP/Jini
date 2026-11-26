import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { InMemoryMediaRepo, InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryBlobStore, uploadMedia } from "../../index.js";
import { withVideoConversionOnImport } from "../import-video-conversion.js";

it("conversion failure after upload keeps and returns the persisted original", async () => {
  let id = 0;
  const deps = { mediaRepo: new InMemoryMediaRepo({}), blobRepo: new InMemoryAssetBlobRepo({}), renditionRepo: new InMemoryAssetRenditionRepo({}),
    blobStore: new InMemoryBlobStore(), createHash, clock: { nowMs: () => 0 }, idGen: { newId: () => String(++id) } };
  const reportNote = vi.fn();
  const transcode = vi.fn(async () => { expect((await deps.mediaRepo.list({ workspaceId: "w" })).length).toBe(1); throw new Error("private failure"); });
  const store = withVideoConversionOnImport({ storeUpload: (input: Parameters<typeof uploadMedia>[0]["input"]) => uploadMedia({ deps, input }), conversion: { deps: { ...deps, transcoder: { transcode }, linkDerivedMedia: async () => {} }, reportNote, thresholdBytes: 1 } });
  const input = { workspaceId: "w", bytes: new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, ...Buffer.from("isomiso2")]), filename: "clip.mov", contentType: "video/mp4", createdByPrincipal: "owner" };
  const result = await store(input);
  expect(transcode).toHaveBeenCalledTimes(1);
  expect(result.conversionNotice).toBe("web-copy-unavailable");
  expect(await deps.mediaRepo.findById({ workspaceId: "w", id: result.media.id })).toEqual(result.media);
  expect(reportNote).toHaveBeenCalledWith({ note: "The video was saved as uploaded, but a web-playable copy could not be made.", cause: expect.any(Error) });
});
