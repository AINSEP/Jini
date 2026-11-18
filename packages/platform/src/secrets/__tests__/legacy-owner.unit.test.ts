import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { VaultError, type VaultContext } from "@jini-ai/core/contracts/vault";
import type { VaultArchiveEntry } from "../credential-sets/vault-archive.js";
import { InMemoryVaultRepo } from "../credential-sets/vault.repo.memory.js";
import { createVaultMetaParsers } from "../credential-sets/vault.meta.js";
import { SecretsVaultService } from "../credential-sets/vault.service.js";
import { EnvOrFileKeyring, generateFileRootKey } from "../keyring.env.js";
import { AesGcmSecretSealer } from "../secret-sealer.aesgcm.js";
import { openLegacyOwnerVault, OwnerStoreRecoveryError, ownerContext, readLegacyOwnerEntry } from "../legacy-owner.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function keyFile() {
  const directory = mkdtempSync(join(tmpdir(), "jini-legacy-owner-")); directories.push(directory);
  const keyFilePath = join(directory, "owner.key");
  generateFileRootKey({ keyFilePath });
  return keyFilePath;
}
const vendor = { kind: "vendor" as const, ownerKey: "plugin", binding: null, provider: "provider", label: "Shared API key",
  meta: { credentialType: "vendor", worksFor: ["provider"] }, payload: { token: "a-secret-value-that-must-not-escape" }, expectedRevision: null };
/** Writes rows the way the old store did, through a vault that authorizes everything, so a test can plant what the reader must refuse. */
async function plant({ repo, keyFilePath, row }: { repo: InMemoryVaultRepo; keyFilePath: string; row: Parameters<SecretsVaultService["put"]>[0] }) {
  const keyring = new EnvOrFileKeyring({ env: { read: () => undefined }, envVarName: "OWNER_STORE_KEY", keyFilePath,
    hkdfSalt: "jini-owner-store-v1", allowFileFallback: true, allowFileAutoGenerate: false });
  const writer = new SecretsVaultService({ repo, keyring, sealer: new AesGcmSecretSealer({ keyring }), metaParsers: createVaultMetaParsers({}),
    authorize: async () => {}, now: () => new Date().toISOString(), newId: () => randomUUID() });
  return writer.put(row);
}
const readableBy = (context: VaultContext, id: string) => ({ ...context, id });

test("legacy contexts preserve binding and feature ownership within the fixed owner workspace", () => {
  expect(ownerContext({ kind: "vendor", ownerKey: "feature", binding: "connection-1" })).toEqual({
    kind: "vendor", ownerKey: "feature", binding: "connection-1", workspaceId: "owner", principalId: null,
  });
});

test("the old entry shape and the vault archive entry are one type", () => {
  const entry: VaultArchiveEntry = { id: "a", kind: "vendor", ownerKey: "k", binding: null, provider: null, label: "l", isDefault: true, meta: {}, payload: null };
  expect(Object.keys(entry)).toHaveLength(9);
});

test("a stored row maps to the nine portable entry fields", async () => {
  const repo = new InMemoryVaultRepo({}), keyFilePath = keyFile();
  const saved = await plant({ repo, keyFilePath, row: { ...vendor, ...ownerContext(vendor) } });
  const vault = openLegacyOwnerVault({ repo, keyFilePath });
  expect(await readLegacyOwnerEntry({ vault, row: { id: saved.id, kind: "vendor", ownerKey: "plugin", binding: null } })).toEqual({
    id: saved.id, kind: "vendor", ownerKey: "plugin", binding: null, provider: "provider", label: "Shared API key", isDefault: true,
    meta: vendor.meta, payload: vendor.payload });
});

test("a failed decrypt is the fixed recovery error, never the underlying one", async () => {
  const vault = { get: async () => { throw new Error("secret key bytes 0xdeadbeef"); } } as unknown as SecretsVaultService;
  const failure = await readLegacyOwnerEntry({ vault, row: { id: "x", kind: "vendor", ownerKey: "plugin", binding: null } }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(OwnerStoreRecoveryError);
  expect(String((failure as Error).message)).not.toContain("deadbeef");
});

test("a row the vault no longer returns is the same recovery error", async () => {
  const vault = { get: async () => null } as unknown as SecretsVaultService;
  await expect(readLegacyOwnerEntry({ vault, row: { id: "x", kind: "vendor", ownerKey: "plugin", binding: null } })).rejects.toBeInstanceOf(OwnerStoreRecoveryError);
});

test.each([
  ["a non-copyable kind", { ...vendor, meta: {}, ...ownerContext({ kind: "mcp-env", ownerKey: "plugin", binding: null }) }],
  ["another workspace", { ...vendor, workspaceId: "ws-other", principalId: null }],
])("the owner vault refuses %s with the context error", async (_name, row) => {
  const repo = new InMemoryVaultRepo({}), keyFilePath = keyFile();
  const saved = await plant({ repo, keyFilePath, row });
  const vault = openLegacyOwnerVault({ repo, keyFilePath });
  await expect(vault.get(readableBy(row as VaultContext, saved.id))).rejects.toMatchObject({ code: "context" });
  await expect(vault.get(readableBy(row as VaultContext, saved.id))).rejects.toBeInstanceOf(VaultError);
});

test("a missing key file is a recovery error and creates no file", async () => {
  const repo = new InMemoryVaultRepo({}), keyFilePath = keyFile();
  const saved = await plant({ repo, keyFilePath, row: { ...vendor, ...ownerContext(vendor) } });
  rmSync(keyFilePath);
  const vault = openLegacyOwnerVault({ repo, keyFilePath });
  await expect(readLegacyOwnerEntry({ vault, row: { id: saved.id, kind: "vendor", ownerKey: "plugin", binding: null } })).rejects.toBeInstanceOf(OwnerStoreRecoveryError);
  expect(existsSync(keyFilePath)).toBe(false);
});
