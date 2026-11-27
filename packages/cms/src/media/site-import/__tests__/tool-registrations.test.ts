import { describe, expect, it, vi } from "vitest";
import type { MediaRecord } from "@jini-ai/core/contracts/site/cms-media";
import type { ToolExecutionContext } from "@jini-ai/core";
import { createHash } from "node:crypto";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStagedFileAdapter } from "@jini-ai/platform/fs";
import { buildMediaImportAgentToolCatalog } from "../agent-tools.js";
import { buildMediaImportRegistrations, contributeMediaImportTools, type MediaImportToolDeps } from "../tool-registrations.js";

const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const media: MediaRecord = {
  id: "asset", workspaceId: "workspace", slug: "picture", title: "Picture", alt: "", caption: "", credit: "",
  source: { sha256: "hash" }, status: "active", version: 1, createdAt: "2026-11-25T00:00:00Z",
  updatedAt: "2026-11-25T00:00:00Z", width: null, height: null, cssClass: null, htmlAttributes: null,
};
const catalog = buildMediaImportAgentToolCatalog({ fsRootIds: ["site"], fsFolderReadRecovery: "Pick a folder.", mediaAssetReadToolId: "read_asset" });
function fixture() {
  const deps = {
    workspaceId: "workspace", authorize: vi.fn(async () => ({ allowed: true, reason: "granted" })),
    refuseUnexpectedKeys: vi.fn(),
    storage: {
      canUploadStagedVideo: vi.fn(async () => false),
      uploadStagedVideo: vi.fn<MediaImportToolDeps["storage"]["uploadStagedVideo"]>(async () => ({ media })),
      upload: vi.fn(async () => ({ media })), recordContentType: vi.fn(async () => {}),
      resolvePublicUrls: vi.fn(async () => new Map([[media.id, "https://public.example/picture"]])),
    },
    source: {
      ordinaryMaxBytes: 50_000_000,
      withLocalStream: vi.fn<MediaImportToolDeps["source"]["withLocalStream"]>() as ReturnType<typeof vi.fn<MediaImportToolDeps["source"]["withLocalStream"]>> & MediaImportToolDeps["source"]["withLocalStream"],
      withStagedFile: vi.fn<MediaImportToolDeps["source"]["withStagedFile"]>() as ReturnType<typeof vi.fn<MediaImportToolDeps["source"]["withStagedFile"]>> & MediaImportToolDeps["source"]["withStagedFile"],
      fetchRemote: vi.fn(async () => ({ bytes, contentType: "image/jpeg", url: new URL("https://cdn.example/final.png") })),
      resolveLocal: vi.fn(() => ({ rootPath: "/site", relativePath: "image.png" })),
      readLocal: vi.fn(async () => bytes), localReadLimit: vi.fn(() => 50_000_000), validateBytes: vi.fn(() => "image/png"),
    },
    refusals: {
      isEgressRefusal: vi.fn(() => false), describeEgressRefusal: vi.fn(() => undefined),
      logEgressRefusal: vi.fn(), isPathRefusal: vi.fn(() => false),
    },
    replacement: {
      findById: vi.fn(async () => media), isAvailable: vi.fn(() => true), replace: vi.fn(async () => media),
    },
  } satisfies MediaImportToolDeps;
  const controller = new AbortController();
  const ctx = (input: unknown): ToolExecutionContext => ({ input, executionId: "execution", principal: { id: "agent" }, run: { id: "run" }, signal: controller.signal });
  const registrations = buildMediaImportRegistrations({ deps, catalog });
  const handler = (id: string) => registrations.find(({ descriptor }) => descriptor.id === id)!.handler;
  return { deps, controller, ctx, handler };
}

describe("media import execution", () => {
  it("permission denial touches neither source nor storage", async () => {
    const { deps, ctx, handler } = fixture();
    deps.authorize.mockResolvedValue({ allowed: false, reason: "denied" });
    await expect(handler("media_import_from_url")(ctx({ url: "https://request.example/image" }))).rejects.toThrow(/not authorized/);
    await expect(handler("media_import_local_file")(ctx({ root: "site", path: "image.png" }))).rejects.toThrow(/not authorized/);
    expect(deps.source.fetchRemote).not.toHaveBeenCalled();
    expect(deps.source.resolveLocal).not.toHaveBeenCalled();
    expect(deps.source.readLocal).not.toHaveBeenCalled();
    expect(deps.storage.upload).not.toHaveBeenCalled();
    expect(deps.storage.recordContentType).not.toHaveBeenCalled();
    expect(deps.storage.resolvePublicUrls).not.toHaveBeenCalled();
  });

  it("redirect-final source and sniffed type are recorded", async () => {
    const { deps, ctx, handler } = fixture();
    const result = await handler("media_import_from_url")(ctx({ url: "https://request.example/image" }));
    expect(deps.storage.upload).toHaveBeenCalledWith({ input: expect.objectContaining({ provenance: { kind: "url", url: "https://cdn.example/final.png" }, createdByPrincipal: "agent" }) }, {});
    expect(deps.storage.recordContentType).toHaveBeenCalledWith({ workspaceId: "workspace", sha256: "hash", contentType: "image/png" }, {});
    expect(result).toMatchObject({ media: { sourceUrl: "https://cdn.example/final.png", publicUrl: "https://public.example/picture", createdBy: null } });
    expect(deps.storage.upload.mock.invocationCallOrder[0]).toBeLessThan(deps.storage.recordContentType.mock.invocationCallOrder[0]!);
    expect(deps.storage.recordContentType.mock.invocationCallOrder[0]).toBeLessThan(deps.storage.resolvePublicUrls.mock.invocationCallOrder[0]!);
  });

  it("replace capability refusal precedes source access", async () => {
    const { deps, ctx, handler } = fixture();
    deps.replacement.isAvailable.mockReturnValue(false);
    await expect(handler("media_replace_file")(ctx({ mediaId: "asset", url: "https://request.example/image" }))).rejects.toThrow(/unavailable on this storage adapter/);
    expect(deps.source.fetchRemote).not.toHaveBeenCalled();
    expect(deps.source.readLocal).not.toHaveBeenCalled();
    expect(deps.replacement.replace).not.toHaveBeenCalled();
  });

  it("abort after acquiring bytes leaves storage untouched", async () => {
    for (const toolId of ["media_import_from_url", "media_import_local_file", "media_replace_file"]) {
      const { deps, controller, ctx, handler } = fixture();
      deps.source.fetchRemote.mockImplementation(async () => {
        controller.abort();
        return { bytes, contentType: "image/jpeg", url: new URL("https://cdn.example/final.png") };
      });
      deps.source.readLocal.mockImplementation(async () => { controller.abort(); return bytes; });
      const input = toolId === "media_import_local_file" ? { root: "site", path: "image.png" } : { mediaId: "asset", url: "https://request.example/image" };
      await expect(handler(toolId)(ctx(input))).rejects.toThrow();
      expect(deps.storage.upload).not.toHaveBeenCalled();
      expect(deps.replacement.replace).not.toHaveBeenCalled();
      expect(deps.storage.recordContentType).not.toHaveBeenCalled();
      expect(deps.storage.resolvePublicUrls).not.toHaveBeenCalled();
    }
  });

  it("storage content-type refusal cannot become success", async () => {
    const { deps, ctx, handler } = fixture();
    const failure = new Error("content-type store refused");
    deps.storage.recordContentType.mockRejectedValue(failure);
    await expect(handler("media_import_from_url")(ctx({ url: "https://request.example/image" }))).rejects.toBe(failure);
    expect(deps.storage.upload).toHaveBeenCalledOnce();
    expect(deps.storage.resolvePublicUrls).not.toHaveBeenCalled();
  });
});

it("A large local video writes before pulling the next chunk.", async () => {
  const root = await filesystem.mkdtemp(join(tmpdir(), "media-stream-test-"));
  try {
    const { deps, ctx, handler } = fixture();
    const first = Buffer.alloc(64 * 1024 + 3); first.write("ftypqt  ", 4);
    first.set([0x11, 0x22, 0x33], 64 * 1024);
    const second = Buffer.from("video remainder");
    const expected = Buffer.concat([first, second]);
    let acknowledged = false;
    const staging = createStagedFileAdapter({
      filesystem: { ...filesystem, open: async (...args: Parameters<typeof filesystem.open>) => {
        const file = await filesystem.open(...args);
        if (args[1] === "wx") {
          const write = file.writeFile.bind(file);
          vi.spyOn(file, "writeFile").mockImplementation(async data => { await write(data); acknowledged = true; });
        }
        return file;
      } },
      withTempRoot: async ({ work }) => { try { return await work({ root }); } finally { await filesystem.rm(root, { recursive: true, force: true }); } },
      sniffContentType: () => "video/quicktime",
    });
    deps.storage.canUploadStagedVideo.mockResolvedValue(true);
    deps.source.ordinaryMaxBytes = 16;
    deps.source.resolveLocal.mockReturnValue({ rootPath: "/site", relativePath: "clips/clip.mov" });
    deps.source.validateBytes.mockReturnValue("video/quicktime");
    deps.source.readLocal.mockImplementation(async () => { throw new Error("whole-file read"); });
    deps.storage.upload.mockImplementation(async () => { throw new Error("byte upload"); });
    deps.source.withStagedFile.mockImplementation(staging.withStagedFile);
    deps.source.withLocalStream.mockImplementation(async ({ consume }) => consume({ length: expected.length, chunks: (async function* () {
      yield first;
      expect(acknowledged).toBe(true);
      yield second;
    })() }));
    deps.storage.uploadStagedVideo.mockImplementation(async ({ input }) => {
      const chunks = [];
      for await (const chunk of input.staged.openChunks({})) chunks.push(chunk);
      expect(Buffer.concat(chunks)).toEqual(expected);
      expect(input.staged.sha256).toBe(createHash("sha256").update(expected).digest("hex"));
      expect(input.staged.byteLength).toBe(expected.length);
      expect(input.provenance).toEqual({ kind: "upload", path: "clips/clip.mov" });
      expect(input.createdByPrincipal).toBe("agent");
      return { media };
    });
    expect(await handler("media_import_local_file")(ctx({ root: "site", path: "clips/clip.mov" })))
      .toMatchObject({ media: { id: "asset", sourceUrl: "", publicUrl: "https://public.example/picture" } });
    expect(deps.source.readLocal).not.toHaveBeenCalled();
    expect(deps.storage.upload).not.toHaveBeenCalled();
    deps.source.validateBytes.mockReturnValue("image/png");
    deps.source.withStagedFile.mockClear();
    deps.storage.uploadStagedVideo.mockClear();
    await expect(handler("media_import_local_file")(ctx({ root: "site", path: "large.png" }))).rejects.toThrow("exceeds the 16-byte import limit");
    expect(deps.source.withStagedFile).not.toHaveBeenCalled();
    expect(deps.source.readLocal).not.toHaveBeenCalled();
    expect(deps.storage.upload).not.toHaveBeenCalled();
    expect(deps.storage.uploadStagedVideo).not.toHaveBeenCalled();
  } finally { await filesystem.rm(root, { recursive: true, force: true }); }
});

it("refuses mutually exclusive replacement sources before reading either", async () => {
  const { deps, ctx, handler } = fixture();
  await expect(handler("media_replace_file")(ctx({ mediaId: "asset", url: "https://request.example/image", root: "site", path: "image.png" }))).rejects.toThrow();
  expect(deps.source.fetchRemote).not.toHaveBeenCalled();
  expect(deps.source.readLocal).not.toHaveBeenCalled();
  expect(deps.replacement.replace).not.toHaveBeenCalled();
});


it("keeps omitted editorial properties in the storage input", async () => {
  const { deps, ctx, handler } = fixture();
  await handler("media_import_local_file")(ctx({ root: "site", path: "image.png" }));
  expect(deps.storage.upload).toHaveBeenCalledWith({ input: {
    workspaceId: "workspace", bytes, filename: "image.png", contentType: "image/png", provenance: { kind: "upload", path: "image.png" },
    alt: undefined, caption: undefined, description: undefined, createdByPrincipal: "agent",
  } }, {});
});

it("the contributed local import collects an ordinary bounded stream in order instead of staging it", async () => {
  const { deps, ctx } = fixture();
  deps.storage.canUploadStagedVideo.mockResolvedValue(true);
  const opened: unknown[] = [];
  const withLocalStream: MediaImportToolDeps["source"]["withLocalStream"] = async ({ consume, ...request }, options) => {
    opened.push([request, options]);
    return consume({ length: bytes.byteLength, chunks: (async function* () { yield bytes.slice(0, 3); yield bytes.slice(3); })() });
  };
  const routed = { ...deps, source: { ...deps.source, withLocalStream } };
  const bindDeps = vi.fn(({ deps }: { deps: { configured: boolean } }, _optional?: Record<string, never>) => {
    if (!deps.configured) throw new Error("wrong host fixture");
    return routed;
  });
  const [registration] = contributeMediaImportTools({ catalog, bindDeps }).build({ configured: true }, {})
    .filter(tool => tool.descriptor.id === "media_import_local_file");
  const input = ctx({ root: "site", path: "image.png" });
  expect(await registration!.handler(input)).toMatchObject({ media: { id: "asset", sha256: "hash", sourceUrl: "", publicUrl: "https://public.example/picture" } });
  expect(bindDeps.mock.calls).toEqual([[{ deps: { configured: true } }, {}]]);
  expect(opened).toEqual([[{ rootPath: "/site", relativePath: "image.png", maxBytes: 50_000_000 }, { signal: input.signal }]]);
  expect(deps.storage.upload).toHaveBeenCalledWith({ input: {
    workspaceId: "workspace", bytes: Buffer.from(bytes), filename: "image.png", contentType: "image/png", createdByPrincipal: "agent",
    alt: undefined, caption: undefined, description: undefined,
    provenance: { kind: "upload", path: "image.png" },
  } }, {});
  expect(deps.storage.uploadStagedVideo).not.toHaveBeenCalled();
});

it("a successful replace resolves the persisted record's URL and reports its new version", async () => {
  const { deps, ctx, handler } = fixture();
  const saved = { ...media, version: 2, source: { sha256: "new-hash" } };
  deps.replacement.replace.mockResolvedValue(saved);
  const input = ctx({ mediaId: "asset", url: "https://submitted.example/picture" });
  expect(await handler("media_replace_file")(input)).toEqual({ media: {
    id: "asset", title: "Picture", slug: "picture", sha256: "new-hash", version: 2, publicUrl: "https://public.example/picture",
  } });
  expect(deps.storage.resolvePublicUrls).toHaveBeenCalledWith({ assets: [saved] }, {});
});
