import assert from "node:assert/strict";
import { passthroughBlobFence } from "./support/passthrough-blob-fence.js";
import { test } from "vitest";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { uploadMedia } from "../media-service.js";
import {
  VIDEO_TRANSCODE_THRESHOLD_BYTES, VideoConversionError, convertMediaVideo, shouldTranscodeOnImport,
  type ConvertMediaVideoDeps, type MediaTranscoderPort, type VideoTranscodeResult,
} from "../video-transcode.js";

const WORKSPACE_ID = "ws-video-transcode";
const PRINCIPAL_ID = "principal-video";
const MIB = 1024 * 1024;

/** A self-consistent ISO-BMFF ftyp box plus a payload marker, so the sniffer sees an MP4. */
function mp4Bytes({ marker }: { marker: number }): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0, 0, 0, 16], 0);
  bytes.set(Buffer.from("ftypisom"), 4);
  bytes.fill(marker, 16);
  return bytes;
}

test("shouldTranscodeOnImport keeps a video of exactly 50 MiB as-is", () => {
  assert.equal(VIDEO_TRANSCODE_THRESHOLD_BYTES, 50 * MIB);
  assert.equal(shouldTranscodeOnImport({ sizeBytes: 50 * MIB, contentType: "video/quicktime" }), false);
});

test("shouldTranscodeOnImport transcodes a video one byte over 50 MiB", () => {
  assert.equal(shouldTranscodeOnImport({ sizeBytes: 50 * MIB + 1, contentType: "video/quicktime" }), true);
  assert.equal(shouldTranscodeOnImport({ sizeBytes: 50 * MIB + 1, contentType: "Video/MP4; codecs=hvc1" }), true);
});

test("shouldTranscodeOnImport never transcodes a non-video, however large", () => {
  assert.equal(shouldTranscodeOnImport({ sizeBytes: 900 * MIB, contentType: "image/png" }), false);
  assert.equal(shouldTranscodeOnImport({ sizeBytes: 900 * MIB, contentType: "audio/mp4" }), false);
  assert.equal(shouldTranscodeOnImport({ sizeBytes: 900 * MIB, contentType: "" }), false);
});

test("shouldTranscodeOnImport honours a configured threshold", () => {
  assert.equal(shouldTranscodeOnImport({ sizeBytes: 11, contentType: "video/webm" }, { thresholdBytes: 10 }), true);
  assert.equal(shouldTranscodeOnImport({ sizeBytes: 10, contentType: "video/webm" }, { thresholdBytes: 10 }), false);
});

interface Harness {
  deps: ConvertMediaVideoDeps;
  mediaRepo: InMemoryMediaRepo;
  blobStore: InMemoryBlobStore;
  links: Array<{ workspaceId: string; originalId: string; derivedId: string; target: string }>;
  calls: Array<{ input: Uint8Array; target: string }>;
}

async function harness({ result, original = mp4Bytes({ marker: 1 }), onTranscode }: {
  result?: VideoTranscodeResult; original?: Uint8Array; onTranscode?: () => void;
}): Promise<Harness & { originalId: string; originalSnapshot: string }> {
  const mediaRepo = new InMemoryMediaRepo({});
  const blobRepo = new InMemoryAssetBlobRepo({});
  const renditionRepo = new InMemoryAssetRenditionRepo({});
  const blobStore = new InMemoryBlobStore();
  let counter = 0;
  const calls: Harness["calls"] = [];
  const links: Harness["links"] = [];
  const transcoder: MediaTranscoderPort = {
    transcode: async ({ input, target }) => {
      calls.push({ input, target });
      onTranscode?.();
      return result ?? { ok: true, bytes: mp4Bytes({ marker: 2 }) };
    },
  };
  const deps: ConvertMediaVideoDeps = {
    clock: { nowMs: () => Date.parse("2026-11-23T00:00:00.000Z") },
    idGen: { newId: () => `id-${++counter}` },
    mediaRepo, blobRepo, renditionRepo, blobStore, blobFence: passthroughBlobFence, transcoder,
    linkDerivedMedia: async (link) => { links.push(link); },
    randomHex: ({ bytes }) => "ab".repeat(bytes),
  };
  const { media } = await uploadMedia({
    deps, input: { workspaceId: WORKSPACE_ID, bytes: original, filename: "Beach day.mp4", contentType: "video/mp4", alt: "Waves", createdByPrincipal: PRINCIPAL_ID },
  });
  const originalSnapshot = JSON.stringify(await mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: media.id }));
  return { deps, mediaRepo, blobStore, links, calls, originalId: media.id, originalSnapshot };
}

const input = (mediaId: string) => ({ workspaceId: WORKSPACE_ID, mediaId, createdByPrincipal: PRINCIPAL_ID });

test("convertMediaVideo stores the web copy as a new item and leaves the original untouched", async () => {
  const h = await harness({});
  const result = await convertMediaVideo({ deps: h.deps, input: input(h.originalId) });

  assert.equal(result.originalId, h.originalId);
  assert.notEqual(result.convertedId, h.originalId);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]!.target, "mp4-h264-aac-faststart");
  assert.deepEqual([...h.calls[0]!.input], [...mp4Bytes({ marker: 1 })]);
  assert.equal(JSON.stringify(await h.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: h.originalId })), h.originalSnapshot);
  const converted = await h.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: result.convertedId });
  assert.equal(converted?.title, "Beach day (web)");
  assert.equal(converted?.alt, "Waves");
  assert.equal(converted?.source.contentType, "video/mp4");
  assert.equal(converted?.status, "active");
  assert.deepEqual(h.links, [{ workspaceId: WORKSPACE_ID, originalId: h.originalId, derivedId: result.convertedId, target: "mp4-h264-aac-faststart" }]);
});

test("convertMediaVideo turns a missing ffmpeg into a plain message with an ERR- id and writes nothing", async () => {
  const h = await harness({ result: { ok: false, reason: "unavailable", message: "Video conversion needs ffmpeg on this computer." } });
  const before = (await h.mediaRepo.list({ workspaceId: WORKSPACE_ID })).length;
  await assert.rejects(convertMediaVideo({ deps: h.deps, input: input(h.originalId) }), (error: unknown) => {
    assert.ok(error instanceof VideoConversionError);
    assert.equal(error.reason, "unavailable");
    assert.equal(error.errorId, "ERR-ABAB-ABAB-ABAB-ABAB");
    assert.equal(error.message, "Video conversion needs ffmpeg on this computer. (ERR-ABAB-ABAB-ABAB-ABAB)");
    return true;
  });
  assert.equal((await h.mediaRepo.list({ workspaceId: WORKSPACE_ID })).length, before);
  assert.equal(h.links.length, 0);
});

test("convertMediaVideo aborted before the transcode call never transcodes or writes", async () => {
  const h = await harness({});
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(convertMediaVideo({ deps: h.deps, input: input(h.originalId) }, { signal: controller.signal }),
    (error: unknown) => error instanceof VideoConversionError && error.reason === "canceled");
  assert.equal(h.calls.length, 0);
  assert.equal((await h.mediaRepo.list({ workspaceId: WORKSPACE_ID })).length, 1);
});

test("convertMediaVideo aborted while transcoding discards the result instead of writing it", async () => {
  const controller = new AbortController();
  const h = await harness({ onTranscode: () => controller.abort() });
  await assert.rejects(convertMediaVideo({ deps: h.deps, input: input(h.originalId) }, { signal: controller.signal }),
    (error: unknown) => error instanceof VideoConversionError && error.reason === "canceled");
  assert.equal(h.calls.length, 1);
  assert.equal((await h.mediaRepo.list({ workspaceId: WORKSPACE_ID })).length, 1);
});

test("convertMediaVideo refuses an input over the configured maximum before transcoding", async () => {
  const h = await harness({});
  await assert.rejects(convertMediaVideo({ deps: h.deps, input: input(h.originalId) }, { maxInputBytes: 31 }), (error: unknown) => {
    assert.ok(error instanceof VideoConversionError);
    assert.equal(error.reason, "too-large");
    assert.match(error.message, /too large to convert.*\(ERR-[0-9A-F]{4}(-[0-9A-F]{4}){3}\)$/);
    return true;
  });
  assert.equal(h.calls.length, 0);
});

test("convertMediaVideo refuses a non-video item and never transcodes it", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const h = await harness({ original: png });
  await assert.rejects(convertMediaVideo({ deps: h.deps, input: input(h.originalId) }),
    (error: unknown) => error instanceof VideoConversionError && error.reason === "not-video" && /not a video/.test(error.message));
  assert.equal(h.calls.length, 0);
});

test("convertMediaVideo removes the new item again when the provenance link cannot be saved", async () => {
  const h = await harness({});
  h.deps.linkDerivedMedia = async () => { throw new Error("link store offline"); };
  await assert.rejects(convertMediaVideo({ deps: h.deps, input: input(h.originalId) }), /link store offline/);
  const rows = await h.mediaRepo.list({ workspaceId: WORKSPACE_ID });
  assert.deepEqual(rows.map(row => row.id), [h.originalId]);
});
