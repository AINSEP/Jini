import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createExclusiveSiteKeyGenerator, createOrderedSiteKeyring, isNoSiteKeyError } from "../ordered-keyring.js";
import { UnusableSiteKeyError } from "../../index.js";
import { inspectSiteKeyMaterial } from "../material.js";

const HOST_SALT = ["to", "vu", "-integrations-root-key-hkdf-v1"].join("");

describe("live ordered keyring", () => {
  it("matches the frozen signing fixture and rereads an on-disk change", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ordered-keyring-"));
    const file = join(dir, "key.hex");
    try {
      writeFileSync(file, "aa".repeat(32));
      const keyring = createOrderedSiteKeyring({ sources: [{ kind: "per-site-file", path: file }], keyId: "v1", hkdfSalt: HOST_SALT, env: () => ({}),
        readSourceMaterial: ({ source }) => ({ raw: readFileSync(source.path!, "utf8") }), describeSource: source => source.path!,
        unusableSiteKeyError: ({ source, rejection }) => new UnusableSiteKeyError({ source: source.kind === "env" ? "env" : "file", reason: rejection.reason, message: "invalid key" }) });
      const input = { workspaceId: "ws-1", subscriptionId: "sub-1", version: 1 };
      expect(Buffer.from(await keyring.deriveSigningSecret(input)).toString("hex")).toBe("8f60aeee05219cf2d5d3f6126a4118c165d5be0d584e0701777ee1abf17ab88d");
      writeFileSync(file, "bb".repeat(32));
      expect(Buffer.from(await keyring.deriveSigningSecret(input)).toString("hex")).not.toBe("8f60aeee05219cf2d5d3f6126a4118c165d5be0d584e0701777ee1abf17ab88d");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses an invalid first source without opening the valid second source", async () => {
    const reads: string[] = [];
    const required = { sources: [{ kind: "per-site-file", path: "/bad" }, { kind: "volume-file", path: "/good" }], keyId: "v1", hkdfSalt: HOST_SALT, env: () => ({}),
      readSourceMaterial: ({ source }: { source: { kind: string; path?: string } }) => { reads.push(source.path!); return { raw: source.path === "/bad" ? "private-invalid-material" : "aa".repeat(32) }; },
      describeSource: (source: { path?: string }) => source.path!,
      unusableSiteKeyError: ({ source, rejection }: { source: { kind: string }; rejection: { reason: "empty" | "not-hex" | "odd-length" | "too-short" } }) => new UnusableSiteKeyError({ source: source.kind === "env" ? "env" : "file", reason: rejection.reason, message: "invalid key" }),
    };
    await expect(createOrderedSiteKeyring(required).derive({ workspaceId: "ws", purpose: "sealer", info: "v1" })).rejects.toMatchObject({ source: "file", reason: "not-hex", message: "invalid key" });
    expect(reads).toEqual(["/bad"]);
    const status = inspectSiteKeyMaterial({ sources: required.sources, env: required.env, readSiteKeySourceMaterial: required.readSourceMaterial, siteKeyFilePathFrom: () => "/bad" });
    expect(JSON.stringify(status)).not.toContain("private-invalid-material");
    expect(status).toEqual({ active: false, source: "file", invalid: true, reason: "not-hex", keyFilePath: "/bad" });
  });
});

it('keeps active-key lookup free of source reads', async () => {
  let reads = 0;
  const keyring = createOrderedSiteKeyring({ sources: [{ kind: 'env' }], keyId: 'id', hkdfSalt: 'salt', env: () => ({}),
    readSourceMaterial: () => { reads++; return { raw: 'invalid' }; }, describeSource: source => source.kind,
    unusableSiteKeyError: () => new Error('invalid'),
  });
  expect(await keyring.activeKey()).toEqual({ keyId: 'id' }); expect(reads).toBe(0);
});

it('distinguishes a keyring with no material from unrelated failures', async () => {
  const file = { kind: 'per-site-file', path: '/keys/absent' };
  const env = { kind: 'env' };
  const readSourceMaterial = vi.fn(() => undefined);
  const keyring = createOrderedSiteKeyring({ sources: [file, env], keyId: 'id', hkdfSalt: 'salt', env: () => ({}),
    readSourceMaterial, describeSource: source => source.path ?? 'HOST_KEY',
    unusableSiteKeyError: () => new Error('Unexpected invalid key'),
  });
  const missing = keyring.derive({ workspaceId: 'ws', purpose: 'sealer', info: 'record' });
  await expect(missing).rejects.toThrow('no site key: none of the configured sources resolved (/keys/absent, HOST_KEY)');
  expect(isNoSiteKeyError({ error: await missing.catch((error: unknown) => error) })).toBe(true);
  expect(readSourceMaterial.mock.calls).toEqual([[{ source: file, env: {} }], [{ source: env, env: {} }]]);
  expect(isNoSiteKeyError({ error: new Error('no site key') })).toBe(true);
  expect(isNoSiteKeyError({ error: 'no site key' })).toBe(false);
  expect(isNoSiteKeyError({ error: new Error('no site key: bad permissions') })).toBe(false);
});

it('creates a 32-byte key once without replacing the existing bytes on a second generation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exclusive-keyring-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const keyFilePath = join(dir, 'keys', 'site.hex');
  const alreadyExistsError = vi.fn(({ keyFilePath }: { keyFilePath: string }) => new Error(`Key is already saved at ${keyFilePath}`));
  const randomBytes = vi.fn((size: number) => Buffer.alloc(size, 0x42));
  const generate = createExclusiveSiteKeyGenerator({ fs, randomBytes, alreadyExistsError, fileMode: 0o600, directoryMode: 0o700 });
  const hex = '42'.repeat(32);
  expect(generate({ keyFilePath })).toEqual({ hex, fingerprint: '425ed4e4a36b', keyFilePath });
  expect(randomBytes.mock.calls).toEqual([[32]]);
  expect(readFileSync(keyFilePath, 'utf8')).toBe(hex);
  randomBytes.mockImplementationOnce(size => Buffer.alloc(size, 0x37));
  expect(() => generate({ keyFilePath })).toThrow(`Key is already saved at ${keyFilePath}`);
  expect(alreadyExistsError.mock.calls).toEqual([[{ keyFilePath }]]);
  expect(readFileSync(keyFilePath, 'utf8')).toBe(hex);
});

it('normalizes an exclusive-create symlink collision but propagates ordinary I/O errors', () => {
  const alreadyExists = new Error('Key destination is occupied');
  const ioError = Object.assign(new Error('disk error'), { code: 'EIO' });
  const writeFileSync = vi.fn<typeof fs.writeFileSync>(() => { throw Object.assign(new Error('link loop'), { code: 'ELOOP' }); });
  const generate = createExclusiveSiteKeyGenerator({ fs: { mkdirSync: fs.mkdirSync, writeFileSync }, randomBytes: size => Buffer.alloc(size),
    alreadyExistsError: () => alreadyExists, fileMode: 0o600, directoryMode: 0o700 });
  const dir = mkdtempSync(join(tmpdir(), 'exclusive-keyring-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const keyFilePath = join(dir, 'site.hex');
  expect(() => generate({ keyFilePath })).toThrow(alreadyExists);
  expect(writeFileSync.mock.calls).toEqual([[keyFilePath, '00'.repeat(32), { mode: 0o600, flag: 'wx' }]]);
  writeFileSync.mockImplementationOnce(() => { throw ioError; });
  expect(() => generate({ keyFilePath })).toThrow(ioError);
});
