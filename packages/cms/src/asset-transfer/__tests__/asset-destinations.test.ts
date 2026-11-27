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

it("bounds rename probing when every name is already occupied", () => {
  const deps = fixture();
  deps.fs.inspect.mockReturnValue({ overwrite: true });
  expect(() => prepareAssetWrites({ deps, destination: { kind: "site" }, policy: "rename", files: [
    { path: "icon.png", bytes: Buffer.from("fixture") },
  ] })).toThrow("icon.png: too many filename collisions");
  expect(deps.fs.inspect).toHaveBeenCalledTimes(1000);
  expect(deps.fs.prepareSite.mock.calls).toEqual([]);
});

it("rejects a nested filename before validating or persisting media bytes", () => {
  const deps = fixture();
  expect(() => prepareAssetWrites({ deps, destination: { kind: "media" }, files: [
    { path: "nested/icon.png", bytes: Buffer.from("fixture") },
  ] })).toThrow("Media destinations use a filename, not a folder path");
  expect(deps.media.validateBytes.mock.calls).toEqual([]);
  expect(deps.media.persist.mock.calls).toEqual([]);
});

it("checks then writes the requested theme file and returns reloaded theme status", async () => {
  const deps = fixture();
  const bytes = Buffer.from("fixture image");
  const theme = { dir: "/theme", status: "before" };
  deps.theme.findTheme.mockReturnValue(theme);
  deps.theme.reloadTheme.mockReturnValue({ dir: "/theme", status: "after" });
  const prepared = prepareAssetWrites({ deps, destination: { kind: "theme", themeId: "ink" }, files: [
    { path: "assets/icon.png", bytes },
  ] });
  expect(deps.theme.checkThemeWrite.mock.calls).toEqual([[{ theme, relativePath: "assets/icon.png" }, {}]]);
  expect(deps.theme.writeThemeFile.mock.calls).toEqual([]);
  expect(await writeAssetFiles({ deps, ctx, prepared }))
    .toEqual({ written: ["assets/icon.png"], skipped: [], status: "after", errors: undefined });
  expect(deps.theme.writeThemeFile.mock.calls).toEqual([[{ theme, relativePath: "assets/icon.png", bytes }, {}]]);
  expect(deps.theme.reloadTheme.mock.calls).toEqual([[{ theme, themeId: "ink" }, {}]]);
});

it("reports a skipped theme file without modifying or reloading the theme", async () => {
  const deps = fixture();
  const prepared = prepareAssetWrites({ deps, destination: { kind: "theme", themeId: "ink" }, policy: "skip", files: [
    { path: "image.png", bytes: Buffer.from("unused") },
  ] });
  expect(await writeAssetFiles({ deps, ctx, prepared })).toEqual({ written: [], skipped: ["image.png"], status: "ready", errors: undefined });
  expect(deps.theme.writeThemeFile.mock.calls).toEqual([]);
  expect(deps.theme.reloadTheme.mock.calls).toEqual([]);
});

it("persists private document bytes through the Library with actor and display filename", async () => {
  const deps = fixture();
  const document = { id: "private-doc" };
  const bytes = Buffer.from("private fixture");
  deps.library.saveDocument.mockResolvedValue({ document });
  const prepared = prepareAssetWrites({ deps, destination: { kind: "library" }, files: [{ path: "notes.txt", bytes }] });
  expect(await writeAssetFiles({ deps, ctx, prepared })).toEqual({ written: ["notes.txt"], skipped: [], documents: [document] });
  expect(deps.library.saveDocument.mock.calls).toEqual([[{ name: "notes.txt", bytes, principalId: "agent" }, {}]]);
  expect(deps.media.persist.mock.calls).toEqual([]);
});

it("refuses a file batch containing duplicate destination names under overwrite", () => {
  const deps = fixture();
  expect(() => prepareAssetWrites({ deps, destination: { kind: "site" }, policy: "overwrite", files: [
    { path: "First.png", bytes: Buffer.from("one") }, { path: "first.png", bytes: Buffer.from("two") },
  ] })).toThrow("first.png: duplicate destination in this batch");
  expect(deps.fs.prepareSite.mock.calls).toEqual([]);
});

it("refuses a site write when its prepared approval batch is missing", async () => {
  const deps = fixture();
  const prepared = prepareAssetWrites({ deps, destination: { kind: "site" }, files: [
    { path: "new.txt", bytes: Buffer.from("requires approval") },
  ] });
  expect(prepared.batch).toEqual({ folder: "/site", writes: [{ path: "new.txt", bytes: Buffer.from("requires approval"), overwrite: false }] });
  const { batch: _lostApproval, ...unapproved } = prepared;
  await expect(writeAssetFiles({ deps, ctx, prepared: unapproved })).rejects.toThrow("Theme asset destination has no theme ID");
  expect(deps.fs.writePrepared.mock.calls).toEqual([]);
  expect(deps.theme.findTheme.mock.calls).toEqual([]);
  expect(deps.theme.writeThemeFile.mock.calls).toEqual([]);
});
