import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { uploadMedia } from "../media-service.js";
import {
  VIDEO_TRANSCODE_THRESHOLD_BYTES, VideoConversionError, convertMediaVideo, convertStagedMediaVideo, shouldTranscodeOnImport,
  type ConvertMediaVideoDeps,
} from "../video-transcode.js";
import type { BlobStorePort } from "../ports.js";
import type { MediaTranscoderPort, VideoTranscodeResult, StagedMediaFile, StagedMediaTranscoderPort } from "@jini-ai/core/contracts/site/cms-media";

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
    createHash, clock: { nowMs: () => Date.parse("2026-11-23T00:00:00.000Z") },
    idGen: { newId: () => `id-${++counter}` },
    mediaRepo, blobRepo, renditionRepo, blobStore, transcoder,
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

test("convertMediaVideo refuses a video the store reports as oversize before reading its bytes", async () => {
  const h = await harness({});
  const reads: string[] = [];
  const get = h.blobStore.get.bind(h.blobStore);
  h.blobStore.get = async (request) => { reads.push(request.storageKey); return get(request); };
  h.blobStore.sizeOf = async () => 10 * MIB;
  await assert.rejects(convertMediaVideo({ deps: h.deps, input: input(h.originalId) }, { maxInputBytes: MIB }),
    (error: unknown) => error instanceof VideoConversionError && error.reason === "too-large" && /The limit is 1 MB\./.test(error.message));
  assert.deepEqual(reads, [], "the size guard runs before any byte read");
  assert.equal(h.calls.length, 0);
});

test("convertMediaVideo still refuses oversize bytes when the store cannot report a size", async () => {
  const h = await harness({});
  let reads = 0;
  const get = h.blobStore.get.bind(h.blobStore);
  h.blobStore.get = async (request) => { reads += 1; return get(request); };
  h.blobStore.sizeOf = async () => null;
  await assert.rejects(convertMediaVideo({ deps: h.deps, input: input(h.originalId) }, { maxInputBytes: 31 }),
    (error: unknown) => error instanceof VideoConversionError && error.reason === "too-large");
  assert.equal(reads, 1);
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

function describeStage({ bytes, path }: { bytes: Uint8Array; path: string }): StagedMediaFile {
  return {
    path, root: "/stage", contentType: "video/mp4", byteLength: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"),
    async *openChunks() { yield bytes; },
  };
}

test("staged conversion streams the new bytes and links the web copy without reading the original object", async () => {
  const h = await harness({});
  const original = describeStage({ bytes: mp4Bytes({ marker: 1 }), path: "/stage/original" });
  const outputBytes = mp4Bytes({ marker: 2 });
  const output = describeStage({ bytes: outputBytes, path: "/stage/output" });
  const seen: unknown[] = [];
  const transcodeStaged: StagedMediaTranscoderPort["transcodeStaged"] = async ({ input, target, consume }, options) => {
    seen.push({ input, target, options });
    return { ok: true, value: await consume(output) };
  };
  const read = vi.spyOn(h.blobStore, "get");
  const resolveStagedWriter: NonNullable<BlobStorePort["resolveStagedWriter"]> = async () =>
    async ({ workspaceId, sha256, byteLength, openChunks }, options) => {
      const chunks = [];
      for await (const chunk of openChunks({}, options)) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (bytes.byteLength !== byteLength) throw new Error("writer got the wrong staged length");
      return h.blobStore.put({ workspaceId, sha256, bytes });
    };
  const blobStore = Object.assign(h.blobStore, { resolveStagedWriter });
  const signal = new AbortController().signal;
  const { originalId, convertedId, media } = await convertStagedMediaVideo({
    deps: { ...h.deps, blobStore, transcoder: { transcodeStaged } }, input: input(h.originalId), staged: original,
  }, { signal, maxInputBytes: 32, maxOutputBytes: 40 });

  assert.deepEqual(seen, [{ input: original, target: "mp4-h264-aac-faststart", options: { signal, maxOutputBytes: 40 } }]);
  assert.deepEqual(read.mock.calls, []);
  assert.equal(originalId, h.originalId);
  assert.notEqual(convertedId, originalId);
  assert.equal(JSON.stringify(await h.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: originalId })), h.originalSnapshot);
  assert.deepEqual(await h.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: convertedId }), media);
  assert.equal(media.source.sha256, output.sha256);
  assert.equal(media.title, "Beach day (web)");
  assert.equal(media.alt, "Waves");
  const blob = await h.deps.blobRepo.findByHash({ workspaceId: WORKSPACE_ID, sha256: output.sha256 });
  assert.deepEqual([...await h.blobStore.get({ storageKey: blob!.storageKey })], [...outputBytes]);
  assert.deepEqual(h.links, [{ workspaceId: WORKSPACE_ID, originalId, derivedId: convertedId, target: "mp4-h264-aac-faststart" }]);
});

test("staged conversion refuses wrong digest or oversize before decoding and reports codec refusals unchanged", async () => {
  const h = await harness({});
  const staged = describeStage({ bytes: mp4Bytes({ marker: 1 }), path: "/stage/original" });
  const seen: string[] = [];
  const transcodeStaged: StagedMediaTranscoderPort["transcodeStaged"] = async ({ target }) => {
    seen.push(target);
    return { ok: false, reason: "unavailable", message: "The local video codec is unavailable." };
  };
  const base = { deps: { ...h.deps, transcoder: { transcodeStaged } }, input: input(h.originalId), staged };
  await assert.rejects(convertStagedMediaVideo({ ...base, staged: { ...staged, sha256: "c".repeat(64) } }), error =>
    error instanceof VideoConversionError && error.reason === "invalid");
  await assert.rejects(convertStagedMediaVideo(base, { maxInputBytes: 31 }), error =>
    error instanceof VideoConversionError && error.reason === "too-large");
  assert.deepEqual(seen, []);
  await assert.rejects(convertStagedMediaVideo(base, { maxInputBytes: 32 }), error =>
    error instanceof VideoConversionError && error.reason === "unavailable" && error.message.includes("The local video codec is unavailable."));
  assert.deepEqual(seen, ["mp4-h264-aac-faststart"]);
  assert.deepEqual((await h.mediaRepo.list({ workspaceId: WORKSPACE_ID })).map(asset => asset.id), [h.originalId]);
  assert.deepEqual(h.links, []);
});

test("convertMediaVideo without an injected random source mints a fresh Web Crypto error id per failure", async () => {
  const h = await harness({ result: { ok: false, reason: "unavailable", message: "Video conversion needs ffmpeg on this computer." } });
  const { randomHex: _injected, ...deps } = h.deps;
  const ids: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(convertMediaVideo({ deps, input: input(h.originalId) }), (error: unknown) => {
      assert.ok(error instanceof VideoConversionError);
      assert.match(error.errorId, /^ERR-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
      ids.push(error.errorId);
      return true;
    });
  }
  assert.notEqual(ids[0], ids[1]);
});

test("convertMediaVideo refuses a trashed original and one whose stored file is missing, before transcoding", async () => {
  const h = await harness({});
  await assert.rejects(convertMediaVideo({ deps: { ...h.deps, blobRepo: new InMemoryAssetBlobRepo({}) }, input: input(h.originalId) }),
    (error: unknown) => error instanceof VideoConversionError && error.reason === "invalid"
      && error.message === "The original video file is missing from storage, so it cannot be converted. (ERR-ABAB-ABAB-ABAB-ABAB)");
  const original = await h.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: h.originalId });
  assert.ok(original);
  await h.mediaRepo.save({ ...original, status: "trashed" });
  await assert.rejects(convertMediaVideo({ deps: h.deps, input: input(h.originalId) }),
    (error: unknown) => error instanceof VideoConversionError && error.reason === "trashed");
  assert.equal(h.calls.length, 0);
});
