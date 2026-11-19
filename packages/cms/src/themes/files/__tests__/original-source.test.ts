import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hasThemeOriginalLayoutMismatch, isPackageShippedTheme, resolveThemeOriginalSource } from "../original-source.node.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const maxManifestBytes = 1024;
type Manifest = { json: unknown } | { text: string } | "directory" | "missing";
function writeManifest(dir: string, value: Manifest): void {
  mkdirSync(dir, { recursive: true });
  if (value === "missing") return;
  if (value === "directory") { mkdirSync(join(dir, "theme.json")); return; }
  writeFileSync(join(dir, "theme.json"), "json" in value ? JSON.stringify(value.json) : value.text);
}
const v1 = { json: { id: "t", tier: "static" } };
const v2 = { json: { apiVersion: 2, id: "t", tier: "static" } };
describe("original layout", () => {
  it.each<[Manifest, Manifest, boolean]>([
    [v1, v1, false], [v2, v2, false], [v1, v2, true], [v2, v1, true],
    [{ json: { apiVersion: 3 } }, v1, false], ["missing", v2, true],
    [{ text: "{ broken" }, v2, true], [{ json: [2] }, v1, true],
    [{ text: "null" }, v1, true], ["directory", v1, true],
    [{ text: `{"apiVersion":2,"pad":"${"x".repeat(maxManifestBytes)}"}` }, v2, true],
    [v2, { text: "{ broken" }, false], [v1, "missing", false],
  ])("compares original %j and live %j", (original, live, refused) => {
    const root = mkdtempSync(join(tmpdir(), "cms-original-layout-")); roots.push(root);
    const originalDir = join(root, "original"), themeDir = join(root, "live");
    writeManifest(originalDir, original); writeManifest(themeDir, live);
    expect(hasThemeOriginalLayoutMismatch({ themeDir, originalDir, maxManifestBytes })).toBe(refused);
  });
});
it("prefers the site catalog, falls back to the package, and identifies shipped themes only from the package", () => {
  const root = mkdtempSync(join(tmpdir(), "cms-original-source-")); roots.push(root);
  const siteThemesRoot = join(root, "site"), packageThemesRoot = join(root, "package");
  const manifest = { id: "sample", tier: "static" };
  const site = join(siteThemesRoot, "__original-themes__", "static", "sample");
  const packaged = join(packageThemesRoot, "__original-themes__", "static", "sample");
  mkdirSync(site, { recursive: true });
  expect(isPackageShippedTheme({ manifest, packageThemesRoot })).toBe(false);
  mkdirSync(packaged, { recursive: true });
  expect(resolveThemeOriginalSource({ manifest, siteThemesRoot, packageThemesRoot })?.originalDir).toBe(site);
  expect(isPackageShippedTheme({ manifest, packageThemesRoot })).toBe(true);
  rmSync(site, { recursive: true });
  expect(resolveThemeOriginalSource({ manifest, siteThemesRoot, packageThemesRoot })?.originalDir).toBe(packaged);
});
