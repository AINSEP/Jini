import { AesGcmSecretSealer } from "@jini-ai/platform/secrets";
import { expect, test, vi } from "vitest";
import { SecretsVaultService, InMemoryVaultRepo, createVaultMetaParsers } from "@jini-ai/platform/secrets/credential-sets";
import type { VaultRecord, VaultRepoPort, SealedSecret } from "@jini-ai/core/contracts/vault";
import { CredentialSetVaultAdapter, createCredentialVaultBinding, toSourceControlCredentialRecord, toVendorCredentialRecord, credentialScope, type CredentialVaultAdapterPolicy } from "../vault-adapter.js";

const policy: CredentialVaultAdapterPolicy = { ownerKey: "host", acceptedKinds: ["vendor", "custom", "source-control"], metaParsers: createVaultMetaParsers({}), openService: required => new SecretsVaultService(required) };
const sealed: SealedSecret = { keyId: "key", alg: "test", nonce: "nonce", ciphertext: "ciphertext" };

test("abort-wrapped repo supplies the actual put port", async () => {
  const raw = new InMemoryVaultRepo({});
  const abort = new Error("aborted");
  const guarded: VaultRepoPort = { find: raw.find.bind(raw), list: raw.list.bind(raw), patchMeta: raw.patchMeta.bind(raw), delete: raw.delete.bind(raw), put: vi.fn(async () => { throw abort; }) };
  const adapter = new CredentialSetVaultAdapter({ vault: raw, kind: "source-control", policy, projectRecord: toSourceControlCredentialRecord });
  const vault = adapter.credentialVault.open({ repo: { vault: guarded }, storageError: () => new Error("storage"),
    keyring: { activeKey: async () => ({ keyId: "key" }), derive: vi.fn(), deriveSigningSecret: vi.fn() },
    sealer: { seal: async () => sealed, open: async () => '{"token":"secret"}' },
  });
  await expect(vault.put({ workspaceId: "site", kind: "source-control", ownerKey: "host", principalId: null, binding: null, id: "row", provider: "provider", label: "label", meta: {}, payload: { token: "secret" }, expectedRevision: null })).rejects.toBe(abort);
  expect(guarded.put).toHaveBeenCalledTimes(1);
  expect(await raw.find({ workspaceId: "site", id: "row" })).toBeNull();
});

test("a delayed probe cannot patch a rotated sealed revision", async () => {
  const row: VaultRecord = { workspaceId: "site", kind: "source-control", ownerKey: "host", principalId: null, binding: null, id: "row", provider: "provider", label: "label", sealed: { ...sealed, ciphertext: "rotated" }, meta: {}, isDefault: true, revision: 2, last4: null, tokenLength: null, createdAt: "now", updatedAt: "now" };
  const vault: VaultRepoPort = { find: vi.fn().mockResolvedValue(row), list: vi.fn(), put: vi.fn(), delete: vi.fn(), patchMeta: vi.fn() };
  const repo = new CredentialSetVaultAdapter({ vault, kind: "source-control", policy, projectRecord: toSourceControlCredentialRecord });
  await repo.updateAccountLabel({ workspaceId: "site", id: "row", accountLabel: "old-account", expectedSealed: sealed });
  expect(vault.patchMeta).not.toHaveBeenCalled();
  expect(vault.put).not.toHaveBeenCalled();
});

test("a foreign owner, an unlisted kind or a principal id is refused", async () => {
  const repo = { vault: new InMemoryVaultRepo({}) };
  const vault = createCredentialVaultBinding({ policy }).open({ repo, storageError: () => new Error("storage") });
  const input = { workspaceId: "site", kind: "vendor" as const, ownerKey: "host", principalId: null, binding: null, id: "row" };
  for (const context of [{ ...input, ownerKey: "foreign" }, { ...input, kind: "site-assistant" as const }, { ...input, principalId: "human" }]) {
    await expect(vault.get(context)).rejects.toMatchObject({ code: "context" });
  }
});

test("vendor and source-control records retain distinct kinds and the same owner", async () => {
  const rows: VaultRecord[] = ["vendor", "source-control"].map(kind => ({ workspaceId: "site", kind: kind as "vendor" | "source-control", ownerKey: "host", principalId: null, binding: null,
    id: kind, provider: "provider", label: kind, sealed, meta: kind === "vendor" ? { credentialType: "vendor", worksFor: [] } : {}, isDefault: true, revision: 1, last4: null, tokenLength: null, createdAt: "now", updatedAt: "now" }));
  const vault = new InMemoryVaultRepo({});
  for (const row of rows) await vault.put({ record: row, expectedRevision: null });
  const vendor = new CredentialSetVaultAdapter({ vault, kind: "vendor", policy, projectRecord: toVendorCredentialRecord });
  const source = new CredentialSetVaultAdapter({ vault, kind: "source-control", policy, projectRecord: toSourceControlCredentialRecord });
  expect(await vendor.findById({ workspaceId: "site", id: "vendor" })).toMatchObject({ vendorId: "provider", id: "vendor" });
  expect(await source.findById({ workspaceId: "site", id: "source-control" })).toMatchObject({ providerId: "provider", id: "source-control" });
  expect(await vendor.findById({ workspaceId: "site", id: "source-control" })).toBeNull();
  expect(await source.findById({ workspaceId: "site", id: "vendor" })).toBeNull();
  expect(credentialScope({ workspaceId: "site", kind: "vendor", ownerKey: "host" })).toEqual({ workspaceId: "site", kind: "vendor", ownerKey: "host", principalId: null, binding: null });
});


test("the sealed fixture requires the original owner and writes only after protected sealing", async () => {
  const raw = new InMemoryVaultRepo({});
  const fixture: VaultRecord = { workspaceId: "site", id: "row", kind: "source-control", ownerKey: "host", principalId: null, binding: null,
    provider: "provider", label: "label", sealed: { keyId: "key", alg: "aes-256-gcm", nonce: "AwMDAwMDAwMDAwMD", ciphertext: "XtzXbDFNMGBAYiU1kyOKfogRlIDf8PpSUiQX9QcItM26ENhFtbplWV0=" },
    meta: {}, last4: null, tokenLength: null, isDefault: true, revision: 1, createdAt: "now", updatedAt: "now" };
  await raw.put({ record: fixture, expectedRevision: null });
  const keyring = { activeKey: async () => ({ keyId: "key" }), derive: async () => new Uint8Array(32).fill(7), deriveSigningSecret: async () => new Uint8Array(32) };
  const sealer = new AesGcmSecretSealer({ keyring });
  const binding = createCredentialVaultBinding({ policy });
  const vault = binding.open({ repo: { vault: raw }, sealer, keyring, storageError: () => new Error("storage"), clock: { nowMs: () => 0 }, idGen: { newId: () => "new" } });
  expect((await vault.get({ ...binding.scope({ workspaceId: "site", kind: "source-control" }), id: "row" }))?.payload).toEqual({ token: "fixture-token" });
  const changed = createCredentialVaultBinding({ policy: { ...policy, ownerKey: "changed" } });
  await expect(changed.open({ repo: { vault: raw }, sealer, keyring, storageError: () => new Error("storage") }).get({ ...changed.scope({ workspaceId: "site", kind: "source-control" }), id: "row" })).rejects.toMatchObject({ code: "context" });
  const order: string[] = [];
  const seal = sealer.seal.bind(sealer), open = sealer.open.bind(sealer), put = raw.put.bind(raw);
  vi.spyOn(sealer, "seal").mockImplementation(async input => { order.push("seal"); return seal(input); });
  vi.spyOn(sealer, "open").mockImplementation(async (input, optional) => { order.push("verify"); return open(input, optional); });
  vi.spyOn(raw, "put").mockImplementation(async input => { order.push("put"); return put(input); });
  await vault.put({ ...binding.scope({ workspaceId: "site", kind: "source-control" }), id: "new", expectedRevision: null, provider: "provider", label: "new", meta: {}, payload: { token: "next-token" } });
  expect(order).toEqual(["seal", "verify", "put"]);
});


test("the protected service keyring exposes only activeKey", () => {
  const openService = vi.fn(policy.openService);
  createCredentialVaultBinding({ policy: { ...policy, openService } }).open({ repo: { vault: new InMemoryVaultRepo({}) }, storageError: () => new Error("storage") });
  expect(Object.keys(openService.mock.calls[0]![0].keyring)).toEqual(["activeKey"]);
});
