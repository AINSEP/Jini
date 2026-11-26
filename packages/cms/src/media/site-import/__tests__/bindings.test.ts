import { expect, test, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { bindMediaImportTools } from "../bindings.js";
import { MediaImportValidationError } from "../../import/index.js";
import type { VideoImportOptions } from "../../site/import-video-conversion.js";
import type { MediaRecord } from "@jini-ai/core/contracts/site/cms-media";

const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

class EgressRefusedError extends Error {
  readonly callerSafeMessage: string;
  constructor({ message }: { message: string }, { callerSafeMessage }: { callerSafeMessage: string }) {
    super(message);
    this.callerSafeMessage = callerSafeMessage;
  }
}

function fixture() {
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
  const binding = bindMediaImportTools<Omit<VideoImportOptions, "linkDerivedMedia">>({ fsRootIds: ["site"], recoveryText: "Pick a folder.", mediaAssetReadToolId: "read_asset",
    resolveSiteFileRequest: ({ relativePath }) => ({ rootPath: "/site", relativePath }), openFsFileForRead: read,
    withLocalStream: async () => { throw new Error("unexpected staged read"); },
    withStagedFile: async () => { throw new Error("unexpected staging"); },
    createConvertingStagedUploader: () => upload,
    uploadLimitForFile: () => 100, uploadCaps: { maxUploadBytes: 100 },
    fetchImage: vi.fn(async () => ({ bytes, contentType: "image/png", url: new URL("https://cdn.example/final.png") })),
    validateImageBytes: () => "image/png", createConvertingUploader, replaceMediaFile,
    EgressRefusedError,
    isPathRefusal: ({ error }) => error instanceof URIError, logEgressRefusal: log,
  });
  const routeDeps = { workspaceId: "site", authorize: async () => ({ allowed: true, reason: "grant" }),
    mediaRepo: { findById: async () => media, replaceFileIfVersion: vi.fn(), saveRenditionIfSource: vi.fn() },
    mediaContentTypeStore: { set: vi.fn() }, blobStore: {}, mediaImportLocalMaxBytes: 200 } as unknown as Parameters<typeof binding.buildMediaImportRegistrations>[0]["deps"];
  const resolvePublicUrls = vi.fn(async () => new Map([["asset", "/m/asset/"]]));
  const ctx: ToolExecutionContext = { executionId: "e", run: { id: "run" }, principal: { id: "human" }, signal: new AbortController().signal, input: {} };
  return { binding, routeDeps, resolvePublicUrls, ctx, read, upload, createConvertingUploader, replaceMediaFile, log };
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
