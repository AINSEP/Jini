import { describe, expect, it, vi } from "vitest";
import { createApprovalHandler, type ToolExecutionContext, type SurfaceExchangeStore } from "@jini-ai/core";
import type { AssetTheme, PreparedAssetBatch } from "@jini-ai/core/contracts/site/asset-transfer-tool-ports";
import { buildFilesCopyAgentToolCatalog, buildFilesCopyRegistrations, type AssetApprovalToolHandler, type FilesCopyToolDeps } from "../copy-tool.js";

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
    isFsShapeRejection: () => false, isDocumentShapeRejection: () => false, isThemeShapeRejection: () => false, isImportShapeRejection: () => false,
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
  return { deps, described, askHuman, handler, ctx };
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
    expect(deps.destination.media.persist).toHaveBeenCalledExactlyOnceWith({ actorId: "agent", sourceUrl: "", input: { workspaceId: "workspace", bytes, filename: "clip.mp4", contentType: "video/mp4", createdByPrincipal: "agent" } }, {});
    expect(encode).not.toHaveBeenCalledWith("base64");
    expect(askHuman).not.toHaveBeenCalled();
    expect(described).not.toHaveBeenCalled();
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
