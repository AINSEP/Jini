import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writePreparedFiles } from "../../../fs-files/write-files.js";
import { describe, expect, it, vi } from "vitest";
import { createApprovalHandler, type ApprovalAnswer, type SurfaceExchangeStore, type ToolExecutionContext } from "@jini-ai/core";
import type { AssetTheme, PreparedAssetBatch } from "@jini-ai/core/contracts/site/asset-transfer-tool-ports";
import { prepareAssetWrites, requireAssetDestination, writeAssetFiles, type AssetDestinationDeps } from "../../../asset-transfer/asset-destinations.js";
import type { AssetApprovalToolHandler } from "../../../asset-transfer/copy-tool.js";
import { buildImageTransformAgentToolCatalog, buildImageTransformRegistrations, contributeImageTransformTools, IMAGE_TRANSFORM_TOOL_ID, type ImageTransformToolDeps } from "../tool.js";

function fixture() {
  const destination = {
    workspaceId: "workspace", authorize: vi.fn(async () => ({ allowed: true, reason: "granted" })), refuseUnexpectedKeys: vi.fn(),
    permissions: { site: "files.manage", picked: "files.manage", theme: "theme.edit", media: "media.upload", library: "media.upload" },
    fs: {
      siteFolder: vi.fn(() => "/site"), inspect: vi.fn(() => ({ overwrite: false })),
      prepareSite: vi.fn(({ folder, files }: { folder: string; files: { path: string; content: string; encoding: "base64" }[] }): PreparedAssetBatch<Buffer> => ({ folder, writes: files.map(({ path, content }) => ({ path, bytes: Buffer.from(content, "base64"), overwrite: false })) })),
      preparePicked: vi.fn(({ files }: { files: { path: string; content: string; encoding: "base64" }[] }): PreparedAssetBatch<Buffer> => ({ folder: "/picked", writes: files.map(({ path, content }) => ({ path, bytes: Buffer.from(content, "base64"), overwrite: true })) })),
      writePrepared: vi.fn(({ writes }: { folder: string; writes: PreparedAssetBatch<Buffer>["writes"] }) => ({ written: writes.map(({ path }) => path), notWritten: [] as string[] })),
      chooseNextName: vi.fn(({ desiredPath }: { desiredPath: string; existingPaths: Set<string> }) => desiredPath),
    },
    theme: { findTheme: vi.fn(() => ({ dir: "/theme", status: "ready" })), checkThemeWrite: vi.fn(), writeThemeFile: vi.fn(), reloadTheme: vi.fn(() => ({ dir: "/theme", status: "ready" })) },
    media: { validateBytes: vi.fn(() => "image/png"), persist: vi.fn<AssetDestinationDeps<AssetTheme>["media"]["persist"]>() },
    library: { saveDocument: vi.fn(async () => ({ document: {} })) },
  } satisfies AssetDestinationDeps<AssetTheme>;
  const deps = {
    destination, refuseUnexpectedKeys: vi.fn(),
    source: { readAsset: vi.fn(async () => ({ path: "source.png", bytes: Buffer.from("source image") })) },
    imageCodec: {
      inspect: vi.fn(async () => ({ format: "png", width: 32, height: 32, autoOrient: { width: 32, height: 32 }, hasAlpha: true })),
      encode: vi.fn(async () => ({ bytes: Buffer.from("exact rendered bytes"), width: 16, height: 16 })),
      encodeTiles: vi.fn<ImageTransformToolDeps<AssetTheme>["imageCodec"]["encodeTiles"]>(),
    },
    isFsShapeRejection: () => false, isThemeShapeRejection: () => false, isImportShapeRejection: () => false,
  } satisfies ImageTransformToolDeps<AssetTheme>;
  const destinationKit = { requireAssetDestination: vi.fn(requireAssetDestination), prepareAssetWrites: vi.fn(prepareAssetWrites), writeAssetFiles: vi.fn(writeAssetFiles) };
  const describeWriteBatch = vi.fn(({ batch, toolId }: { batch: PreparedAssetBatch<Buffer>; toolId: string }) => ({ toolId, errorCode: "FILES", title: "Write images", confirmLabel: "Confirm", details: [{ label: "Bytes", value: batch.writes.map(({ bytes }) => bytes.toString()).join(",") }] }));
  const askHuman = vi.fn<() => Promise<ApprovalAnswer>>(async () => ({ confirmed: true }));
  const approvalToolHandler: AssetApprovalToolHandler = (steps, options = {}) => createApprovalHandler({
    prepare: steps.prepare, describe: async ({ ctx, prepared }) => ({ ask: options.ask?.({ prepared }) ?? true, description: await steps.describe({ ctx, prepared }) }),
    askHuman, run: ({ ctx, prepared, confirmer, choice }, options) => steps.run({ ctx, prepared, confirmer, ...(choice === undefined ? {} : { choice }) }, options), notConfirmed: () => ({ applied: false }),
  });
  const surfaces = { surfaceExchanges: { open: vi.fn<SurfaceExchangeStore["open"]>(), deliver: vi.fn<SurfaceExchangeStore["deliver"]>(), findTypedAnswerTarget: vi.fn<SurfaceExchangeStore["findTypedAnswerTarget"]>(), size: () => 0 } };
  const sourceSchema = { type: "object", additionalProperties: false, required: ["root", "path"], properties: {
    root: { type: "string", enum: ["site", "picked", "theme", "media"] },
    path: { type: "string", minLength: 1, description: "Path" }, themeId: { type: "string", minLength: 1, description: "Theme" },
  } } as const;
  const catalog = buildImageTransformAgentToolCatalog({ sourceSchema, fsReadPermission: "files.read" });
  const approval = { approvalToolHandler, describeWriteBatch };
  const handler = buildImageTransformRegistrations({ deps, surfaces, catalog, approval, destinationKit })[0]!.handler;
  const ctx = (input: unknown): ToolExecutionContext => ({ input, executionId: "execution", principal: { id: "agent" }, run: { id: "run" }, signal: new AbortController().signal });
  return { deps, destinationKit, describeWriteBatch, askHuman, handler, ctx, approval, catalog, surfaces };
}

describe("image transform execution", () => {
  it("inspect never calls the destination kit", async () => {
    const { deps, destinationKit, askHuman, handler, ctx } = fixture();
    expect(await handler(ctx({ source: { root: "site", path: "source.png" } }))).toEqual({ applied: false, source: { format: "png", width: 32, height: 32, hasAlpha: true, bytes: 12 }, outputs: [] });
    expect(deps.source.readAsset).toHaveBeenCalledOnce();
    expect(deps.imageCodec.inspect).toHaveBeenCalledOnce();
    expect(deps.imageCodec.encode).not.toHaveBeenCalled();
    for (const port of Object.values(destinationKit)) expect(port).not.toHaveBeenCalled();
    expect(askHuman).not.toHaveBeenCalled();
  });

  it("the site and picked card describes the exact rendered bytes later written", async () => {
    for (const kind of ["site", "picked"]) {
      const { deps, destinationKit, describeWriteBatch, askHuman, handler, ctx } = fixture();
      askHuman.mockImplementation(async () => {
        expect(destinationKit.writeAssetFiles).not.toHaveBeenCalled();
        expect(describeWriteBatch).toHaveBeenCalledWith({ batch: { folder: `/${kind}`, writes: [{ path: "small.png", bytes: Buffer.from("exact rendered bytes"), overwrite: kind === "picked" }] }, toolId: IMAGE_TRANSFORM_TOOL_ID }, {});
        deps.imageCodec.encode.mockResolvedValue({ bytes: Buffer.from("changed after card"), width: 8, height: 8 });
        return { confirmed: true };
      });
      expect(await handler(ctx({ source: { root: "site", path: "source.png" }, outputs: [{ path: "small.png", format: "png" }], destination: { kind } }))).toMatchObject({ applied: true, outputs: [{ path: "small.png", format: "png", width: 16, height: 16, bytes: 20 }], written: ["small.png"] });
      expect(askHuman).toHaveBeenCalledOnce();
      expect(deps.source.readAsset).toHaveBeenCalledOnce();
      expect(deps.imageCodec.encode).toHaveBeenCalledOnce();
      expect(destinationKit.prepareAssetWrites).toHaveBeenCalledOnce();
      expect(destinationKit.writeAssetFiles).toHaveBeenCalledOnce();
      expect(destinationKit.writeAssetFiles.mock.calls[0]![0].prepared).toBe(destinationKit.prepareAssetWrites.mock.results[0]!.value);
      expect(deps.destination.fs.writePrepared).toHaveBeenCalledWith(describeWriteBatch.mock.calls[0]![0].batch, {});
    }
  });

  it("a declined picked batch never calls the writer", async () => {
    const { deps, destinationKit, askHuman, handler, ctx } = fixture();
    askHuman.mockResolvedValue({ confirmed: false, reason: "declined" });
    expect(await handler(ctx({ source: { root: "site", path: "source.png" }, outputs: [{ path: "small.png", format: "png" }], destination: { kind: "picked" } }))).toEqual({ applied: false });
    expect(askHuman).toHaveBeenCalledOnce();
    expect(destinationKit.prepareAssetWrites).toHaveBeenCalledOnce();
    expect(destinationKit.writeAssetFiles).not.toHaveBeenCalled();
    expect(deps.destination.fs.writePrepared).not.toHaveBeenCalled();
  });
  it("the prepared writer omits failed on success and preserves a named partial failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "image-transform-writer-"));
    try {
      for (const fails of [false, true]) {
        const { deps, handler, ctx } = fixture();
        const folder = join(root, fails ? "partial" : "success");
        mkdirSync(folder);
        deps.destination.fs.siteFolder.mockReturnValue(folder);
        deps.destination.fs.writePrepared.mockImplementation(batch => writePreparedFiles({ ...batch, resolveFsFilePath: ({ rootPath, relativePath }) => join(rootPath, relativePath) }));
        if (fails) mkdirSync(join(folder, "blocked.png"));
        const result = await handler(ctx({ source: { root: "site", path: "source.png" }, outputs: [{ path: "first.png", format: "png" }, { path: "blocked.png", format: "png" }, { path: "last.png", format: "png" }], destination: { kind: "site" } })) as { applied: boolean; written: string[]; notWritten: string[]; failed?: { path: string; reason: string } };
        expect(result.applied).toBe(!fails);
        if (fails) {
          expect(result.written).toEqual(["first.png"]);
          expect(result.failed).toEqual({ path: "blocked.png", reason: expect.any(String) });
          expect(result.notWritten).toEqual(["last.png"]);
          expect(existsSync(join(folder, "last.png"))).toBe(false);
        } else {
          expect(Object.hasOwn(result, "failed")).toBe(false);
          expect(result.written).toEqual(["first.png", "blocked.png", "last.png"]);
          expect(result.notWritten).toEqual([]);
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

});

it("the transform contributor uses the bound source and reports known shape errors with the tool schema", async () => {
  const { approval, catalog, surfaces, destinationKit, deps, ctx, askHuman } = fixture();
  const missingSource = new Error("Pick the source folder again");
  const unrelated = new Error("injected source storage unavailable");
  const bindDeps = vi.fn(({ deps: host }: { deps: { site: string } }, _options?: Record<string, never>) => {
    if (host.site !== "west") throw new Error("wrong host fixture");
    return { ...deps, isFsShapeRejection: ({ error }: { error: unknown }) => error === missingSource };
  });
  const tool = contributeImageTransformTools({ approval, catalog, destinationKit, bindDeps }).build({ site: "west" }, surfaces)[0]!;
  const inspect = { source: { root: "site", path: "source.png" } };
  deps.source.readAsset.mockRejectedValueOnce(missingSource).mockRejectedValueOnce(unrelated);
  await expect(tool.handler(ctx(inspect))).rejects.toThrow(/Pick the source folder again[\s\S]*image_transform/);
  await expect(tool.handler(ctx(inspect))).rejects.toBe(unrelated);
  const invalidOutput = { ...inspect, outputs: [{ path: "small.png", format: "jpeg" }] };
  await expect(tool.handler(ctx(invalidOutput))).rejects.toThrow(/small\.png[\s\S]*image_transform/);
  expect(bindDeps.mock.calls).toEqual([[{ deps: { site: "west" } }, {}]]);
  expect(deps.source.readAsset.mock.calls).toHaveLength(2);
  expect(askHuman.mock.calls).toEqual([]);
  expect(destinationKit.writeAssetFiles.mock.calls).toEqual([]);
});
