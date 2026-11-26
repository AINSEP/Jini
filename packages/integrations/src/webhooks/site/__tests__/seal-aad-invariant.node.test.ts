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
