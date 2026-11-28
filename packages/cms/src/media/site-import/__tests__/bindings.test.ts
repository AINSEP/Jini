import { expect, test, vi } from "vitest";
import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
import { createHash } from "node:crypto";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuardedFileReader, createNodeGuardedReaderFilesystem, createStagedFileAdapter, FsFilePathError } from "@jini-ai/platform/fs";
import { createLocalFsObjectStore } from "@jini-ai/platform/object-store";
import { bindMediaImportTools, type MediaImportToolDeps } from "../bindings.js";
import { mediaImportDerivedRisk } from "../tool-registrations.js";
import { MediaImportValidationError } from "../../import/index.js";
import { createConvertingStagedUploader, createConvertingUploader, type VideoImportOptions } from "../../site/import-video-conversion.js";
import { blobStoreFromObjectStore, computeBlobStorageKey, InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryVersionedMediaRepo, sniffContentType } from "../../index.js";
import { replaceMediaFile } from "../../replace-media-file.js";
import { InMemoryMediaContentTypeStore } from "../../site/content-type-store.js";
import type { MediaRecord } from "@jini-ai/core/contracts/site/cms-media";

const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

class EgressRefusedError extends Error {
  readonly callerSafeMessage: string;
  constructor({ message }: { message: string }, { callerSafeMessage }: { callerSafeMessage: string }) {
    super(message);
    this.callerSafeMessage = callerSafeMessage;
  }
}

function fixture(resolveSiteFileRequest: Parameters<typeof bindMediaImportTools<Omit<VideoImportOptions, "linkDerivedMedia">>>[0]["resolveSiteFileRequest"] =
  ({ relativePath }) => ({ rootPath: "/site", relativePath })) {
  const media: MediaRecord = { id: "asset", workspaceId: "site", slug: "asset", title: "Asset", alt: "", caption: "", credit: "",
    source: { sha256: "hash" }, status: "active", version: 3, createdAt: "2026-11-25", updatedAt: "2026-11-25",
    width: null, height: null, cssClass: null, htmlAttributes: null };
  const upload = vi.fn(async () => ({ media }));
  const createConvertingUploader = vi.fn((
    _input: Parameters<Parameters<typeof bindMediaImportTools<Omit<VideoImportOptions, "linkDerivedMedia">>>[0]["createConvertingUploader"]>[0],
    _optional: { video?: Omit<VideoImportOptions, "linkDerivedMedia"> | undefined },
  ) => upload);
  const read = vi.fn(async () => bytes);
  const replaceMediaFile = vi.fn(async () => null);
  const log = vi.fn();
  const fetchImage = vi.fn(async () => ({ bytes, contentType: "image/png", url: new URL("https://cdn.example/final.png") }));
  const binding = bindMediaImportTools<Omit<VideoImportOptions, "linkDerivedMedia">>({ fsRootIds: ["site"], recoveryText: "Pick a folder.", mediaAssetReadToolId: "read_asset",
    resolveSiteFileRequest, openFsFileForRead: read,
    withLocalStream: async () => { throw new Error("unexpected staged read"); },
    withStagedFile: async () => { throw new Error("unexpected staging"); },
    createConvertingStagedUploader: () => upload,
    uploadLimitForFile: () => 100, uploadCaps: { maxUploadBytes: 100 },
    fetchImage,
    validateImageBytes: () => "image/png", createConvertingUploader, replaceMediaFile,
    EgressRefusedError,
    isPathRefusal: ({ error }) => error instanceof URIError, logEgressRefusal: log,
  });
  const routeDeps = { workspaceId: "site", authorize: async () => ({ allowed: true, reason: "grant" }),
    mediaRepo: { findById: async () => media, replaceFileIfVersion: vi.fn(), saveRenditionIfSource: vi.fn() },
    mediaContentTypeStore: { set: vi.fn() }, blobStore: {}, mediaImportLocalMaxBytes: 200 } as unknown as Parameters<typeof binding.buildMediaImportRegistrations>[0]["deps"];
  const resolvePublicUrls = vi.fn(async () => new Map([["asset", "/m/asset/"]]));
  const ctx: ToolExecutionContext = { executionId: "e", run: { id: "run" }, principal: { id: "human" }, signal: new AbortController().signal, input: {} };
  return { binding, routeDeps, resolvePublicUrls, ctx, read, upload, createConvertingUploader, replaceMediaFile, log, fetchImage, media };
}

test("local reads are clamped to the file ceiling and allow a smaller host limit", async () => {
  const f = fixture();
  const [tool] = f.binding.buildMediaImportRegistrations({ ...f, deps: f.routeDeps }, {}).filter(row => row.descriptor.id === "media_import_local_file");
  await tool!.handler({ ...f.ctx, input: { root: "site", path: "asset.png" } });
  expect(f.read).toHaveBeenLastCalledWith({ rootPath: "/site", relativePath: "asset.png", maxBytes: 100 });
  f.routeDeps.mediaImportLocalMaxBytes = 20;
  await tool!.handler({ ...f.ctx, input: { root: "site", path: "asset.png" } });
  expect(f.read).toHaveBeenLastCalledWith({ rootPath: "/site", relativePath: "asset.png", maxBytes: 20 });
  expect(f.createConvertingUploader.mock.calls.map(([, optional]) => optional.video)).toEqual([undefined, undefined]);
});

test("a bound local video above the ordinary ceiling persists the original bytes through staged storage", async () => {
  const root = await filesystem.mkdtemp(join(tmpdir(), "bound-media-import-"));
  try {
    const workspaceId = "site";
    const path = "clip.mov";
    const video = Buffer.alloc(32, 0x35);
    video.writeUInt32BE(video.length);
    video.write("ftypqt  ", 4);
    const sha256 = createHash("sha256").update(video).digest("hex");
    await filesystem.writeFile(join(root, path), video);
    const blobStore = blobStoreFromObjectStore({ store: createLocalFsObjectStore({ rootDir: join(root, "objects") }) });
    const assetRenditionRepo = new InMemoryAssetRenditionRepo({});
    const mediaRepo = new InMemoryVersionedMediaRepo({}, { renditionRepo: assetRenditionRepo });
    let id = 0;
    const deps: MediaImportToolDeps = { workspaceId, authorize: async () => ({ allowed: true, reason: "grant" }),
      mediaRepo, assetBlobRepo: new InMemoryAssetBlobRepo({}), assetRenditionRepo, blobStore,
      clock: { nowMs: () => 0 }, idGen: { newId: () => String(++id) }, createHash, siteBinding: { dir: root },
      mediaContentTypeStore: new InMemoryMediaContentTypeStore(),
      mediaImportHttpClient: { send: async () => { throw new Error("unexpected HTTP request"); } },
    };
    const { withStagedFile } = createStagedFileAdapter({ filesystem, sniffContentType, withTempRoot: ({ work }) => work({ root }) });
    const openFsFileForRead = vi.fn(async () => { throw new Error("unexpected whole-file read"); });
    const binding = bindMediaImportTools<VideoImportOptions>({
      fsRootIds: ["site"], recoveryText: "Pick a folder.", mediaAssetReadToolId: "read_asset",
      resolveSiteFileRequest: ({ routeDeps, relativePath }) => ({ rootPath: routeDeps.siteBinding.dir, relativePath }),
      openFsFileForRead,
      withLocalStream: ({ rootPath, ...input }, optional) => createGuardedFileReader({
        rootPath, filesystem: createNodeGuardedReaderFilesystem({}), denyRules: { segments: new Set(), filenamePatterns: [] },
        limits: { maxFileBytes: 64, binarySniffBytes: 16, maxListedFiles: 8, maxWalkDepth: 2, maxWalkEntries: 8 },
      }, { descriptorRead: {} }).withGuardedBinaryStream(input, optional),
      withStagedFile, createConvertingUploader, createConvertingStagedUploader, replaceMediaFile,
      uploadLimitForFile: () => 64, uploadCaps: { maxUploadBytes: 16, maxVideoUploadBytes: 64 },
      fetchImage: async () => { throw new Error("unexpected remote fetch"); }, validateImageBytes: sniffContentType,
      EgressRefusedError, isPathRefusal: ({ error }) => error instanceof FsFilePathError, logEgressRefusal: vi.fn(),
    });
    const tool = binding.buildMediaImportRegistrations({ deps, resolvePublicUrls: async () => new Map() })
      .find(row => row.descriptor.id === "media_import_local_file")!;
    const receipt = await tool.handler({ executionId: "e", run: { id: "run" }, principal: { id: "human" },
      signal: new AbortController().signal, input: { root: "site", path } });
    const rows = await mediaRepo.list({ workspaceId });
    expect(rows).toMatchObject([{ originalFilename: "clip.mov", createdBy: "human",
      source: { sha256, contentType: "video/quicktime", provenance: { kind: "upload", path: "clip.mov" } } }]);
    expect(receipt).toMatchObject({ media: { id: rows[0]?.id, sha256 } });
    expect(Buffer.from(await blobStore.get({ storageKey: computeBlobStorageKey({ workspaceId, sha256 }) }))).toEqual(video);
    expect(openFsFileForRead).not.toHaveBeenCalled();
  } finally { await filesystem.rm(root, { recursive: true, force: true }); }
});

test("legacy shape classification includes typed import and egress errors but not transport failures", () => {
  const f = fixture();
  expect(f.binding.isImportShapeRejection({ error: new MediaImportValidationError({ message: "invalid" }) })).toBe(true);
  expect(f.binding.isImportShapeRejection({ error: new EgressRefusedError({ message: "private address" }, { callerSafeMessage: "public refusal" }) })).toBe(true);
  expect(f.binding.isImportShapeRejection({ error: new Error("transport timeout") })).toBe(false);
});

test("operator detail stays in the log while the caller receives the typed safe error", async () => {
  const f = fixture();
  const error = new EgressRefusedError({ message: "internal-db resolves 10.0.4.7" }, { callerSafeMessage: "public refusal" });
  const result = f.binding.withCallerSafeEgressRefusal({ log: f.log, work: async () => { throw error; } }, { toolId: "theme_import_file_from_url" });
  await expect(result).rejects.toThrow("public refusal");
  await expect(result).rejects.toBeInstanceOf(EgressRefusedError);
  await expect(result).rejects.not.toBe(error);
  expect(f.log).toHaveBeenCalledWith("[media-import] theme_import_file_from_url egress refused: internal-db resolves 10.0.4.7");
});

test("URL receipts retain the final source URL and the converter receives the injected video options", async () => {
  const f = fixture();
  const videoImport: Omit<VideoImportOptions, "linkDerivedMedia"> = { ports: { videoCodecProbe: { probe: vi.fn(async () => undefined) } }, reportNote: vi.fn() };
  const tools = f.binding.buildMediaImportRegistrations({ ...f, deps: f.routeDeps, videoImport }, {});
  const tool = tools.find(row => row.descriptor.id === "media_import_from_url")!;
  expect(await tool.handler({ ...f.ctx, input: { url: "https://request.example/image" } })).toMatchObject({ media: { sourceUrl: "https://cdn.example/final.png", publicUrl: "/m/asset/", version: 3 } });
  expect(f.createConvertingUploader).toHaveBeenCalledWith(expect.objectContaining({ caps: { maxUploadBytes: 100 } }), { video: videoImport });
  expect(f.upload).toHaveBeenCalledWith(expect.objectContaining({ provenance: { kind: "url", url: "https://cdn.example/final.png" } }));
  expect(f.routeDeps.mediaContentTypeStore.set).toHaveBeenCalledWith({ workspaceId: "site", sha256: "hash", contentType: "image/png" });
  await tools.find(row => row.descriptor.id === "media_import_local_file")!.handler({ ...f.ctx, input: { root: "site", path: "asset.png" } });
  expect(f.createConvertingUploader).toHaveBeenCalledTimes(2);
  expect(f.createConvertingUploader.mock.calls[0]![1].video).toBe(videoImport);
  expect(f.createConvertingUploader.mock.calls[1]![1].video).toBe(videoImport);
});

test("replacement conflicts preserve the probe, signal and refusal without uploading", async () => {
  const f = fixture();
  const videoCodecProbe = { probe: vi.fn(async () => undefined) };
  const tool = f.binding.buildMediaImportRegistrations({ ...f, deps: f.routeDeps, videoImport: { ports: { videoCodecProbe }, reportNote: vi.fn() } }, {}).find(row => row.descriptor.id === "media_replace_file")!;
  await expect(tool.handler({ ...f.ctx, input: { mediaId: "asset", root: "site", path: "asset.png" } })).rejects.toThrow("changed while replacing");
  expect(f.replaceMediaFile).toHaveBeenCalledWith(expect.objectContaining({ principalId: "human" }), { maxUploadBytes: 100, videoCodecProbe, signal: f.ctx.signal });
  expect(f.upload).not.toHaveBeenCalled();
});

test("local request binding preserves typed path refusals and translates other thrown values without reading bytes", () => {
  const input = { root: "site", relativePath: "asset.png" };
  const denied = new URIError("restricted source");
  for (const [error, message] of [
    [new Error("owner-picked root is unavailable"), "owner-picked root is unavailable"],
    ["internal thrown value", "Source must be inside this site or the owner-picked folder. Pick a folder."],
  ] as const) {
    const f = fixture(() => { throw error; });
    const resolve = () => f.binding.resolveLocalImportRequest({ routeDeps: f.routeDeps, ...input });
    expect(resolve).toThrow(MediaImportValidationError);
    expect(resolve).toThrow(message);
    expect(f.read.mock.calls).toEqual([]);
  }
  const f = fixture(() => { throw denied; });
  expect(() => f.binding.resolveLocalImportRequest({ routeDeps: f.routeDeps, ...input })).toThrow(URIError);
  expect(() => f.binding.resolveLocalImportRequest({ routeDeps: f.routeDeps, ...input })).toThrow('restricted source');
  expect(f.read.mock.calls).toEqual([]);
});

test("a failure that is not an egress refusal passes through the caller-safe wrapper unchanged and logs nothing", async () => {
  const f = fixture();
  const fault = new Error("socket hang up");
  await expect(f.binding.withCallerSafeEgressRefusal({ log: f.log, work: async () => { throw fault; } })).rejects.toBe(fault);
  expect(f.log).not.toHaveBeenCalled();
});

test("contributed import tools log an egress refusal to the host's refusal log, else to the binding logger, and return only the safe message", async () => {
  const contributor = fixture().binding.contributeMediaImportTools({ resolvePublicUrls: async () => new Map() });
  expect(contributor.domain).toBe("media-import");
  expect(contributor.risk).toBe(mediaImportDerivedRisk);
  for (const hostLog of [vi.fn(), undefined]) {
    const f = fixture();
    f.fetchImage.mockRejectedValueOnce(new EgressRefusedError({ message: "resolves 10.0.4.7" }, { callerSafeMessage: "That address is not allowed." }));
    const deps = { ...f.routeDeps, ...(hostLog ? { mediaImportEgressRefusalLog: hostLog } : {}) };
    const tool = f.binding.contributeMediaImportTools({ resolvePublicUrls: f.resolvePublicUrls }).build(deps, undefined)
      .find(row => row.descriptor.id === "media_import_from_url")!;
    const result = tool.handler({ ...f.ctx, input: { url: "https://request.example/image" } });
    // The tool surfaces only the caller-safe text as a tool input error; the resolved address never reaches the model.
    const error = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ToolInputError);
    expect((error as Error).message).toMatch(/^That address is not allowed\.\. Fix the input and retry/);
    expect((error as Error).message).not.toContain("10.0.4.7");
    const line = "[media-import] media_import_from_url egress refused: resolves 10.0.4.7";
    if (hostLog) {
      expect(hostLog.mock.calls).toEqual([[line]]);
      expect(f.log).not.toHaveBeenCalled();
    } else expect(f.log.mock.calls).toEqual([[line]]);
    expect(f.upload).not.toHaveBeenCalled();
  }
});

test("persisting already-fetched bytes uploads them, records the sniffed type and returns the public receipt", async () => {
  const f = fixture();
  const input = { workspaceId: "site", bytes, filename: "found.png", contentType: "image/png", createdByPrincipal: "human" };
  expect(await f.binding.persistImportedMedia({ routeDeps: f.routeDeps, resolvePublicUrls: f.resolvePublicUrls, input, sourceUrl: "https://cdn.example/found.png", actorId: "human" })).toEqual({
    media: { id: "asset", slug: "asset", title: "Asset", alt: "", caption: "", createdBy: null, credit: "", sha256: "hash", status: "active", version: 3,
      publicUrl: "/m/asset/", sourceUrl: "https://cdn.example/found.png" },
  });
  expect(f.upload.mock.calls).toEqual([[input]]);
  expect(f.routeDeps.mediaContentTypeStore.set).toHaveBeenCalledWith({ workspaceId: "site", sha256: "hash", contentType: "image/png" });
  expect(f.resolvePublicUrls).toHaveBeenCalledWith({ deps: f.routeDeps, assets: [f.media] });
});
