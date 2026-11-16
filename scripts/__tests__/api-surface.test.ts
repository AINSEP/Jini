import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  baselineFileName, buildPackageSurface, coveredByChangeset, diffSurface, isBreaking,
  parseChangesetBumps, pickTarget,
} from "../lib/api-surface.ts";

function pkg(files: Record<string, string>, exportsField: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "api-surface-"));
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), c);
  }
  return buildPackageSurface(dir, exportsField);
}
const E = { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./x": "./dist/x.d.ts", "./s.css": "./s.css" };

describe("surface extraction + diff", () => {
  const v1 = { "dist/index.d.ts": "export declare function f(a: string): number;\nexport interface I { a: 1 }\nexport * from './sub.js';", "dist/sub.d.ts": "export declare const k: 1;", "dist/x.d.ts": "export type T = string;" };
  const base = pkg(v1, E);
  it("records subpaths, assets and re-exports", () => {
    expect(Object.keys(base)).toEqual([".", "./s.css", "./x"]);
    expect(Object.keys(base["."]!.symbols)).toEqual(["I", "f", "k"]);
    expect(base["./s.css"]!.types).toBeNull();
  });
  it("is identical for identical input and ignores comments/whitespace", () => {
    const same = pkg({ ...v1, "dist/index.d.ts": "/** doc */ export declare function f( a: string ): number;\nexport interface I { a: 1 }\nexport * from './sub.js';" }, E);
    expect(diffSurface(base, same)).toMatchObject({ removedSymbols: [], changedSymbols: [], addedSymbols: [] });
  });
  it("flags removed + renamed exports as breaking", () => {
    const cur = pkg({ ...v1, "dist/sub.d.ts": "export declare const k2: 1;" }, E);
    const d = diffSurface(base, cur);
    expect(d.removedSymbols).toEqual([".#k"]);
    expect(d.addedSymbols).toEqual([".#k2"]);
    expect(isBreaking(d)).toBe(true);
  });
  it("flags changed signature as non-breaking (report-only)", () => {
    const cur = pkg({ ...v1, "dist/index.d.ts": v1["dist/index.d.ts"].replace("a: string", "a: number") }, E);
    const d = diffSurface(base, cur);
    expect(d.changedSymbols).toEqual([".#f"]);
    expect(isBreaking(d)).toBe(false);
  });
  it("flags removed subpath as breaking, added as not", () => {
    const { ["./x"]: _x, ...rest } = E as Record<string, unknown>;
    const d = diffSurface(base, pkg(v1, rest));
    expect(d.removedSubpaths).toEqual(["./x"]);
    expect(isBreaking(d)).toBe(true);
    expect(isBreaking(diffSurface(pkg(v1, rest), base))).toBe(false);
  });
});

describe("changeset rule", () => {
  const md = (b: string) => `---\n"@jini-ai/core": ${b}\n'@jini-ai/db': patch\n---\n\nnote`;
  it("parses frontmatter", () => expect(parseChangesetBumps(md("minor"))).toEqual({ "@jini-ai/core": "minor", "@jini-ai/db": "patch" }));
  it("requires major/minor for the same package", () => {
    expect(coveredByChangeset("@jini-ai/core", [md("patch")])).toBe(false);
    expect(coveredByChangeset("@jini-ai/core", [md("minor")])).toBe(true);
    expect(coveredByChangeset("@jini-ai/db", [md("major")])).toBe(false);
    expect(coveredByChangeset("@jini-ai/core", [])).toBe(false);
  });
  it("helpers", () => {
    expect(pickTarget({ import: { types: "a.d.ts", default: "a.js" } }, true)).toBe("a.d.ts");
    expect(pickTarget({ import: { types: "a.d.ts", default: "a.js" } }, false)).toBe("a.js");
    expect(baselineFileName("@jini-ai/core")).toBe("jini-ai__core.json");
  });
});
