import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.name === "__tests__") return [];
    return entry.isDirectory() ? sources(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}


// Pins the completed identity migration and the separate forms package boundary.
// PARITY: moving this guard preserves the retired identity entries and source-directory checks.
test("CMS removes identity entry points while preserving the media import subpath", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    exports: Record<string, unknown>; jini: { entries: Record<string, string> };
    dependencies: Record<string, string>; sideEffects: boolean | string[];
  };
  for (const retired of ["./identity", "./identity/hasher"]) {
    expect(Object.hasOwn(manifest.exports, retired)).toBe(false);
    expect(Object.hasOwn(manifest.jini.entries, retired)).toBe(false);
  }
  expect(Object.hasOwn(manifest.exports, "./forms")).toBe(false);
  expect(Object.hasOwn(manifest.exports, "./media/import")).toBe(true);
  expect(Object.keys(manifest.dependencies)).toEqual(["@jini-ai/core"]);
  expect(manifest.sideEffects).toBe(false);
  expect(existsSync(new URL("../identity/", import.meta.url))).toBe(false);
});
