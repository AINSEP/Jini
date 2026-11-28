import { isoBmffVideoBytes } from "../../__tests__/iso-bmff-fixture.js";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { InMemoryMediaRepo, InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryBlobStore, uploadMedia } from "../../index.js";
import { createConvertingStagedUploader, createConvertingUploader, operatorLogVideoNote, withVideoConversionOnImport, type ImportVideoConversion } from "../import-video-conversion.js";
// The unit under test imports the error through the package entry, so the class identity must match it.
import { VideoConversionError } from "@jini-ai/cms/media";

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

function uploadDepsFixture() {
  let id = 0;
  const blobStore = new InMemoryBlobStore();
  const writer = async ({ workspaceId, sha256, openChunks }: { workspaceId: string; sha256: string; openChunks: (required: Record<string, never>, optional?: { signal?: AbortSignal }) => AsyncIterable<Uint8Array> }) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of openChunks({})) chunks.push(chunk);
    return blobStore.put({ workspaceId, sha256, bytes: Buffer.concat(chunks) });
  };
  return { mediaRepo: new InMemoryMediaRepo({}), blobRepo: new InMemoryAssetBlobRepo({}), renditionRepo: new InMemoryAssetRenditionRepo({}),
    blobStore: Object.assign(blobStore, { resolveStagedWriter: async () => writer }), createHash, clock: { nowMs: () => 0 }, idGen: { newId: () => `row-${++id}` } };
}

function stagedInput() {
  const bytes = isoBmffVideoBytes("isom");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const openChunks = async function* () { yield bytes; };
  return { workspaceId: "w", filename: "Trip.mp4", contentType: "video/mp4", createdByPrincipal: "owner",
    staged: { path: "/staging/trip.mp4", root: "/staging", contentType: "video/mp4", byteLength: bytes.byteLength, sha256, openChunks } };
}

it("without a conversion the store is returned unwrapped", () => {
  const storeUpload = async (input: Parameters<typeof uploadMedia>[0]["input"]) => uploadMedia({ deps: uploadDepsFixture(), input });
  expect(withVideoConversionOnImport({ storeUpload, conversion: undefined })).toBe(storeUpload);
});

it("an uploader without a transcoder, or under the default 50 MiB threshold, never converts", async () => {
  const transcode = vi.fn<ImportVideoConversion["deps"]["transcoder"]["transcode"]>(async () => ({ ok: true, bytes: isoBmffVideoBytes("isom") }));
  const reportNote = vi.fn<ImportVideoConversion["reportNote"]>();
  const input = { workspaceId: "w", bytes: isoBmffVideoBytes("qt  "), filename: "Holiday.mov", contentType: "video/quicktime", createdByPrincipal: "owner" };
  const noTranscoderDeps = uploadDepsFixture();
  const noTranscoder = createConvertingUploader({ uploadDeps: noTranscoderDeps, caps: { maxUploadBytes: 1024 } }, { video: { ports: {}, reportNote, linkDerivedMedia: async () => {}, thresholdBytes: 1 } });
  expect(await noTranscoder(input)).not.toHaveProperty("conversionNotice");
  expect(await noTranscoderDeps.mediaRepo.list({ workspaceId: "w" })).toHaveLength(1);
  const defaultThresholdDeps = uploadDepsFixture();
  const underThreshold = createConvertingUploader({ uploadDeps: defaultThresholdDeps, caps: { maxUploadBytes: 1024 } }, { video: { ports: { transcoder: { transcode } }, reportNote, linkDerivedMedia: async () => {} } });
  expect(await underThreshold(input)).not.toHaveProperty("conversionNotice");
  expect(await defaultThresholdDeps.mediaRepo.list({ workspaceId: "w" })).toHaveLength(1);
  expect(transcode).not.toHaveBeenCalled();
  expect(reportNote).not.toHaveBeenCalled();
});

it("the stored type decides the rule: a declared video stored as an image is skipped, an untyped store falls back to the declared type", async () => {
  const transcode = vi.fn(async () => { throw new Error("transcoder reached"); });
  const reportNote = vi.fn<ImportVideoConversion["reportNote"]>();
  const media = { id: "m1", workspaceId: "w", source: { sha256: "a".repeat(64), contentType: "image/png" } };
  const storeUpload = vi.fn(async () => ({ media }));
  const conversion = { deps: { ...uploadDepsFixture(), transcoder: { transcode }, linkDerivedMedia: async () => {} }, reportNote, thresholdBytes: 1 } as unknown as ImportVideoConversion;
  const store = withVideoConversionOnImport({ storeUpload: storeUpload as never, conversion });
  const input = { workspaceId: "w", bytes: new Uint8Array(8), filename: "clip.mp4", contentType: "video/mp4", createdByPrincipal: "owner" };
  expect(await store(input as never)).toEqual({ media });
  expect(reportNote).not.toHaveBeenCalled();
  media.source = { sha256: "a".repeat(64) } as typeof media.source;
  expect(await store(input as never)).toEqual({ media, conversionNotice: "web-copy-unavailable" });
  expect(reportNote.mock.calls.map(([call]) => call.note)).toEqual(["The video was saved as uploaded, but a web-playable copy could not be made."]);
});

it("a worded conversion refusal keeps its wording in the operator note", async () => {
  const deps = uploadDepsFixture();
  const reportNote = vi.fn<ImportVideoConversion["reportNote"]>();
  const transcode = vi.fn<ImportVideoConversion["deps"]["transcoder"]["transcode"]>(async () => ({ ok: false, reason: "unavailable", message: "Video conversion needs ffmpeg on this computer." }));
  const store = createConvertingUploader({ uploadDeps: deps, caps: { maxUploadBytes: 1024 } }, { video: { ports: { transcoder: { transcode } }, reportNote, linkDerivedMedia: async () => {}, thresholdBytes: 1 } });
  const result = await store({ workspaceId: "w", bytes: isoBmffVideoBytes("qt  "), filename: "Holiday.mov", contentType: "video/quicktime", createdByPrincipal: "owner" });
  expect(result.conversionNotice).toBe("web-copy-unavailable");
  const [[{ note, cause }]] = reportNote.mock.calls as [[{ note: string; cause: unknown }]];
  expect(cause).toBeInstanceOf(VideoConversionError);
  expect(note).toMatch(/^The video was saved as uploaded, but a web-playable copy was not made\. Video conversion needs ffmpeg on this computer\. \(ERR-[^)]+\)$/);
});

it("the staged uploader stores the original and converts only when a staged transcoder is configured", async () => {
  const reportNote = vi.fn<ImportVideoConversion["reportNote"]>();
  const linkDerivedMedia = async () => {};
  const caps = { maxUploadBytes: 1024, maxVideoUploadBytes: 4096 };
  const plainDeps = uploadDepsFixture();
  const plain = await createConvertingStagedUploader({ uploadDeps: plainDeps, caps })(stagedInput());
  expect(plain).not.toHaveProperty("conversionNotice");
  expect(plain.media.source.sha256).toBe(stagedInput().staged.sha256);
  const noStaged = await createConvertingStagedUploader({ uploadDeps: uploadDepsFixture(), caps }, { video: { ports: {}, reportNote, linkDerivedMedia, thresholdBytes: 1 } })(stagedInput());
  expect(noStaged).not.toHaveProperty("conversionNotice");

  const converted = { id: "web-copy" };
  const transcodeStaged = vi.fn(async () => ({ ok: true as const, value: converted }));
  const signal = new AbortController().signal;
  const input = stagedInput();
  const ok = await createConvertingStagedUploader({ uploadDeps: uploadDepsFixture(), caps }, { video: { ports: { stagedTranscoder: { transcodeStaged } as never }, reportNote, linkDerivedMedia, thresholdBytes: 1 } })(input, { signal });
  expect(ok).not.toHaveProperty("conversionNotice");
  expect(transcodeStaged.mock.calls).toEqual([[{ input: input.staged, target: "mp4-h264-aac-faststart", consume: expect.any(Function) }, { signal, maxOutputBytes: 1024 }]]);

  const failing = vi.fn(async () => ({ ok: false as const, reason: "busy" as const }));
  const refused = await createConvertingStagedUploader({ uploadDeps: uploadDepsFixture(), caps }, { video: { ports: { stagedTranscoder: { transcodeStaged: failing } as never }, reportNote, linkDerivedMedia, thresholdBytes: 1 } })(stagedInput());
  expect(refused.conversionNotice).toBe("web-copy-unavailable");
  expect(reportNote.mock.calls.map(([call]) => call.note)).toEqual([expect.stringMatching(/^The video was saved as uploaded, but a web-playable copy was not made\. Another video is being converted right now\. Try again when it finishes\. \(ERR-/)]);
});

it("without a video cap the staged conversion admits the original under the general cap", async () => {
  const reportNote = vi.fn<ImportVideoConversion["reportNote"]>();
  const transcodeStaged = vi.fn(async () => ({ ok: true as const, value: { id: "web-copy" } }));
  const input = stagedInput();
  const result = await createConvertingStagedUploader({ uploadDeps: uploadDepsFixture(), caps: { maxUploadBytes: input.staged.byteLength } },
    { video: { ports: { stagedTranscoder: { transcodeStaged } as never }, reportNote, linkDerivedMedia: async () => {}, thresholdBytes: 1 } })(input);
  expect(result).not.toHaveProperty("conversionNotice");
  expect(transcodeStaged).toHaveBeenCalledTimes(1);
  expect(reportNote).not.toHaveBeenCalled();
});
