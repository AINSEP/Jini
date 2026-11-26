import { expect, test, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { bindMediaImportTools } from "../bindings.js";
import { MediaImportValidationError } from "../../import/index.js";

const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fixture() {
  const media = { id: "asset", slug: "asset", source: { sha256: "hash" }, status: "active", version: 3 };
  const upload = vi.fn(async () => ({ media }));
  const createConvertingUploader = vi.fn(() => upload);
  const read = vi.fn(async () => bytes);
  const replaceMediaFile = vi.fn(async () => null);
  const log = vi.fn();
  const binding = bindMediaImportTools({ fsRootIds: ["site"], recoveryText: "Pick a folder.", mediaAssetReadToolId: "read_asset",
    resolveSiteFileRequest: ({ relativePath }) => ({ rootPath: "/site", relativePath }), openFsFileForRead: read,
    uploadLimitForFile: () => 100, uploadCaps: { maxUploadBytes: 100 },
    fetchImage: vi.fn(async () => ({ bytes, contentType: "image/png", url: new URL("https://cdn.example/final.png") })),
    validateImageBytes: () => "image/png", createConvertingUploader: createConvertingUploader as never, replaceMediaFile: replaceMediaFile as never,
    isEgressRefusal: ({ error }) => error instanceof RangeError,
    describeEgressRefusal: ({ error }) => error instanceof RangeError ? { logMessage: error.message, callerSafeError: new RangeError("public refusal") } : undefined,
    isPathRefusal: ({ error }) => error instanceof URIError, logEgressRefusal: log,
  });
  const routeDeps = { workspaceId: "site", authorize: async () => ({ allowed: true, reason: "grant" }),
    mediaRepo: { findById: async () => media, replaceFileIfVersion: vi.fn(), saveRenditionIfSource: vi.fn() },
    mediaContentTypeStore: { set: vi.fn() }, mediaImportLocalMaxBytes: 200 } as unknown as Parameters<typeof binding.buildMediaImportRegistrations>[0];
  const resolvePublicUrls = vi.fn(async () => new Map([["asset", "/m/asset/"]]));
  const ctx: ToolExecutionContext = { executionId: "e", run: { id: "run" }, principal: { id: "human" }, signal: new AbortController().signal, input: {} };
  return { binding, routeDeps, resolvePublicUrls, ctx, read, upload, createConvertingUploader, replaceMediaFile, log };
}

test("local reads are clamped to the file ceiling and allow a smaller host limit", async () => {
  const f = fixture();
  const [tool] = f.binding.buildMediaImportRegistrations(f.routeDeps, f).filter(row => row.descriptor.id === "media_import_local_file");
  await tool!.handler({ ...f.ctx, input: { root: "site", path: "asset.png" } });
  expect(f.read).toHaveBeenLastCalledWith({ rootPath: "/site", relativePath: "asset.png", maxBytes: 100 });
  f.routeDeps.mediaImportLocalMaxBytes = 20;
  await tool!.handler({ ...f.ctx, input: { root: "site", path: "asset.png" } });
  expect(f.read).toHaveBeenLastCalledWith({ rootPath: "/site", relativePath: "asset.png", maxBytes: 20 });
});

test("legacy shape classification includes typed import and egress errors but not transport failures", () => {
  const f = fixture();
  expect(f.binding.isImportShapeRejection({ error: new MediaImportValidationError({ message: "invalid" }) })).toBe(true);
  expect(f.binding.isImportShapeRejection({ error: new RangeError("private address") })).toBe(true);
  expect(f.binding.isImportShapeRejection({ error: new Error("transport timeout") })).toBe(false);
});

test("operator detail stays in the log while the caller receives the typed safe error", async () => {
  const f = fixture();
  await expect(f.binding.withCallerSafeEgressRefusal({ log: f.log, work: async () => { throw new RangeError("internal-db resolves 10.0.4.7"); } }, { toolId: "theme_import_file_from_url" })).rejects.toThrow("public refusal");
  expect(f.log).toHaveBeenCalledWith("[media-import] theme_import_file_from_url egress refused: internal-db resolves 10.0.4.7");
});

test("URL receipts retain the final source URL and the converter receives the injected video options", async () => {
  const f = fixture();
  const videoImport = { ports: { videoCodecProbe: vi.fn() } } as never;
  const tool = f.binding.buildMediaImportRegistrations(f.routeDeps, { ...f, videoImport }).find(row => row.descriptor.id === "media_import_from_url")!;
  expect(await tool.handler({ ...f.ctx, input: { url: "https://request.example/image" } })).toMatchObject({ media: { sourceUrl: "https://cdn.example/final.png", publicUrl: "/m/asset/", version: 3 } });
  expect(f.createConvertingUploader).toHaveBeenCalledWith(expect.objectContaining({ caps: { maxUploadBytes: 100 } }), { video: videoImport });
  expect(f.upload).toHaveBeenCalledWith(expect.objectContaining({ provenance: { kind: "url", url: "https://cdn.example/final.png" } }));
  expect(f.routeDeps.mediaContentTypeStore.set).toHaveBeenCalledWith({ workspaceId: "site", sha256: "hash", contentType: "image/png" });
});

test("replacement conflicts preserve the probe, signal and refusal without uploading", async () => {
  const f = fixture();
  const videoCodecProbe = vi.fn();
  const tool = f.binding.buildMediaImportRegistrations(f.routeDeps, { ...f, videoImport: { ports: { videoCodecProbe } } as never }).find(row => row.descriptor.id === "media_replace_file")!;
  await expect(tool.handler({ ...f.ctx, input: { mediaId: "asset", root: "site", path: "asset.png" } })).rejects.toThrow("changed while replacing");
  expect(f.replaceMediaFile).toHaveBeenCalledWith(expect.objectContaining({ principalId: "human" }), { maxUploadBytes: 100, videoCodecProbe, signal: f.ctx.signal });
  expect(f.upload).not.toHaveBeenCalled();
});
