import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { hasThemeOriginalLayoutMismatch, isPackageShippedTheme, resolveThemeOriginalSource } from "../original-source.node.js";

const roots: string[] = [];
const maxManifestBytes = 1024;
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
type ManifestOnDisk = { json: unknown } | { text: string } | "directory" | "missing";
function writeManifest(dir: string, manifest: ManifestOnDisk): void {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "theme.json");
  if (manifest === "missing") return;
  if (manifest === "directory") { mkdirSync(target); return; }
  writeFileSync(target, "json" in manifest ? JSON.stringify(manifest.json) : manifest.text, "utf8");
}
const V1 = { json: { id: "t", tier: "static" } };
const V2 = { json: { apiVersion: 2, id: "t", tier: "static" } };
const CASES: ReadonlyArray<{ name: string; original: ManifestOnDisk; live: ManifestOnDisk; refused: boolean }> = [
  { name: "v1 original, v1 live", original: V1, live: V1, refused: false },
  { name: "v2 original, v2 live", original: V2, live: V2, refused: false },
  { name: "v1 original, v2 live", original: V1, live: V2, refused: true },
  { name: "v2 original, v1 live", original: V2, live: V1, refused: true },
  { name: "an apiVersion other than 2 in the original reads as v1", original: { json: { apiVersion: 3 } }, live: V1, refused: false },
  { name: "the original has no theme.json", original: "missing", live: V2, refused: true },
  { name: "the original's theme.json is not JSON", original: { text: "{ not json" }, live: V2, refused: true },
  { name: "the original's theme.json is a JSON array", original: { json: [2] }, live: V1, refused: true },
  { name: "the original's theme.json is JSON null", original: { text: "null" }, live: V1, refused: true },
  { name: "the original's theme.json is a directory", original: "directory", live: V1, refused: true },
  { name: "the original's theme.json is past the read limit", original: { text: `{"apiVersion":2,"pad":"${"x".repeat(maxManifestBytes)}"}` }, live: V2, refused: true },
  { name: "an unreadable live manifest allows repair", original: V2, live: { text: "{ broken" }, refused: false },
  { name: "a missing live manifest allows repair", original: V1, live: "missing", refused: false },
];
for (const { name, original, live, refused } of CASES) {
  test(name, () => {
    const root = mkdtempSync(join(tmpdir(), "theme-layout-"));
    roots.push(root);
    const themeDir = join(root, "live"), originalDir = join(root, "original");
    writeManifest(originalDir, original);
    writeManifest(themeDir, live);
    assert.equal(hasThemeOriginalLayoutMismatch({ themeDir, originalDir, maxManifestBytes }), refused);
  });
}

test("package catalog supplies an absent site original and the site catalog wins when present", () => {
  const root = mkdtempSync(join(tmpdir(), "theme-source-"));
  roots.push(root);
  const siteThemesRoot = join(root, "site"), packageThemesRoot = join(root, "package");
  const manifest = { id: "plain", tier: "static" };
  const required = { manifest, siteThemesRoot, packageThemesRoot };
  assert.equal(resolveThemeOriginalSource(required), null);
  assert.equal(resolveThemeOriginalSource({ ...required, packageThemesRoot: undefined }), null);
  const packageRoot = join(packageThemesRoot, "__original-themes__");
  const packageDir = join(packageRoot, manifest.tier, manifest.id);
  writeManifest(packageDir, V2);
  assert.deepEqual(resolveThemeOriginalSource(required), { source: "package", originalDir: packageDir, originalsRoot: packageRoot });
  const siteRoot = join(siteThemesRoot, "__original-themes__"), siteDir = join(siteRoot, manifest.tier, manifest.id);
  writeManifest(siteDir, V1);
  assert.deepEqual(resolveThemeOriginalSource(required), { source: "site", originalDir: siteDir, originalsRoot: siteRoot });
  assert.deepEqual(JSON.parse(readFileSync(join(packageDir, "theme.json"), "utf8")), V2.json);
});

test("shipped predicate uses only the package catalog", () => {
  const root = mkdtempSync(join(tmpdir(), "theme-shipped-"));
  roots.push(root);
  const manifest = { tier: "static", id: "plain" };
  assert.equal(isPackageShippedTheme({ manifest, packageThemesRoot: undefined }), false);
  assert.equal(isPackageShippedTheme({ manifest, packageThemesRoot: root }), false);
  mkdirSync(join(root, "__original-themes__", manifest.tier, manifest.id), { recursive: true });
  assert.equal(isPackageShippedTheme({ manifest, packageThemesRoot: root }), true);
  assert.equal(isPackageShippedTheme({ manifest, packageThemesRoot: join(root, "other") }), false);
});
