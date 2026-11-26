import { expect, it } from "vitest";
import { scanRepoForSecrets, scanGitHistoryForSecrets } from "../repo-secret-scan.node.js";

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
