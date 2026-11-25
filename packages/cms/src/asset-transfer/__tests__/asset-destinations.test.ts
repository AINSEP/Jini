import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { AssetTheme, PreparedAssetBatch } from "@jini-ai/core/contracts/site/asset-transfer-tool-ports";
import { writePreparedFiles } from "../../fs-files/write-files.js";
import { prepareAssetWrites, requireAssetDestination, writeAssetFiles, type AssetDestinationDeps } from "../asset-destinations.js";

const ctx: ToolExecutionContext = { input: {}, executionId: "execution", principal: { id: "agent" }, run: { id: "run" }, signal: new AbortController().signal };
function fixture() {
  const deps = {
    workspaceId: "workspace", authorize: vi.fn(async () => ({ allowed: true, reason: "granted" })),
    refuseUnexpectedKeys: vi.fn(), permissions: { site: "files.manage", picked: "files.manage", theme: "theme.edit", media: "media.upload", library: "media.upload" },
    fs: {
      siteFolder: vi.fn(() => "/site"), inspect: vi.fn(({ path }: { folder: string; path: string }) => ({ overwrite: path === "image.png" })),
      prepareSite: vi.fn(({ folder, files }: { folder: string; files: { path: string; content: string; encoding: "base64" }[] }): PreparedAssetBatch<Buffer> => ({ folder, writes: files.map(({ path, content }) => ({ path, bytes: Buffer.from(content, "base64"), overwrite: false })) })),
      preparePicked: vi.fn(({ files }: { files: { path: string; content: string; encoding: "base64" }[] }): PreparedAssetBatch<Buffer> => ({ folder: "/picked", writes: files.map(({ path, content }) => ({ path, bytes: Buffer.from(content, "base64"), overwrite: true })) })),
      writePrepared: vi.fn(({ writes }: { folder: string; writes: PreparedAssetBatch<Buffer>["writes"] }) => ({ written: writes.map(({ path }) => path), notWritten: [] as string[] })),
      chooseNextName: vi.fn(({ desiredPath, existingPaths }: { desiredPath: string; existingPaths: Set<string> }) => `${desiredPath.slice(0, -4)}-${existingPaths.size + 1}.png`),
    },
    theme: {
      findTheme: vi.fn(() => ({ dir: "/theme", status: "ready" })), checkThemeWrite: vi.fn(), writeThemeFile: vi.fn(),
      reloadTheme: vi.fn(() => ({ dir: "/theme", status: "ready" })),
    },
    media: { validateBytes: vi.fn(() => "image/png"), persist: vi.fn<AssetDestinationDeps<AssetTheme>["media"]["persist"]>() },
    library: { saveDocument: vi.fn(async () => ({ document: {} })) },
  } satisfies AssetDestinationDeps<AssetTheme>;
  return deps;
}

describe("asset destinations", () => {
  it("destination permission binds the correct entity", async () => {
    const deps = fixture();
    for (const [input, permission, entityType, entityId] of [
      [{ kind: "site" }, "files.manage", "site", "site"],
      [{ kind: "picked" }, "files.manage", "fs-root", "picked"],
      [{ kind: "media" }, "media.upload", "media", "media"],
      [{ kind: "library" }, "media.upload", "media", "media"],
      [{ kind: "theme", themeId: "chosen" }, "theme.edit", "theme", "chosen"],
    ] as const) {
      expect(await requireAssetDestination({ deps, ctx, input })).toEqual(input);
      expect(deps.authorize).toHaveBeenLastCalledWith({ workspaceId: "workspace", principalId: "agent", permission }, { entityType, entityId });
      expect(deps.refuseUnexpectedKeys.mock.invocationCallOrder.at(-1)).toBeLessThan(deps.authorize.mock.invocationCallOrder.at(-1)!);
    }
  });

  it("preparation never writes and preserves the picked-folder batch", async () => {
    const deps = fixture();
    const bytes = Buffer.from("exact approved bytes");
    const prepared = prepareAssetWrites({ deps, destination: { kind: "picked" }, files: [{ path: "image.png", bytes }] });
    const batch = deps.fs.preparePicked.mock.results[0]!.value;
    expect(prepared.batch).toBe(batch);
    expect(batch).toEqual({ folder: "/picked", writes: [{ path: "image.png", bytes, overwrite: true }] });
    expect(deps.fs.writePrepared).not.toHaveBeenCalled();
    expect(deps.theme.writeThemeFile).not.toHaveBeenCalled();
    expect(deps.media.persist).not.toHaveBeenCalled();
    expect(deps.library.saveDocument).not.toHaveBeenCalled();
    await writeAssetFiles({ deps, ctx, prepared });
    expect(deps.fs.writePrepared).toHaveBeenCalledWith(batch, {});
  });

  it("rename observes disk and case-folded in-batch reservations", () => {
    const deps = fixture();
    const prepared = prepareAssetWrites({ deps, destination: { kind: "site" }, policy: "rename", files: [
      { path: "image.png", bytes: Buffer.from("one") }, { path: "IMAGE-2.png", bytes: Buffer.from("two") },
    ] });
    expect(prepared.files.map(({ path }) => path)).toEqual(["image-2.png", "IMAGE-2-2.png"]);
    expect(deps.fs.inspect).toHaveBeenCalledWith({ folder: "/site", path: "image.png" }, {});
    expect(deps.fs.chooseNextName).toHaveBeenCalledTimes(2);
    expect(new Set(prepared.files.map(({ path }) => path.toLowerCase())).size).toBe(2);
    expect(deps.fs.writePrepared).not.toHaveBeenCalled();
  });

  it("site execution returns the first failure and remaining paths", async () => {
    const folder = mkdtempSync(join(tmpdir(), "asset-destination-"));
    try {
      const deps: AssetDestinationDeps<AssetTheme> = fixture();
      deps.fs.siteFolder = () => folder;
      deps.fs.writePrepared = (batch) => writePreparedFiles({ ...batch, resolveFsFilePath: ({ rootPath, relativePath }) => join(rootPath, relativePath) });
      const prepared = prepareAssetWrites({ deps, destination: { kind: "site" }, files: [
        { path: "first.txt", bytes: Buffer.from("first") }, { path: "blocked.txt", bytes: Buffer.from("blocked") }, { path: "remaining.txt", bytes: Buffer.from("remaining") },
      ] });
      mkdirSync(join(folder, "blocked.txt"));
      const result = await writeAssetFiles({ deps, ctx, prepared });
      expect(result).toEqual({ written: ["first.txt"], skipped: [], failed: { path: "blocked.txt", reason: expect.any(String) }, notWritten: ["remaining.txt"] });
      expect(readFileSync(join(folder, "first.txt"), "utf8")).toBe("first");
      expect(existsSync(join(folder, "remaining.txt"))).toBe(false);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
