import ts from "typescript";
import { expect, it, vi } from "vitest";
import { findSealCallsWithoutAad } from "../seal-aad-invariant.node.js";

it("walks synthetic production TypeScript files and reports only missing AAD", () => {
  const readFileSync = vi.fn((file: string) => file.endsWith("bad.ts") ? "vault.seal({plaintext: 'synthetic', key});" : "vault.seal({plaintext: 'synthetic', key, aad});");
  const fs = { readFileSync, readdirSync: vi.fn(() => ["good.ts", "bad.ts", "ignored.test.ts"].map(name => ({ name, isDirectory: () => false }))) };
  const rows = findSealCallsWithoutAad({ repoRoot: "/repo", scanRoot: "/repo/src", fs, ast: ts, isExempt: () => false });
  expect(rows).toEqual([{ file: "src/bad.ts", line: 1, text: "vault.seal({plaintext: 'synthetic', key})", reason: "missing-aad" }]);
  expect(readFileSync.mock.calls.map(([file]) => file)).toEqual(["/repo/src/good.ts", "/repo/src/bad.ts"]);
});

it("descends into source folders, skips node_modules and dist, and ignores non-TypeScript files", () => {
  const tree: Record<string, readonly { name: string; dir: boolean }[]> = {
    "/repo/src": [{ name: "nested", dir: true }, { name: "node_modules", dir: true }, { name: "dist", dir: true }, { name: "notes.md", dir: false }, { name: "view.tsx", dir: false }],
    "/repo/src/nested": [{ name: "deep.ts", dir: false }, { name: "deep.spec.ts", dir: false }],
  };
  const readdirSync = vi.fn((dir: string) => (tree[dir] ?? []).map(({ name, dir: isDir }) => ({ name, isDirectory: () => isDir })));
  const readFileSync = vi.fn((file: string) => file.endsWith("deep.ts") ? "box.seal({plaintext: 'synthetic'});" : "const view = 1;");
  const rows = findSealCallsWithoutAad({ repoRoot: "/repo", scanRoot: "/repo/src", fs: { readdirSync, readFileSync }, ast: ts, isExempt: () => false });
  expect(rows).toEqual([{ file: "src/nested/deep.ts", line: 1, text: "box.seal({plaintext: 'synthetic'})", reason: "missing-aad" }]);
  expect(readdirSync.mock.calls.map(([dir]) => dir)).toEqual(["/repo/src", "/repo/src/nested"]);
  expect(readFileSync.mock.calls.map(([file]) => file)).toEqual(["/repo/src/nested/deep.ts", "/repo/src/view.tsx"]);
});
