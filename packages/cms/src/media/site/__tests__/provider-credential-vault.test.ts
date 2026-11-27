import { InMemoryVaultRepo } from "@jini-ai/platform/secrets/credential-sets";
import { expect, it, vi } from "vitest";
import { VaultError, type VaultRecord, type VaultRepoPort } from "@jini-ai/core/contracts/vault";
import { MediaProviderCredentialVaultRepo, mediaVaultRecord, mediaProviderVault, mediaVaultScope, mediaVaultId, type MediaCredentialVaultPolicy } from "../provider-credential-vault.js";

it("a row whose kind, ownerKey, principalId or binding differs from the policy is refused with VaultError({code:'context'}) on list, read, replace and delete, never mapped to a record", async () => {
  const policy: MediaCredentialVaultPolicy = { ownerKey: "expected", legacyIds: {}, parseMeta: () => ({ baseUrl: null, model: null }) };
  const good: VaultRecord = { workspaceId: "w", id: "id", kind: "media-provider", ownerKey: "expected", principalId: null, binding: null,
    provider: "p", label: "p", isDefault: false, revision: 1, sealed: null, last4: null, tokenLength: null, meta: {}, createdAt: "now", updatedAt: "now" };
  for (const patch of [{ kind: "custom" as const }, { ownerKey: "other" }, { principalId: "p" }, { binding: "b" }]) {
    const row = { ...good, ...patch };
    const applyBatch = vi.fn(async () => []);
    const vault: VaultRepoPort = { list: async () => [row], find: async () => row, put: async () => row, patchMeta: async () => row, delete: async () => true, applyBatch };
    const repo = new MediaProviderCredentialVaultRepo({ vault, policy, idGen: { newId: () => "fresh" } });
    const reader = mediaProviderVault({ vault, providerId: "p", policy });
    if (!reader.findOne) throw new Error("missing singleton read");
    await expect(reader.findOne(mediaVaultScope({ workspaceId: "w", providerId: "p", policy }))).rejects.toMatchObject({ code: "context" });
    expect(() => mediaVaultRecord({ row, policy })).toThrow(VaultError);
    await expect(repo.listByWorkspaceId({ workspaceId: "w" })).rejects.toMatchObject({ code: "context" });
    await expect(repo.replaceWorkspace({ workspaceId: "w", plan: () => ({ upserts: [], tombstoneProviderIds: [] }) })).rejects.toMatchObject({ code: "context" });
    await expect(repo.deleteByProviderIds({ workspaceId: "w", providerIds: ["p"] })).rejects.toMatchObject({ code: "context" });
    expect(applyBatch).not.toHaveBeenCalled();
  }
});

it("clearing a canonical provider deletes only that workspace’s canonical and alias credentials", async () => {
  const vault = new InMemoryVaultRepo({});
  const policy: MediaCredentialVaultPolicy = { ownerKey: "expected", legacyIds: { provider: ["alias"] }, parseMeta: () => ({ baseUrl: null, model: null }) };
  const row = (workspaceId: string, provider: string): VaultRecord => ({
    workspaceId, provider, id: `${workspaceId}-${provider}`, kind: "media-provider", ownerKey: "expected", principalId: null, binding: null,
    label: provider, isDefault: false, revision: 1, sealed: null, last4: null, tokenLength: null, meta: {}, createdAt: "old", updatedAt: "old",
  });
  expect(mediaVaultId({ providerId: "alias" })).toBe('vault:["media-provider","alias"]');
  for (const record of [row("west", "provider"), row("west", "alias"), row("west", "other"), row("east", "provider")]) {
    await vault.put({ record, expectedRevision: null });
  }
  const repo = new MediaProviderCredentialVaultRepo({ vault, policy, idGen: { newId: () => "new" } });
  await repo.deleteByProviderIds({ workspaceId: "west", providerIds: [] });
  expect((await repo.listByWorkspaceId({ workspaceId: "west" })).map(record => record.providerId).sort()).toEqual(["alias", "other", "provider"]);
  await repo.deleteByProviderIds({ workspaceId: "west", providerIds: ["provider"] });
  expect((await repo.listByWorkspaceId({ workspaceId: "west" })).map(record => record.providerId)).toEqual(["other"]);
  expect((await repo.listByWorkspaceId({ workspaceId: "east" })).map(record => record.providerId)).toEqual(["provider"]);
});
