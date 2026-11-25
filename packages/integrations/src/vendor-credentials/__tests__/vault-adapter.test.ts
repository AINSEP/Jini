import { expect, test, vi } from "vitest";
import { SecretsVaultService, InMemoryVaultRepo, createVaultMetaParsers } from "@jini-ai/platform/secrets/credential-sets";
import type { VaultRecord, VaultRepoPort, SealedSecret } from "@jini-ai/core/contracts/vault";
import { CredentialSetVaultAdapter, createCredentialVaultBinding, toSourceControlCredentialRecord, type CredentialVaultAdapterPolicy } from "../vault-adapter.js";

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
