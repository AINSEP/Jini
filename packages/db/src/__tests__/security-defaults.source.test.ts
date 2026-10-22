import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/** Source contract only: protects package neutrality; behavior has dedicated regression tests. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === "__tests__" || entry.name === "tests" || /\.test\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}
test("production source has no consumer imports or runtime specification IDs", () => {
  const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
  const forbiddenConsumer = ["apps/website", "#src/", "@" + String.fromCharCode(116, 111, 118, 117)];
  const violations: string[] = [];
  for (const path of sourceFiles(sourceRoot)) {
    const source = readFileSync(path, "utf8");
    for (const token of forbiddenConsumer) if (source.includes(token)) violations.push(`${path}: consumer reference ${token}`);
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    for (const [index, line] of source.split("\n").entries()) {
      // Design-rationale comments retain their references. This catches authored runtime strings.
      if (/^\s*(?:\*|\/\/|\/\*)/.test(line)) continue;
      if (/["'`].*\b(?:REQ|SEC|INV|U|ADR|SPEC|AC|EC)-\d/.test(line)) violations.push(`${path}:${index + 1}: runtime specification ID`);
    }
  }
  expect(violations).toEqual([]);
});
