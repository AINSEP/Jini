import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { VideoCodecProbePort } from "@jini-ai/core/contracts/site/cms-media";
import { uploadMedia } from "../media-service.js";
import { replaceMediaFile, type MediaFileReplacementRepoPort } from "../replace-media-file.js";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { createFfmpegVideoCodecProbe } from "../node.js";
import { createVideoExtractionLock } from "../video-frames.ffmpeg.js";
import { toAdminMediaResponse } from "../../admin-http/http/media.js";
import { isoBmffVideoBytes } from "./iso-bmff-fixture.js";

/** @file Video codec hint: recorded only from a confirmed probe of the bytes, never from MIME or container. */

const QUICKTIME = isoBmffVideoBytes("qt  ");
const BINARIES = async () => ({ nice: "/host/nice", ffmpeg: "/host/ffmpeg", ffprobe: "/host/ffprobe" });
const probeJson = (codec: string) => JSON.stringify({ format: { duration: "2", format_name: "mov,mp4" }, streams: [{ codec_type: "video", codec_name: codec, width: 64, height: 48 }] });

function fixture() {
  let ids = 0;
  const mediaRepo: MediaFileReplacementRepoPort = Object.assign(new InMemoryMediaRepo({}), {
    replaceFileIfVersion: async () => ({ applied: true }),
    saveRenditionIfSource: async () => ({ applied: true }),
  });
  const blobStore = new InMemoryBlobStore();
  const assetBlobRepo = new InMemoryAssetBlobRepo({});
  const base = { createHash, clock: { nowMs: () => Date.parse("2026-11-25T00:00:00Z") }, idGen: { newId: () => `id-${++ids}` }, blobStore };
  return {
    uploadDeps: { ...base, mediaRepo, blobRepo: assetBlobRepo, renditionRepo: new InMemoryAssetRenditionRepo({}) },
    replaceDeps: { ...base, workspaceId: "ws", mediaRepo, assetBlobRepo },
  };
}

const uploadQuickTime = (probe: VideoCodecProbePort, optional: { signal?: AbortSignal } = {}) => uploadMedia({ deps: fixture().uploadDeps, input: {
  workspaceId: "ws", filename: "clip.mov", contentType: "video/quicktime", bytes: QUICKTIME, createdByPrincipal: "owner" } }, { videoCodecProbe: probe, ...optional });
const describe1 = (media: Parameters<typeof toAdminMediaResponse>[0]["media"]) => toAdminMediaResponse({ media, contentType: "video/quicktime", publicUrl: null, byteSize: null });

describe("video codec hint", () => {
  it("confirmed HEVC is recorded and a QuickTime container alone is not HEVC", async () => {
    const seen: string[] = [];
    const hevc = await uploadQuickTime({ probe: async ({ bytes, contentType }) => { seen.push(`${contentType}:${bytes.byteLength}`); return "hevc"; } });
    expect(hevc.media.source.videoCodec).toBe("hevc");
    expect(describe1(hevc.media).videoCodec).toBe("hevc");
    expect(seen).toEqual([`video/quicktime:${QUICKTIME.byteLength}`]);

    const unknown = await uploadQuickTime({ probe: async () => undefined });
    expect("videoCodec" in unknown.media.source).toBe(false);
    expect("videoCodec" in describe1(unknown.media)).toBe(false);

    // The ffmpeg probe reads the codec from the stream metadata, never from the declared MIME.
    const run = async (required: { args: readonly string[] }) => { seen.push(required.args.join(" ")); return Buffer.from(probeJson("h264")); };
    const adapter = createFfmpegVideoCodecProbe({ findBinaries: BINARIES, runProcess: run }, {});
    expect(await adapter.probe({ bytes: QUICKTIME, contentType: "video/quicktime" })).toBe("h264");
    const hevcAdapter = createFfmpegVideoCodecProbe({ findBinaries: BINARIES, runProcess: async () => Buffer.from(probeJson("hevc")) }, {});
    expect(await hevcAdapter.probe({ bytes: QUICKTIME, contentType: "video/mp4" })).toBe("hevc");
    const vp9 = createFfmpegVideoCodecProbe({ findBinaries: BINARIES, runProcess: async () => Buffer.from(probeJson("vp9")) }, {});
    expect(await vp9.probe({ bytes: QUICKTIME, contentType: "video/quicktime" })).toBe("other");
    const args = seen.at(-1) ?? "";
    expect(args).toContain("-protocol_whitelist file");
    expect(args.startsWith("-n 19 /host/ffprobe")).toBe(true);
    // Bytes that do not sniff as a supported container are never probed, whatever the label says.
    expect(await adapter.probe({ bytes: new Uint8Array([1, 2, 3]), contentType: "video/quicktime" })).toBeUndefined();
  });

  it("unsupported or aborted probing leaves the codec unknown without changing accepted bytes", async () => {
    const thrown = await uploadQuickTime({ probe: async () => { throw new Error("probe crashed"); } });
    expect("videoCodec" in thrown.media.source).toBe(false);
    expect(thrown.media.source.sha256).toBe(createHash("sha256").update(QUICKTIME).digest("hex"));

    const controller = new AbortController();
    controller.abort();
    const signals: (AbortSignal | undefined)[] = [];
    const aborted = await uploadQuickTime({ probe: async (_r, { signal } = {}) => { signals.push(signal); throw new Error("canceled"); } }, { signal: controller.signal });
    expect(signals).toEqual([controller.signal]);
    expect("videoCodec" in aborted.media.source).toBe(false);

    const lock = createVideoExtractionLock({});
    let input = "";
    const failing = createFfmpegVideoCodecProbe({ findBinaries: BINARIES, lock, runProcess: async (required, optional) => {
      input = required.args.at(-1) ?? "";
      expect(existsSync(input)).toBe(true);
      expect(optional.signal).toBe(controller.signal);
      expect(optional.timeoutMs).toBeGreaterThan(0);
      expect(optional.maxOutputBytes).toBeLessThanOrEqual(64 * 1024);
      throw new Error("canceled");
    } }, {});
    expect(await failing.probe({ bytes: QUICKTIME, contentType: "video/quicktime" }, { signal: controller.signal })).toBeUndefined();
    expect(existsSync(input)).toBe(false);
    const release = lock.tryAcquire({}, {});
    expect(release).toBeDefined();
    release?.();

    const unsupported = createFfmpegVideoCodecProbe({ findBinaries: BINARIES, runProcess: async () => Buffer.from('{"streams":[]}') }, {});
    expect(await unsupported.probe({ bytes: QUICKTIME, contentType: "video/quicktime" })).toBeUndefined();
    const missing = createFfmpegVideoCodecProbe({ findBinaries: async () => undefined }, {});
    expect(await missing.probe({ bytes: QUICKTIME, contentType: "video/quicktime" })).toBeUndefined();
  });

  it("a replacement records the codec of the new bytes only", async () => {
    const f = fixture();
    const { media } = await uploadMedia({ deps: f.uploadDeps, input: { workspaceId: "ws", filename: "a.mov", contentType: "video/quicktime", bytes: QUICKTIME, createdByPrincipal: "o" } }, { videoCodecProbe: { probe: async () => "hevc" } });
    const next = isoBmffVideoBytes("M4V ");
    const replaced = await replaceMediaFile({ deps: f.replaceDeps, media, bytes: next, contentType: "video/x-m4v", principalId: "o" }, { videoCodecProbe: { probe: async () => "h264" } });
    expect(replaced?.source.videoCodec).toBe("h264");
    const failed = await replaceMediaFile({ deps: f.replaceDeps, media, bytes: next, contentType: "video/x-m4v", principalId: "o" }, { videoCodecProbe: { probe: async () => { throw new Error("x"); } } });
    expect(failed && "videoCodec" in failed.source).toBe(false);
  });
});

// Gap fill (cloud A3-4).
describe("ffmpeg codec probe edges", () => {
  // Mutation: map 'unknown' through NAMED_CODECS (would report "other").
  it("a video stream without a codec name stays unknown instead of being reported as another codec", async () => {
    const noName = JSON.stringify({ format: { duration: "2", format_name: "mov,mp4" }, streams: [{ codec_type: "video", width: 64, height: 48 }] });
    const adapter = createFfmpegVideoCodecProbe({ findBinaries: BINARIES, runProcess: async () => Buffer.from(noName) }, {});
    expect(await adapter.probe({ bytes: QUICKTIME, contentType: "video/quicktime" })).toBeUndefined();
  });

  // Mutation: ignore a refused lock (`if (!release) return undefined` removed) and probe anyway.
  it("a probe that finds the shared decoder lock busy answers unknown without discovering or running anything", async () => {
    const lock = createVideoExtractionLock({});
    const held = lock.tryAcquire({}, {});
    expect(typeof held).toBe("function");
    const touched: string[] = [];
    const adapter = createFfmpegVideoCodecProbe({ lock,
      findBinaries: async () => { touched.push("discover"); return BINARIES(); },
      runProcess: async () => { touched.push("run"); return Buffer.from(probeJson("h264")); } }, {});
    expect(await adapter.probe({ bytes: QUICKTIME, contentType: "video/quicktime" })).toBeUndefined();
    expect(touched).toEqual([]);
    held?.();
    // Once released, the same adapter probes normally.
    expect(await adapter.probe({ bytes: QUICKTIME, contentType: "video/quicktime" })).toBe("h264");
    expect(touched).toEqual(["discover", "run"]);
  });
});
