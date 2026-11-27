import { describe, expect, it, vi } from "vitest";
import { createApprovalHandler, ToolInputError, type ToolExecutionContext, type SurfaceExchangeStore } from "@jini-ai/core";
import type { AssetTheme, PreparedAssetBatch } from "@jini-ai/core/contracts/site/asset-transfer-tool-ports";
import { buildFilesCopyAgentToolCatalog, buildFilesCopyRegistrations, contributeFilesCopyTools, type AssetApprovalToolHandler, type FilesCopyToolDeps } from "../copy-tool.js";

function fixture() {
  const sourceSchema = { type: "object", additionalProperties: false, required: ["root", "path"], properties: {
    root: { type: "string", enum: ["site", "picked", "theme", "media"] },
    path: { type: "string", minLength: 1, description: "Path" }, themeId: { type: "string", minLength: 1, description: "Theme" },
  } } as const;
  const deps = {
    mediaVideoMaxBytes: 50 * 1024 * 1024,
    refuseUnexpectedKeys: vi.fn(),
    destination: {
      workspaceId: "workspace", authorize: vi.fn(async () => ({ allowed: true, reason: "granted" })), refuseUnexpectedKeys: vi.fn(),
      permissions: { site: "files.manage", picked: "files.manage", theme: "theme.edit", media: "media.upload", library: "media.upload" },
      fs: {
        siteFolder: vi.fn(() => "/site"), inspect: vi.fn(() => ({ overwrite: false })),
        prepareSite: vi.fn(({ folder, files }: { folder: string; files: { path: string; content: string; encoding: "base64" }[] }): PreparedAssetBatch<Buffer> => ({ folder, writes: files.map(({ path, content }) => ({ path, bytes: Buffer.from(content, "base64"), overwrite: false })) })),
        preparePicked: vi.fn<FilesCopyToolDeps<AssetTheme>["destination"]["fs"]["preparePicked"]>(),
        writePrepared: vi.fn(({ writes }: { folder: string; writes: PreparedAssetBatch<Buffer>["writes"] }) => ({ written: writes.map(({ path }) => path), notWritten: [] })),
        chooseNextName: vi.fn(({ desiredPath }: { desiredPath: string; existingPaths: Set<string> }) => desiredPath),
      },
      theme: { findTheme: vi.fn(() => ({ dir: "/theme", status: "ready" })), checkThemeWrite: vi.fn(), writeThemeFile: vi.fn(), reloadTheme: vi.fn(() => ({ dir: "/theme", status: "ready" })) },
      media: { validateBytes: vi.fn(() => "image/png"), persist: vi.fn<FilesCopyToolDeps<AssetTheme>["destination"]["media"]["persist"]>() },
      library: { saveDocument: vi.fn(async () => ({ document: {} })) },
    },
    source: {
      readAsset: vi.fn(async () => ({ path: "source.txt", bytes: Buffer.from("approved bytes") })),
      resolveFolder: vi.fn(async () => ({ rootPath: "/site", relativePath: "." })),
      list: vi.fn(() => ({ files: ["first.txt", "second.txt"], truncated: false })),
      readFile: vi.fn(async () => Buffer.from("document")), fetchUrl: vi.fn<FilesCopyToolDeps<AssetTheme>["source"]["fetchUrl"]>(),
    },
    documentArchiveReader: { entries: vi.fn<FilesCopyToolDeps<AssetTheme>["documentArchiveReader"]["entries"]>() },
    documents: { maxBytes: 50 * 1024 * 1024, validate: vi.fn(async () => ({})) },
    isFsShapeRejection: (_input: { error: unknown }): boolean => false, isDocumentShapeRejection: () => false, isThemeShapeRejection: () => false, isImportShapeRejection: () => false,
  } satisfies FilesCopyToolDeps<AssetTheme>;
  const described = vi.fn(({ batch }: { batch: PreparedAssetBatch<Buffer>; toolId: string }) => ({ toolId: "files_copy", errorCode: "FILES", title: "Copy", confirmLabel: "Confirm", details: [{ label: "Bytes", value: batch.writes.map(({ bytes }) => bytes.toString()).join(",") }] }));
  const askHuman = vi.fn(async () => ({ confirmed: true as const }));
  const approvalToolHandler: AssetApprovalToolHandler = (steps, options = {}) => createApprovalHandler({
    prepare: steps.prepare, describe: async ({ ctx, prepared }) => ({ ask: options.ask?.({ prepared }) ?? true, description: await steps.describe({ ctx, prepared }) }),
    askHuman, run: ({ ctx, prepared, confirmer, choice }, options) => steps.run({ ctx, prepared, confirmer, ...(choice === undefined ? {} : { choice }) }, options), notConfirmed: () => ({ applied: false }),
  });
  const surfaces = { surfaceExchanges: { open: vi.fn<SurfaceExchangeStore["open"]>(), deliver: vi.fn<SurfaceExchangeStore["deliver"]>(), findTypedAnswerTarget: vi.fn<SurfaceExchangeStore["findTypedAnswerTarget"]>(), size: () => 0 } };
  const catalog = buildFilesCopyAgentToolCatalog({ sourceSchema, fsReadPermission: "files.read" });
  const handler = buildFilesCopyRegistrations({ deps, surfaces, catalog, approval: { approvalToolHandler, describeWriteBatch: described } })[0]!.handler;
  const ctx = (input: unknown): ToolExecutionContext => ({ input, executionId: "execution", principal: { id: "agent" }, run: { id: "run" }, signal: new AbortController().signal });
  return { deps, described, askHuman, handler, ctx, surfaces, catalog, approvalToolHandler };
}

describe("files copy execution", () => {
  it("one large video reaches Media without an approval payload", async () => {
    const { deps, described, askHuman, handler, ctx } = fixture();
    const bytes = Buffer.alloc(10_000_001);
    Buffer.from("000000186674797069736f6d0000000069736f6d6d703432", "hex").copy(bytes);
    const encode = vi.spyOn(bytes, "toString");
    deps.source.readAsset.mockResolvedValue({ path: "clip.mp4", bytes });
    deps.destination.media.validateBytes.mockReturnValue("video/mp4");
    const media = { id: "video", createdBy: "agent", slug: "clip", title: "clip", alt: "", caption: "", credit: "", sha256: "hash", status: "active", version: 1, publicUrl: "/clip.mp4", sourceUrl: "" };
    deps.destination.media.persist.mockResolvedValue({ media });
    const input = { sources: [{ root: "site", path: "clip.mp4" }], destination: { kind: "media" } };
    expect(await handler(ctx(input))).toEqual({ applied: true, written: ["clip.mp4"], skipped: [], media: [media] });
    expect(deps.source.readAsset).toHaveBeenCalledExactlyOnceWith({ ctx: expect.objectContaining({ principal: { id: "agent" } }), input: input.sources[0], maxBytes: deps.mediaVideoMaxBytes }, {});
    // Identity, not deep equality: the read buffer itself is persisted (and a 10 MB element-wise compare is too slow).
    expect(deps.destination.media.persist).toHaveBeenCalledOnce();
    const [persisted, persistOptions] = deps.destination.media.persist.mock.calls[0]!;
    expect(persisted.input.bytes).toBe(bytes);
    expect({ ...persisted, input: { ...persisted.input, bytes: "<read buffer>" } })
      .toEqual({ actorId: "agent", sourceUrl: "", input: { workspaceId: "workspace", bytes: "<read buffer>", filename: "clip.mp4", contentType: "video/mp4", createdByPrincipal: "agent" } });
    expect(persistOptions).toEqual({});
    expect(encode).not.toHaveBeenCalledWith("base64");
    expect(askHuman).not.toHaveBeenCalled();
    // The approval description is built from an empty batch: no video bytes enter an approval payload.
    expect(described.mock.calls).toEqual([[{ batch: { folder: "", writes: [] }, toolId: "files_copy" }, {}]]);
    expect(deps.destination.fs.prepareSite).not.toHaveBeenCalled();
    expect(deps.destination.fs.preparePicked).not.toHaveBeenCalled();
    encode.mockRestore();
  });

  it("the same-size non-video is refused before Media persistence", async () => {
    const { deps, handler, ctx } = fixture();
    deps.source.readAsset.mockResolvedValue({ path: "image.png", bytes: Buffer.alloc(10_000_001) });
    await expect(handler(ctx({ sources: [{ root: "site", path: "image.png" }], destination: { kind: "media" } }))).rejects.toThrow(/byte cap/);
    expect(deps.destination.media.persist).not.toHaveBeenCalled();
  });

  it("a denied destination never calls the source port", async () => {
    const { deps, handler, ctx } = fixture();
    deps.destination.authorize.mockResolvedValue({ allowed: false, reason: "denied" });
    await expect(handler(ctx({ sources: [{ root: "site", path: "source.txt" }], destination: { kind: "site" } }))).rejects.toThrow(/not authorized/);
    for (const port of Object.values(deps.source)) expect(port).not.toHaveBeenCalled();
    expect(deps.destination.fs.prepareSite).not.toHaveBeenCalled();
    expect(deps.destination.fs.writePrepared).not.toHaveBeenCalled();
  });

  it("a truncated glob cannot prepare a batch", async () => {
    const { deps, handler, ctx } = fixture();
    deps.source.list.mockReturnValue({ files: ["first.txt"], truncated: true });
    await expect(handler(ctx({ sources: [{ root: "site", path: ".", glob: "*.txt" }], destination: { kind: "site" } }))).rejects.toThrow(/file-count\/traversal cap/);
    expect(deps.source.readFile).not.toHaveBeenCalled();
    expect(deps.destination.fs.prepareSite).not.toHaveBeenCalled();
    expect(deps.destination.fs.writePrepared).not.toHaveBeenCalled();
  });

  it("a refused later document prevents the first save", async () => {
    const { deps, handler, ctx } = fixture();
    const refusal = new Error("second document refused");
    deps.documents.validate.mockResolvedValueOnce({}).mockRejectedValueOnce(refusal);
    await expect(handler(ctx({ sources: [{ root: "site", path: ".", glob: "*.txt" }], destination: { kind: "library" } }))).rejects.toBe(refusal);
    expect(deps.documents.validate).toHaveBeenCalledTimes(2);
    expect(deps.documents.validate).toHaveBeenNthCalledWith(1, { filename: "first.txt", bytes: Buffer.from("document") }, { archiveReader: deps.documentArchiveReader });
    expect(deps.destination.library.saveDocument).not.toHaveBeenCalled();
  });

  it("a site writer receives only the approved batch", async () => {
    const { deps, described, askHuman, handler, ctx } = fixture();
    askHuman.mockImplementation(async () => {
      expect(deps.destination.fs.writePrepared).not.toHaveBeenCalled();
      expect(described).toHaveBeenCalledWith({ batch: { folder: "/site", writes: [{ path: "target/source.txt", bytes: Buffer.from("approved bytes"), overwrite: false }] }, toolId: "files_copy" }, {});
      deps.source.readAsset.mockResolvedValue({ path: "source.txt", bytes: Buffer.from("changed after card") });
      return { confirmed: true };
    });
    expect(await handler(ctx({ sources: [{ root: "site", path: "source.txt" }], destination: { kind: "site", path: "target" } }))).toEqual({ applied: true, written: ["target/source.txt"], skipped: [], notWritten: [] });
    expect(askHuman).toHaveBeenCalledOnce();
    expect(deps.source.readAsset).toHaveBeenCalledOnce();
    expect(deps.destination.fs.prepareSite).toHaveBeenCalledOnce();
    expect(deps.destination.fs.writePrepared).toHaveBeenCalledWith(described.mock.calls[0]![0].batch, {});
  });
  it("same-batch collisions retain the exact response and one-file approval", async () => {
    const { deps, described, askHuman, handler, ctx } = fixture();
    const input = { sources: [{ root: "site", path: "one/source.txt" }, { root: "site", path: "two/source.txt" }], destination: { kind: "site" } };
    expect(await handler(ctx(input))).toEqual({ applied: true, written: ["source.txt"], skipped: ["source.txt"], notWritten: [] });
    expect(described).toHaveBeenCalledExactlyOnceWith({ batch: { folder: "/site", writes: [{ path: "source.txt", bytes: Buffer.from("approved bytes"), overwrite: false }] }, toolId: "files_copy" }, {});
    expect(askHuman).toHaveBeenCalledOnce();
    expect(deps.destination.fs.writePrepared).toHaveBeenCalledOnce();
  });

});

it("imports redirected URL bytes under the final URL's filename and passes that URL as media provenance", async () => {
  const { deps, handler, ctx, askHuman } = fixture();
  const url = "https://origin.example/image";
  const finalUrl = new URL("https://cdn.example/media/photo.png");
  const bytes = Buffer.from("fixture-png");
  const media = { id: "photo", createdBy: "agent", slug: "photo", title: "photo", alt: "", caption: "", credit: "", sha256: "hash", status: "active", version: 1, publicUrl: "/photo.png", sourceUrl: finalUrl.href };
  deps.source.fetchUrl.mockResolvedValue({ bytes, url: finalUrl });
  deps.destination.media.persist.mockResolvedValue({ media });
  expect(await handler(ctx({ sources: [{ root: "url", url }], destination: { kind: "media" } })))
    .toEqual({ applied: true, written: ["photo.png"], skipped: [], media: [media] });
  expect(deps.source.fetchUrl.mock.calls).toEqual([[{ url, media: true, maxBytes: deps.mediaVideoMaxBytes }, {}]]);
  expect(deps.destination.media.persist.mock.calls).toEqual([[{ actorId: "agent", sourceUrl: finalUrl.href,
    input: { workspaceId: "workspace", bytes, filename: "photo.png", contentType: "image/png", createdByPrincipal: "agent" },
  }, {}]]);
  expect(askHuman.mock.calls).toEqual([]);
});

it.each<[unknown, unknown, string]>([
  [{ root: "url", url: "https://api.example/image.png", glob: "*" }, { kind: "site" }, "URL sources do not accept glob"],
  [{ root: "url", url: "https://api.example/image.png" }, { kind: "library" }, "Library copies need an allowed picked/site/theme file source, not an image URL"],
  [{ root: "site", path: "asset.png", url: "https://api.example/image.png" }, { kind: "site" }, "url is only valid for root url"],
  [{ root: "media", path: "asset.png", glob: "*" }, { kind: "site" }, "glob must be 1..256 characters and target a filesystem folder"],
  [{ root: "site", path: "asset.png" }, { kind: "media", path: "folder" }, "Media and Library destinations do not have folders; omit destination.path"],
  [{ root: "site", path: "asset.png" }, { kind: "picked" }, "Use fs_write_files to write to the picked folder"],
])("refuses incompatible copy source %j and destination %j before reading bytes", async (source, destination, message) => {
  const { deps, handler, ctx, askHuman } = fixture();
  await expect(handler(ctx({ sources: [source], destination }))).rejects.toThrow(message);
  expect(deps.source.readAsset.mock.calls).toEqual([]);
  expect(deps.source.resolveFolder.mock.calls).toEqual([]);
  expect(deps.source.fetchUrl.mock.calls).toEqual([]);
  expect(askHuman.mock.calls).toEqual([]);
});

it("adds caller-facing input guidance only for a classified source refusal", async () => {
  const { deps, handler, ctx } = fixture();
  const refused = new Error("source path is outside the chosen folder");
  const privateFailure = new Error("private storage problem");
  deps.isFsShapeRejection = ({ error }: { error: unknown }) => error === refused;
  deps.source.readAsset.mockRejectedValueOnce(refused).mockRejectedValueOnce(privateFailure);
  const input = { sources: [{ root: "site", path: "source.txt" }], destination: { kind: "site" } };
  const guided: unknown = await handler(ctx(input)).then(() => undefined, (failure: unknown) => failure);
  expect(guided).toBeInstanceOf(ToolInputError);
  if (!(guided instanceof Error)) throw new Error("expected a caller input error");
  expect(guided.message.startsWith(refused.message)).toBe(true);
  expect(guided.message.length).toBeGreaterThan(refused.message.length);
  await expect(handler(ctx(input))).rejects.toBe(privateFailure);
  expect(deps.destination.fs.writePrepared.mock.calls).toEqual([]);
});

it("reports a complete skip without creating an approval card or invoking the writer", async () => {
  const { deps, handler, ctx, askHuman } = fixture();
  deps.destination.fs.inspect.mockReturnValue({ overwrite: true });
  expect(await handler(ctx({ sources: [{ root: "site", path: "source.txt" }], destination: { kind: "site" } })))
    .toEqual({ applied: false, written: [], skipped: ["source.txt"] });
  expect(askHuman.mock.calls).toEqual([]);
  expect(deps.destination.fs.prepareSite.mock.calls).toEqual([]);
  expect(deps.destination.fs.writePrepared.mock.calls).toEqual([]);
});

it("binds the current host deps when the copy contributor builds and runs", async () => {
  const f = fixture();
  const binding: unknown[] = [];
  const contributor = contributeFilesCopyTools({
    catalog: f.catalog, approval: { approvalToolHandler: f.approvalToolHandler, describeWriteBatch: f.described },
    bindDeps: ({ deps }: { deps: { session: string } }, optional) => { binding.push([deps, optional]); return f.deps; },
  });
  expect(binding).toEqual([]);
  const [copy] = contributor.build({ session: "site-session" }, f.surfaces);
  expect(copy?.descriptor.id).toBe("files_copy");
  expect(binding).toEqual([[{ session: "site-session" }, {}]]);
  expect(await copy!.handler(f.ctx({ sources: [{ root: "site", path: "source.txt" }], destination: { kind: "site" } })))
    .toEqual({ applied: true, written: ["source.txt"], skipped: [], notWritten: [] });
  expect(f.deps.destination.fs.writePrepared.mock.calls).toEqual([[{ folder: "/site", writes: [
    { path: "source.txt", bytes: Buffer.from("approved bytes"), overwrite: false },
  ] }, {}]]);
});
