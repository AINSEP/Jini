import { expect, it, vi } from "vitest";
import { scanTrackedRepo, scanRepoHistory } from "../repo-secret-scan.js";

const secret = "ghp_" + "A".repeat(36);
const other = "ghp_" + "B".repeat(36);
const policy = { selectPath: ({ file }: { file: string }) => !file.endsWith(".png"), maxScanBytes: 1024,
  isAllowlisted: (_hit: { file: string; patternName: string; value: string }) => false };

it("a credential-shaped path is reported redacted even when its content is skipped", () => {
  const file = `images/${secret}.png`;
  const readTracked = vi.fn();
  const tip = scanTrackedRepo({ ports: { trackedPaths: () => [file], readTracked }, policy });
  expect(tip).toHaveLength(1);
  expect(tip[0]).toMatchObject({ file: "images/[redacted].png", line: "path" });
  expect(readTracked).not.toHaveBeenCalled();
  const history = scanRepoHistory({ ports: { historicalPaths: () => [file], historicalBlobs: () => [{ sha: "blob", path: "same.png" }], readBlobContents: () => new Map() }, policy });
  expect(history).toEqual(tip);
  expect(JSON.stringify([tip, history])).not.toContain(secret);
});

it("tip and history never return matched bytes in text or binary findings", () => {
  for (const isBinary of [false, true]) {
    const text = `${isBinary ? String.fromCharCode(0) : "first\n"}${secret}`;
    const tip = scanTrackedRepo({ ports: { trackedPaths: () => ["one.txt"], readTracked: () => ({ text, isBinary }) }, policy });
    const history = scanRepoHistory({ ports: { historicalPaths: () => ["one.txt"], historicalBlobs: () => [{ sha: "blob", path: "one.txt" }], readBlobContents: () => new Map([["blob", text]]) }, policy });
    expect(tip).toHaveLength(1); expect(history).toEqual(tip);
    expect(tip[0]?.line).toBe(isBinary ? "binary" : 2);
    expect(JSON.stringify([tip, history])).not.toContain(secret);
    expect(Object.keys(tip[0] ?? {}).sort()).toEqual(["file", "line", "patternName"]);
  }
});

it("the exact exception does not suppress a different result or another path", () => {
  const exact = { ...policy, isAllowlisted: ({ file, value }: { file: string; patternName: string; value: string }) => file === "allowed.txt" && value === secret };
  const paths = ["allowed.txt", "elsewhere.txt"];
  const tip = scanTrackedRepo({ ports: { trackedPaths: () => paths, readTracked: () => ({ text: `${secret}\n${other}`, isBinary: false }) }, policy: exact });
  const history = scanRepoHistory({ ports: { historicalPaths: () => paths, historicalBlobs: () => paths.map((path, i) => ({ sha: String(i), path })), readBlobContents: () => new Map([["0", `${secret}\n${other}`], ["1", `${secret}\n${other}`]]) }, policy: exact });
  expect(tip.map(row => [row.file, row.line])).toEqual([["allowed.txt", 2], ["elsewhere.txt", 1], ["elsewhere.txt", 2]]);
  expect(history).toEqual(tip);
  expect(JSON.stringify([tip, history])).not.toContain(secret);
  expect(JSON.stringify([tip, history])).not.toContain(other);
});
