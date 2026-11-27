import { expect, it, vi } from "vitest";
import { createRepoSecretCheck, scanRepoForSecrets, scanGitHistoryForSecrets } from "../repo-secret-scan.node.js";

it("scans synthetic tracked/history bytes with the same findings and redaction", () => {
  const secret = "ghp_" + "A".repeat(36);
  let text = "safe";
  const policy = { selectPath: () => true, maxScanBytes: 1024, isAllowlisted: () => false };
  const runner: Parameters<typeof scanRepoForSecrets>[0]["runner"] = (args) => {
    if (args[0] === "ls-files") return "file.txt\0";
    if (args[0] === "log") return "file.txt\0";
    if (args[0] === "rev-list") return "sha file.txt\n";
    return args[1] === "--batch" ? `sha blob ${text.length}\n${text}\n` : "sha blob\n";
  };
  const required = { repoRoot: "/synthetic", runner, policy, fs: { statSync: () => ({ size: text.length, isFile: () => true }), readFileSync: () => Buffer.from(text) } };
  expect(scanRepoForSecrets(required)).toEqual([]);
  expect(scanGitHistoryForSecrets(required)).toEqual([]);
  text = `first\n${secret}`;
  const tracked = scanRepoForSecrets(required);
  expect(tracked).toEqual([{ file: "file.txt", patternName: "GitHub personal access token (classic, ghp_)", line: 2 }]);
  expect(scanGitHistoryForSecrets(required)).toEqual(tracked);
  expect(JSON.stringify(tracked)).not.toContain(secret);
});

it("reports a clean repository when a tracked file disappeared from the working tree", () => {
  const repoRoot = "/synthetic";
  const runner: Parameters<typeof scanRepoForSecrets>[0]["runner"] = (args, options) => {
    expect(options.cwd).toBe(repoRoot);
    expect(options.encoding).toBe("utf8");
    if (args[0] === "ls-files") {
      expect(args).toEqual(["ls-files", "-z"]);
      return "gone.txt\0safe.txt\0";
    }
    if (args[0] === "log") return "";
    if (args[0] === "rev-list") {
      expect(args).toEqual(["rev-list", "--objects", "--all"]);
      return "";
    }
    throw new Error(`Unexpected Git request: ${args.join(" ")}`);
  };
  const readFileSync = vi.fn((file: string) => {
    if (file !== "/synthetic/safe.txt") throw new Error(`Unexpected read: ${file}`);
    return Buffer.from("no credentials");
  });
  const stdout = vi.fn(), stderr = vi.fn();
  const check = createRepoSecretCheck({ repoRoot, runner, fs: {
    statSync: file => {
      if (file === "/synthetic/gone.txt") throw Object.assign(new Error("missing"), { code: "ENOENT" });
      if (file !== "/synthetic/safe.txt") throw new Error(`Unexpected stat: ${file}`);
      return { size: 14, isFile: () => true };
    },
    readFileSync,
  }, skipExtensions: new Set(), maxScanBytes: 100, exemptions: [], stdout, stderr,
  copy: { clean: "No secrets found", tip: n => `Tip: ${n}`, history: n => `History: ${n}`, guidance: "Rotate credentials" } });
  expect(check.run({})).toBe(0);
  expect(stdout.mock.calls).toEqual([["No secrets found"]]);
  expect(stderr.mock.calls).toEqual([]);
  expect(readFileSync.mock.calls).toEqual([["/synthetic/safe.txt"]]);
});
