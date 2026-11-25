import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const targets = ["../AgentPluginSurfaceFrame.tsx", "../hooks/use-agent-plugin-surfaces.hooks.ts"];

// The host app's own guard still owns host seams, and this package now owns these two sources.
function scanSurfaceVendorWords(
  { targets, readText }: { targets: readonly string[]; readText: (required: { file: string }) => string },
  _optional: Record<string, never> = {},
): readonly { file: string; line: number }[] {
  return targets.flatMap((file) => {
    const source = readText({ file });
    expect(source.length, file).toBeGreaterThan(0);
    return source.split("\n").flatMap((line, index) => /google|googleapis|gsheets|spreadsheet|drive\.file|picker/i.test(line)
      ? [{ file, line: index + 1 }] : []);
  });
}

function readText({ file }: { file: string }): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

test("scans both moved plugin surface sources", () => {
  const read: string[] = [];
  expect(scanSurfaceVendorWords({ targets, readText: ({ file }) => { read.push(file); return "export {};"; } })).toEqual([]);
  expect(read).toEqual(targets);
  expect(scanSurfaceVendorWords({ targets, readText })).toEqual([]);
});

test("reports a provider word with the source path and line", () => {
  const sources = ["export {};\nconst provider = 'google';", "const provider = 'picker';"];
  expect(scanSurfaceVendorWords({ targets, readText: ({ file }) => sources[targets.indexOf(file)]! })).toEqual([
    { file: targets[0], line: 2 },
    { file: targets[1], line: 1 },
  ]);
});

test("fails when a moved surface source cannot be read", () => {
  expect(() => scanSurfaceVendorWords({ targets, readText: () => { throw new Error("missing source"); } })).toThrow("missing source");
  expect(() => scanSurfaceVendorWords({ targets, readText: () => "" })).toThrow();
});
