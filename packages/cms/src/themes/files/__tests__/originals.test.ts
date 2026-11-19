import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resetThemeFileToOriginal, themeFileDiffersFromOriginal, type ThemeOriginalFilePorts } from "../originals.node.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
class PathError extends Error {}
const ports: ThemeOriginalFilePorts = {
  resolvePath: ({ themeDir, relativePath }) => {
    const target = resolve(themeDir, relativePath);
    if (!target.startsWith(resolve(themeDir) + sep)) throw new PathError();
    return target;
  },
  statPath: ({ target }) => { try { return statSync(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } },
  digest: ({ path }) => createHash("sha256").update(readFileSync(path)).digest("hex"),
  changedError: () => new Error("changed"), pathError: () => new PathError(), reportPruneFailure: () => {},
  isPathError: ({ error }) => error instanceof PathError,
};
function setup() {
  const themesRoot = mkdtempSync(join(tmpdir(), "cms-originals-")); roots.push(themesRoot);
  const themeDir = join(themesRoot, "live"), originalsRoot = join(themesRoot, "originals"), originalDir = join(originalsRoot, "live");
  mkdirSync(themeDir, { recursive: true }); mkdirSync(originalDir, { recursive: true });
  return { themesRoot, themeDir, originalsRoot, originalDir, relativePath: "file", ports };
}
it("compares equal-sized bytes through the last chunk", () => {
  const args = setup(), live = Buffer.alloc(200001, 97), original = Buffer.from(live);
  original[70000] = 98;
  writeFileSync(join(args.themeDir, "file"), live); writeFileSync(join(args.originalDir, "file"), original);
  expect(themeFileDiffersFromOriginal(args)).toBe(true);
});
it("returns on different sizes without opening either file", () => {
  const args = setup();
  writeFileSync(join(args.themeDir, "file"), "long"); writeFileSync(join(args.originalDir, "file"), "x");
  chmodSync(join(args.themeDir, "file"), 0);
  if (process.getuid?.() !== 0) expect(themeFileDiffersFromOriginal(args)).toBe(true);
});
it("checks the original before resolving live on reset and maps original path refusals to missing", () => {
  const args = setup();
  expect(resetThemeFileToOriginal({ ...args, relativePath: "../outside" })).toBeNull();
  expect(resetThemeFileToOriginal(args)).toBeNull();
});
it("does not rewrite identical bytes", () => {
  const args = setup(), bytes = Buffer.from([0xff, 0xfe, 0, 0x80]);
  writeFileSync(join(args.themeDir, "file"), bytes); writeFileSync(join(args.originalDir, "file"), bytes);
  const inode = statSync(join(args.themeDir, "file")).ino;
  expect(resetThemeFileToOriginal(args)).toEqual({ wasModified: false, bytes: bytes.length });
  expect(statSync(join(args.themeDir, "file")).ino).toBe(inode);
});
it("creates parents and preserves binary bytes and original mode", () => {
  const args = { ...setup(), relativePath: "fonts/sub/face" }, bytes = Buffer.from([0x77, 0xff, 0xfe, 0, 0x80]);
  const original = join(args.originalDir, args.relativePath), live = join(args.themeDir, args.relativePath);
  mkdirSync(dirname(original), { recursive: true }); writeFileSync(original, bytes); chmodSync(original, 0o640);
  expect(resetThemeFileToOriginal(args)).toEqual({ wasModified: true, bytes: bytes.length });
  expect(readFileSync(live)).toEqual(bytes); expect(statSync(live).mode & 0o777).toBe(0o640);
});
it("preserves the existing live mode", () => {
  const args = setup(), live = join(args.themeDir, "file");
  writeFileSync(join(args.originalDir, "file"), "new"); writeFileSync(live, "old"); chmodSync(live, 0o600);
  expect(resetThemeFileToOriginal(args)).toEqual({ wasModified: true, bytes: 3 });
  expect(readFileSync(live, "utf8")).toBe("new"); expect(statSync(live).mode & 0o777).toBe(0o600);
});
it("propagates original I/O errors and resolves live first for comparison", () => {
  const args = setup(), failure = new Error("stat failed"), calls: string[] = [];
  const recording: ThemeOriginalFilePorts = {
    ...ports,
    resolvePath: (address) => { calls.push(address.themeDir); return ports.resolvePath(address); },
    statPath: () => { throw failure; },
  };
  expect(() => themeFileDiffersFromOriginal({ ...args, ports: recording })).toThrow(failure);
  expect(calls).toEqual([args.themeDir, args.originalDir]);
});
