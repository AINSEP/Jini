import { describe, expect, it } from "vitest";
import ts from "typescript";
import { createNonSecretSealCallPredicate, runSealAadCheck } from "../seal-aad-invariant.node.js";

describe("configured seal AAD check", () => {
  it("matches both the exact path and call text", () => {
    const isExempt = createNonSecretSealCallPredicate({ exemptions: { "source.ts": "port.seal({ id })" } });
    expect(isExempt({ displayPath: "source.ts", text: "port.seal({ id })" })).toBe(true);
    expect(isExempt({ displayPath: "other.ts", text: "port.seal({ id })" })).toBe(false);
    expect(isExempt({ displayPath: "source.ts", text: "port.seal({ secret })" })).toBe(false);
  });

  it("returns the CLI status and reports a synthetic finding", () => {
    const output: string[] = [];
    const input = {
      repoRoot: "/repo", scanRoot: "/repo/src", ast: ts,
      fs: { readdirSync: () => [{ name: "source.ts", isDirectory: () => false }], readFileSync: () => "port.seal({ secret });" },
      exemptions: {}, stdout: (text: string) => output.push(text), stderr: (text: string) => output.push(text),
      copy: { clean: "clean", findings: (count: number) => `findings ${count}`, guidance: "supply aad" },
    };
    expect(runSealAadCheck(input)).toBe(1);
    expect(output).toEqual(["findings 1", "  - src/source.ts:1 [missing-aad] port.seal({ secret })", "supply aad"]);
    output.length = 0;
    expect(runSealAadCheck({ ...input, fs: { ...input.fs, readFileSync: () => "port.seal({ secret, aad });" } })).toBe(0);
    expect(output).toEqual(["clean"]);
  });
});
