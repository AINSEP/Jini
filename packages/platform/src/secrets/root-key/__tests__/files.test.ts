import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { atomicCreateSiteKeyFile, installSiteKey, moveSiteKeyFileAside, type InstallSiteKeyInput } from "../files.js";

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

function scratch() {
  const dir = fs.mkdtempSync(join(tmpdir(), 'site-key-files-'));
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

it('moves only a key whose bytes still match the reviewed bytes and applies the requested mode', () => {
  const dir = scratch();
  const filePath = join(dir, 'key.hex');
  const chmodSync = vi.fn<typeof fs.chmodSync>((path, mode) => fs.chmodSync(path, mode));
  const randomHex = vi.fn(() => 'd061');
  const input = { filePath, fs: { ...fs, chmodSync }, expectedContent: 'reviewed', nowIso: () => '2026-04-08T13:14:15.987Z', randomHex, fileMode: 0o600 };
  expect(moveSiteKeyFileAside(input)).toBeUndefined();
  fs.writeFileSync(filePath, 'different');
  expect(moveSiteKeyFileAside(input)).toBeUndefined();
  expect(fs.readFileSync(filePath, 'utf8')).toBe('different');
  expect(fs.readdirSync(dir)).toEqual(['key.hex']);
  expect(randomHex.mock.calls).toEqual([]);
  fs.writeFileSync(filePath, 'reviewed');
  const backup = filePath + '.wrong-2026-04-08T13-14-15-987Z-d061';
  expect(moveSiteKeyFileAside(input)).toBe(backup);
  expect(fs.existsSync(filePath)).toBe(false);
  expect(fs.readFileSync(backup, 'utf8')).toBe('reviewed');
  expect(chmodSync.mock.calls).toEqual([[backup, 0o600]]);
  expect(randomHex).toHaveBeenCalledExactlyOnceWith({ bytes: 2 });
});

it.each([
  { operation: 'read', code: 'EACCES' }, { operation: 'rename', code: 'EIO' }, { operation: 'rename', code: 'ENOENT' },
])('handles only disappearance as a benign $operation failure ($code)', ({ operation, code }) => {
  const dir = scratch();
  const filePath = join(dir, 'key.hex');
  fs.writeFileSync(filePath, 'reviewed');
  const failure = Object.assign(new Error('key unavailable'), { code });
  const chmodSync = vi.fn<typeof fs.chmodSync>();
  const renameSync: typeof fs.renameSync = () => {
    if (code === 'ENOENT') fs.unlinkSync(filePath);
    throw failure;
  };
  const faulting = { ...(operation === 'read' ? { ...fs, readFileSync: () => { throw failure; } } : { ...fs, renameSync }), chmodSync };
  const attempt = () => moveSiteKeyFileAside({ filePath, expectedContent: 'reviewed', fs: faulting, fileMode: 0o600,
    nowIso: () => '2026-04-08T00:00:00.000Z', randomHex: () => 'd061' });
  if (code === 'ENOENT') {
    expect(attempt()).toBeUndefined();
    expect(fs.readdirSync(dir)).toEqual([]);
  } else {
    expect(attempt).toThrow(failure);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('reviewed');
    expect(fs.readdirSync(dir)).toEqual(['key.hex']);
  }
  expect(chmodSync.mock.calls).toEqual([]);
});

it('returns the matching higher-priority env source without touching lower files and refuses a different env key', () => {
  const stampFingerprint = vi.fn();
  const create = vi.fn(() => { throw new Error('Must not write a key file'); });
  const source = { kind: 'env' };
  const env = { HOST_KEY: 'aa'.repeat(32) };
  const read = vi.fn<InstallSiteKeyInput['readSiteKeySourceMaterial']>(({ env }) => ({ raw: env.HOST_KEY!, envVarName: 'HOST_KEY' }));
  const input: InstallSiteKeyInput = { siteDir: '/site', hex: 'aa'.repeat(32), resolveInstallSources: () => ({ env, sources: [source, { kind: 'volume-file', path: '/key' }] }),
    readSiteKeySourceMaterial: read, moveSiteKeyFileAside: () => { throw new Error('Must not move a key'); },
    atomicCreateSiteKeyFile: create, stampFingerprint, invalidKeyError: () => new Error('invalid'), noFileError: () => new Error('no target'),
    concurrentWriteError: () => new Error('wrong race winner') };
  expect(installSiteKey({ ...input, hex: 'bb'.repeat(32) })).toEqual({ outcome: 'env-key-set' });
  expect(stampFingerprint.mock.calls).toEqual([]);
  expect(installSiteKey(input)).toEqual({ outcome: 'installed', keyFilePath: 'env:HOST_KEY', fingerprint: 'e0e77a507412' });
  expect(stampFingerprint.mock.calls).toEqual([[{ siteDir: '/site', fingerprint: 'e0e77a507412' }]]);
  expect(read.mock.calls).toEqual([[{ env, source }], [{ env, source }]]);
  expect(create.mock.calls).toEqual([]);
});

it('fails with the host error when no writable key source exists', () => {
  const missing = new Error('No site key destination');
  const stampFingerprint = vi.fn();
  expect(() => installSiteKey({ siteDir: '/site', hex: 'aa'.repeat(32),
    resolveInstallSources: () => ({ env: {}, sources: [{ kind: 'env' }, { kind: 'volume-file' }] }),
    readSiteKeySourceMaterial: () => undefined,
    moveSiteKeyFileAside: () => { throw new Error('Unexpected backup'); },
    atomicCreateSiteKeyFile: () => { throw new Error('Unexpected write'); },
    stampFingerprint, invalidKeyError: () => new Error('Invalid key'), noFileError: () => missing,
    concurrentWriteError: () => new Error('Unexpected race'),
  })).toThrow(missing);
  expect(stampFingerprint.mock.calls).toEqual([]);
});

it('removes candidate bytes if preparing the temporary key permissions fails', () => {
  const dir = scratch();
  const filePath = join(dir, 'key.hex');
  const failure = Object.assign(new Error('Cannot set key permissions'), { code: 'EPERM' });
  expect(() => atomicCreateSiteKeyFile({ filePath, hex: 'aa'.repeat(32),
    fs: { ...fs, chmodSync: () => { throw failure; } },
    pid: 123, randomHex: () => 'd0618200', directoryMode: 0o700, fileMode: 0o600 })).toThrow(failure);
  expect(fs.readdirSync(dir)).toEqual([]);
});
