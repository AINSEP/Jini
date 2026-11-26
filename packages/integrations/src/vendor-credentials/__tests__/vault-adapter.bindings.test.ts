import { expect, test, vi } from "vitest";
import { InMemoryVaultRepo, SecretsVaultService, createVaultMetaParsers } from "@jini-ai/platform/secrets/credential-sets";
import type { VaultRecord, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import { bindCredentialVaultAdapters, type CredentialVaultAdapterPolicy } from "../vault-adapter.js";

const policy: CredentialVaultAdapterPolicy = { ownerKey: "host", acceptedKinds: ["vendor", "custom", "source-control"],
  metaParsers: createVaultMetaParsers({}), openService: required => new SecretsVaultService(required) };
const row: VaultRecord = { workspaceId: "site", id: "row", kind: "vendor", ownerKey: "host", principalId: null, binding: null,
  provider: "provider", label: "label", sealed: { keyId: "key", alg: "test", nonce: "nonce", ciphertext: "ciphertext" },
  meta: { credentialType: "vendor", worksFor: [] }, isDefault: true, revision: 1, last4: "tail", tokenLength: 20, createdAt: "now", updatedAt: "now" };

test("bound open and DTO readers reject foreign owners and other kinds", async () => {
  const binding = bindCredentialVaultAdapters({ policy });
  const vault: VaultRepoPort = { find: vi.fn().mockResolvedValue({ ...row, ownerKey: "foreign" }), list: vi.fn(), put: vi.fn(), delete: vi.fn(), patchMeta: vi.fn() };
  const vendor = new binding.VendorCredentialSetVaultRepo({ vault });
  expect(await vendor.findById({ workspaceId: "site", id: "row" })).toBeNull();
  vi.mocked(vault.find).mockResolvedValue({ ...row, kind: "source-control" });
  expect(await vendor.findById({ workspaceId: "site", id: "row" })).toBeNull();
  const opened = binding.credentialVault({ repo: { vault }, storageError: () => new Error("storage") });
  await expect(opened.get({ ...binding.credentialScope({ workspaceId: "site", kind: "vendor" }), ownerKey: "foreign", id: "row" })).rejects.toMatchObject({ code: "context" });
  expect(binding.credentialScope({ workspaceId: "site", kind: "source-control" })).toEqual({ workspaceId: "site", kind: "source-control", ownerKey: "host", principalId: null, binding: null });
});

test("vendor and source-control default queries use their own kind and projection", async () => {
  const vault = new InMemoryVaultRepo({});
  await vault.put({ record: row, expectedRevision: null });
  await vault.put({ record: { ...row, id: "source", kind: "source-control", meta: {} }, expectedRevision: null });
  const { SourceControlCredentialSetVaultAdapter, VendorCredentialSetVaultRepo } = bindCredentialVaultAdapters({ policy });
  const vendor = new VendorCredentialSetVaultRepo({ vault, kind: "vendor", vendor: true });
  const source = new SourceControlCredentialSetVaultAdapter({ vault, kind: "source-control" });
  expect(await vendor.findDefaultByVendor({ workspaceId: "site", vendorId: "provider" })).toMatchObject({ id: "row", vendorId: "provider" });
  expect(await source.findDefaultByProvider({ workspaceId: "site", providerId: "provider" })).toMatchObject({ id: "source", providerId: "provider" });
});

test("custom metadata and custom vault rows never become vendor DTOs", async () => {
  const vault: VaultRepoPort = { find: vi.fn().mockResolvedValue({ ...row, meta: { credentialType: "custom", worksFor: [] } }), list: vi.fn(), put: vi.fn(), delete: vi.fn(), patchMeta: vi.fn() };
  const { VendorCredentialSetVaultRepo } = bindCredentialVaultAdapters({ policy });
  const vendor = new VendorCredentialSetVaultRepo({ vault });
  expect(await vendor.findById({ workspaceId: "site", id: "row" })).toBeNull();
  vi.mocked(vault.find).mockResolvedValue({ ...row, kind: "custom" });
  expect(await vendor.findById({ workspaceId: "site", id: "row" })).toBeNull();
});

test("the bound vendor constructor preserves the optional project fallback", () => {
  const vault = new InMemoryVaultRepo({});
  const { VendorCredentialSetVaultRepo } = bindCredentialVaultAdapters({ policy });
  const project = { workspaceId: "project", repo: new VendorCredentialSetVaultRepo({ vault }),
    sealer: { seal: async () => row.sealed!, open: async () => "secret" },
    keyring: { activeKey: async () => ({ keyId: "key" }), derive: async () => new Uint8Array(32), deriveSigningSecret: async () => new Uint8Array(32) } };
  expect(new VendorCredentialSetVaultRepo({ vault }, { project }).project).toBe(project);
  expect(new VendorCredentialSetVaultRepo({ vault }).project).toBeUndefined();
});

test("safe hints are present without opening or enumerating sealed-row metadata", async () => {
  const vault = new InMemoryVaultRepo({});
  await vault.put({ record: row, expectedRevision: null });
  const { VendorCredentialSetVaultRepo } = bindCredentialVaultAdapters({ policy });
  const record = await new VendorCredentialSetVaultRepo({ vault }).findById({ workspaceId: "site", id: "row" });
  expect(record?.tokenHint).toEqual({ length: 20, last4: "tail" });
  expect(Object.keys(record!)).not.toContain("tokenHint");
});
