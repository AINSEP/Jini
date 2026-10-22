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


// Pins the completed identity migration while forms now use the folded CMS boundary.
// PARITY: moving this guard preserves the retired identity entries and source-directory checks.
test("CMS removes identity entry points while preserving the media import subpath", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    exports: Record<string, unknown>; jini: { entries: Record<string, string> };
    dependencies: Record<string, string>; devDependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
    peerDependenciesMeta: Record<string, { optional: boolean }>;
    sideEffects: boolean | string[];
  };
  for (const retired of ["./identity", "./identity/hasher"]) {
    expect(Object.hasOwn(manifest.exports, retired)).toBe(false);
    expect(Object.hasOwn(manifest.jini.entries, retired)).toBe(false);
  }
  expect(Object.hasOwn(manifest.exports, "./forms")).toBe(true);
  expect(manifest.jini.entries["./forms"]).toBe("universal");
  expect(Object.hasOwn(manifest.exports, "./media/import")).toBe(true);
  // Core was an optional peer because media/import has no runtime kernel dependency;
  // folded CMS services now call the shared core owner, so the package depends on it directly.
  expect(manifest.dependencies).toEqual({ "@jini-ai/core": "workspace:^" });
  expect(Object.hasOwn(manifest.peerDependencies, "@jini-ai/core")).toBe(false);
  expect(Object.hasOwn(manifest.peerDependenciesMeta, "@jini-ai/core")).toBe(false);
  expect(manifest.devDependencies["@jini-ai/core"]).toBe("workspace:*");
  expect(manifest.sideEffects).toBe(false);
  expect(existsSync(new URL("../identity/", import.meta.url))).toBe(false);
});
