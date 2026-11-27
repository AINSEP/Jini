import * as fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSiteKeyEnsurer } from "../ensure.js";
import { createSiteKeySources } from "../sources.js";
import { fingerprintSiteKeyHex } from "../../index.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "site-key-ensure-"));
  const reads = createSiteKeySources({ envName: "HOST_KEY", metadataFilename: ".meta.json", fields: { siteId: "id", siteKeyId: "keyId", fingerprint: "fingerprint" },
    localSegments: ["keys"], sharedSegments: ["legacy.hex"], volumeSegments: ["volume.hex"], legacyVolumeSegments: ["old.hex"], assertHomeIsolation: () => {}, fs });
  const randomBytes = vi.fn(() => Buffer.from("aa".repeat(32), "hex"));
  const randomUUID = vi.fn(() => "candidate");
  const findSiteKeyDependentData = vi.fn(async () => false);
  const buildSiteMetaForNewKey = vi.fn(async () => ({ keyId: "candidate", schema: "complete" }));
  const logBootError = vi.fn();
  const required: Parameters<typeof createSiteKeyEnsurer>[0] = {
    ...reads, fs, env: () => ({}), resolveRuntimeMode: () => "local", home: () => dir, cwd: () => dir,
    findSiteKeyDependentData, randomBytes, randomUUID, buildSiteMetaForNewKey,
    metadataFilename: ".meta.json", fields: { siteKeyId: "keyId", fingerprint: "fingerprint" },
    writeJsonFileAtomic: ({ filePath, data }) => writeFileSync(filePath, JSON.stringify(data)), logBootError,
    nowIso: () => "2026-11-25T00:00:00.000Z", pid: 1, directoryMode: 0o700, fileMode: 0o600,
  };
  return { dir, required, randomBytes, randomUUID, findSiteKeyDependentData, buildSiteMetaForNewKey, logBootError };
}

describe("site key ensure binding", () => {
  it("never mints a production key or metadata and installs recovery only in the writable volume", async () => {
    const f = fixture();
    try {
      const ensure = createSiteKeyEnsurer(f.required);
      expect(await ensure.ensureSiteKey({ siteDir: f.dir, siteKeyId: "id", mode: "production" })).toEqual({ action: "production-noop" });
      expect(await ensure.ensureSiteKeyForBoot({ siteDir: f.dir, mode: "production" })).toBeUndefined();
      expect(f.randomBytes).not.toHaveBeenCalled();
      expect(f.randomUUID).not.toHaveBeenCalled();
      expect(f.buildSiteMetaForNewKey).not.toHaveBeenCalled();
      const hex = "bb".repeat(32);
      expect(ensure.installSiteKey({ siteDir: f.dir, mode: "production", hex })).toEqual({ outcome: "installed", keyFilePath: join(f.dir, "volume.hex"), fingerprint: fingerprintSiteKeyHex({ hex }) });
      expect(readFileSync(join(f.dir, "volume.hex"), "utf8")).toBe(hex);
      expect(fs.existsSync(join(f.dir, ".meta.json"))).toBe(false);
      expect(fs.existsSync(join(f.dir, "old.hex"))).toBe(false);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  it("rereads the metadata race winner and the exclusive key-file race winner", async () => {
    const f = fixture();
    try {
      const winner = "bb".repeat(32);
      const writeFileSyncOnRace: typeof fs.writeFileSync = (file, data, options) => {
        if (file === join(f.dir, ".meta.json")) {
          writeFileSync(file, JSON.stringify({ keyId: "winner", keep: true }), options);
          throw Object.assign(new Error("exists"), { code: "EEXIST" });
        }
        writeFileSync(file, data, options);
      };
      const linkSyncOnRace: typeof fs.linkSync = (_from, to) => {
        writeFileSync(to, winner);
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      };
      const ensure = createSiteKeyEnsurer({ ...f.required, fs: { ...fs, writeFileSync: writeFileSyncOnRace, linkSync: linkSyncOnRace } });
      expect(await ensure.ensureSiteKeyForSite({ siteDir: f.dir })).toEqual({ action: "mint", perSiteFilePath: join(f.dir, "keys", "winner.hex"), fingerprint: fingerprintSiteKeyHex({ hex: winner }) });
      expect(JSON.parse(readFileSync(join(f.dir, ".meta.json"), "utf8"))).toEqual({ keyId: "winner", keep: true, fingerprint: fingerprintSiteKeyHex({ hex: winner }) });
      expect(fs.existsSync(join(f.dir, "keys", "candidate.hex"))).toBe(false);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  it("preserves malformed existing metadata without repairing or minting a key", async () => {
    const f = fixture();
    try {
      writeFileSync(join(f.dir, ".meta.json"), "{broken");
      const ensure = createSiteKeyEnsurer(f.required);
      expect(await ensure.ensureSiteKeyForSite({ siteDir: f.dir })).toBeUndefined();
      expect(ensure.installSiteKey({ siteDir: f.dir, hex: "aa".repeat(32) })).toBeUndefined();
      expect(readFileSync(join(f.dir, ".meta.json"), "utf8")).toBe("{broken");
      expect(f.randomBytes).not.toHaveBeenCalled();
      expect(fs.existsSync(join(f.dir, "keys"))).toBe(false);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  it("refuses a fresh key when absent metadata accompanies dependent data", async () => {
    const f = fixture();
    try {
      f.findSiteKeyDependentData.mockResolvedValue(true);
      const ensure = createSiteKeyEnsurer(f.required);
      expect(await ensure.ensureSiteKeyForBoot({ siteDir: f.dir })).toEqual({ action: "refuse", perSiteFilePath: join(f.dir, "keys", "candidate.hex") });
      expect(f.findSiteKeyDependentData).toHaveBeenCalledWith({ siteDir: f.dir });
      expect(f.randomBytes).not.toHaveBeenCalled();
      expect(fs.existsSync(join(f.dir, "keys"))).toBe(false);
      expect(JSON.parse(readFileSync(join(f.dir, ".meta.json"), "utf8"))).toEqual({ keyId: "candidate", schema: "complete" });
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });
});

it("logs a boot-time failure once while the direct writer surfaces it", async () => {
  const f = fixture();
  const error = Object.assign(new Error("metadata directory is read-only"), { code: "EACCES" });
  try {
    const writeFileSync: typeof fs.writeFileSync = () => { throw error; };
    const ensure = createSiteKeyEnsurer({ ...f.required, fs: { ...fs, writeFileSync } });
    await expect(ensure.ensureSiteKeyForBoot({ siteDir: f.dir })).resolves.toBeUndefined();
    expect(f.logBootError.mock.calls).toEqual([[{ siteDir: f.dir, error }]]);
    await expect(ensure.ensureSiteKeyForSite({ siteDir: f.dir })).rejects.toBe(error);
    expect(fs.readdirSync(f.dir)).toEqual([]);
    expect(f.randomBytes).not.toHaveBeenCalled();
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

it("refuses an unsafe local key id before reading other sources or creating files", async () => {
  const f = fixture();
  try {
    const ensure = createSiteKeyEnsurer(f.required);
    await expect(ensure.ensureSiteKey({ siteDir: f.dir, siteKeyId: "../out" })).rejects
      .toThrow("ensureSiteKey: siteKeySources did not return a per-site-file candidate for a given siteKeyId");
    expect(fs.readdirSync(f.dir)).toEqual([]);
    expect(f.randomBytes).not.toHaveBeenCalled();
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

it("backs up a different installed key and stamps only the requested fingerprint while preserving metadata", () => {
  const f = fixture();
  try {
    const metaPath = join(f.dir, ".meta.json");
    const keyPath = join(f.dir, "keys", "current.hex");
    const previous = "11".repeat(32);
    const replacement = "bb".repeat(32);
    writeFileSync(metaPath, JSON.stringify({ keyId: "current", untouched: "keep", fingerprint: "old" }));
    fs.mkdirSync(join(f.dir, "keys"));
    writeFileSync(keyPath, previous);
    const randomBytes = vi.fn((size: number) => Buffer.alloc(size, 0xab));
    const ensure = createSiteKeyEnsurer({ ...f.required, randomBytes });
    const fingerprint = "4ca14526b275";
    expect(ensure.installSiteKey({ siteDir: f.dir, hex: replacement })).toEqual({ outcome: "installed", keyFilePath: keyPath, fingerprint });
    expect(readFileSync(keyPath, "utf8")).toBe(replacement);
    expect(readFileSync(keyPath + ".wrong-2026-11-25T00-00-00-000Z-abab", "utf8")).toBe(previous);
    expect(JSON.parse(readFileSync(metaPath, "utf8"))).toEqual({ keyId: "current", untouched: "keep", fingerprint });
    expect(randomBytes.mock.calls).toEqual([[2], [4]]);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
