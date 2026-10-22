import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, test } from "vitest";

function hostReferences(directory: string): string[] {
  const forbidden = ["apps/" + "website", "#" + "src/", String.fromCharCode(116, 111, 118, 117)];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return hostReferences(path);
    if (!/\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    const source = readFileSync(path, "utf8");
    return forbidden.some((value) => source.toLowerCase().includes(value)) ? [path] : [];
  });
}

test("platform source never references host source paths or aliases", () => {
  expect(hostReferences(fileURLToPath(new URL("..", import.meta.url)))).toEqual([]);
});
