import { expect, it, vi } from "vitest";
import { atomicCreateSiteKeyFile, installSiteKey } from "../files.js";

it("returns the exclusive-create race winner bytes after cleaning the losing temporary file", () => {
  const calls: string[] = [];
  const fs = { mkdirSync: vi.fn(), openSync: () => 1, writeSync: vi.fn(), fsyncSync: vi.fn(), closeSync: vi.fn(), chmodSync: vi.fn(),
    linkSync: () => { calls.push("link"); throw Object.assign(new Error("exists"), { code: "EEXIST" }); },
    unlinkSync: () => { calls.push("unlink-temp"); }, readFileSync: () => { calls.push("read-winner"); return "  winner\n"; } } as unknown as Parameters<typeof atomicCreateSiteKeyFile>[0]["fs"];
  expect(atomicCreateSiteKeyFile({ filePath: "/keys/site.hex", hex: "loser", fs, pid: 123, randomHex: () => "random", directoryMode: 0o700, fileMode: 0o600 })).toBe("winner");
  expect(calls).toEqual(["link", "unlink-temp", "read-winner"]);
});


it("does not stamp a requested key when the exclusive-create race winner differs", () => {
  const stampFingerprint = vi.fn();
  const error = new Error("race winner differs");
  expect(() => installSiteKey({ siteDir: "/site", hex: "aa".repeat(32), resolveInstallSources: () => ({ env: {}, sources: [{ kind: "per-site-file", path: "/key" }] }),
    readSiteKeySourceMaterial: () => undefined, moveSiteKeyFileAside: vi.fn(), atomicCreateSiteKeyFile: () => "bb".repeat(32), stampFingerprint,
    invalidKeyError: () => new Error("invalid"), noFileError: () => new Error("no target"), concurrentWriteError: () => error,
  })).toThrow(error);
  expect(stampFingerprint).not.toHaveBeenCalled();
});
