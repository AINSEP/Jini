import { describe, expect, it } from "vitest";
import { createRepoSecretCheck } from "../repo-secret-scan.node.js";

describe("configured repository secret check", () => {
  it("matches every field of an exemption tuple", () => {
    const check = createRepoSecretCheck({ repoRoot: "/repo", runner: () => "", fs: { statSync: () => ({ size: 0, isFile: () => true }), readFileSync: () => Buffer.alloc(0) }, skipExtensions: new Set(), maxScanBytes: 1024,
      exemptions: [{ file: "fixture.ts", patternName: "pattern", value: "value" }], stdout: () => {}, stderr: () => {},
      copy: { clean: "clean", tip: String, history: String, guidance: "guidance" } });
    expect(check.isAllowlisted({ file: "fixture.ts", patternName: "pattern", value: "value" })).toBe(true);
    expect(check.isAllowlisted({ file: "other.ts", patternName: "pattern", value: "value" })).toBe(false);
    expect(check.isAllowlisted({ file: "fixture.ts", patternName: "other", value: "value" })).toBe(false);
    expect(check.isAllowlisted({ file: "fixture.ts", patternName: "pattern", value: "other" })).toBe(false);
  });

  it.each([false, true])("scans history after a %s dirty tip and never prints the matched value", (dirty) => {
    const secret = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
    const calls: string[] = [];
    const output: string[] = [];
    const check = createRepoSecretCheck({ repoRoot: "/repo",
      runner: (args) => {
        calls.push(args[0]!);
        if (args[0] === "ls-files") return dirty ? "fixture.ts\0" : "";
        if (args[0] === "log") return "fixture.ts\0";
        if (args[0] === "rev-list") return "abc fixture.ts\n";
        if (args[1] === "--batch-check=%(objectname) %(objecttype)") return "abc blob\n";
        return `abc blob ${secret.length}\n${secret}\n`;
      },
      fs: { statSync: () => ({ size: secret.length, isFile: () => true }), readFileSync: () => Buffer.from(secret) },
      skipExtensions: new Set(), maxScanBytes: 1024, exemptions: [],
      stdout: (text) => output.push(text), stderr: (text) => output.push(text),
      copy: { clean: "clean", tip: (count) => `tip ${count}`, history: (count) => `history ${count}`, guidance: "guidance" },
    });
    expect(check.run({})).toBe(1);
    expect(calls).toEqual(["ls-files", "log", "rev-list", "cat-file", "cat-file"]);
    expect(output).toContain("history 1");
    expect(output.some(text => text.startsWith("tip "))).toBe(dirty);
    expect(output.join("\n")).not.toContain(secret);
    expect(output.at(-1)).toBe("guidance");
  });
});
