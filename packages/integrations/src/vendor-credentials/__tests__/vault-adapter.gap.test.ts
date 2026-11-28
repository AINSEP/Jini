import { describe, expect, it, vi } from "vitest";
import { InMemoryVaultRepo, SecretsVaultService, createVaultMetaParsers } from "@jini-ai/platform/secrets/credential-sets";
import { VaultError, type SealedSecret, type VaultRecord, type VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { VendorCredentialSetRecord } from "@jini-ai/core/contracts/site/vendor-credentials";
import { CredentialSetVaultAdapter, VendorCredentialSetVaultRepo, toSourceControlCredentialRecord, type CredentialVaultAdapterPolicy } from "../vault-adapter.js";

const policy: CredentialVaultAdapterPolicy = { ownerKey: "host", acceptedKinds: ["vendor", "source-control"], metaParsers: createVaultMetaParsers({}), openService: r => new SecretsVaultService(r) };
const sealed: SealedSecret = { keyId: "key", alg: "test", nonce: "n1", ciphertext: "c1" };
const vendorRecord = (over: Partial<VendorCredentialSetRecord> = {}): VendorCredentialSetRecord => ({ workspaceId: "site", id: "v1", label: "Vendor", sealed, vendorId: "acme",
  credentialType: "vendor", worksFor: ["acme"], tokenTail: "", isDefault: true, accountLabel: "acct", createdAt: "t0", updatedAt: "t0", ...over });
const row = (over: Partial<VaultRecord> = {}): VaultRecord => ({ workspaceId: "site", kind: "vendor", ownerKey: "host", principalId: null, binding: null, id: "v1", provider: "acme", label: "Vendor",
  sealed, meta: { credentialType: "vendor", worksFor: ["acme"], accountLabel: "acct" }, isDefault: true, revision: 1, last4: "WXYZ", tokenLength: 20, createdAt: "t0", updatedAt: "t0", ...over });

describe("vendor repo writes", () => {
  it("insert stores vendor meta and no hint; list/default lookups by vendor return it", async () => {
    const vault = new InMemoryVaultRepo({});
    const repo = new VendorCredentialSetVaultRepo({ vault, policy });
    await repo.insert(vendorRecord({ worksFor: ["acme", "imgs"] }));
    const stored = await vault.find({ workspaceId: "site", id: "v1" });
    expect(stored).toMatchObject({ kind: "vendor", ownerKey: "host", provider: "acme", revision: 1, last4: null, tokenLength: null, meta: { credentialType: "vendor", worksFor: ["acme", "imgs"], accountLabel: "acct" } });
    expect((await repo.listByVendor({ workspaceId: "site", vendorId: "acme" })).map(r => r.id)).toEqual(["v1"]);
    expect(await repo.listByVendor({ workspaceId: "site", vendorId: "other" })).toEqual([]);
    expect((await repo.listByWorkspace({ workspaceId: "site" })).map(r => [r.id, r.vendorId, r.worksFor])).toEqual([["v1", "acme", ["acme", "imgs"]]]);
    expect(await repo.findDefaultByVendor({ workspaceId: "site", vendorId: "acme" })).toMatchObject({ id: "v1", isDefault: true });
  });

  it("update keeps the hint for the same envelope, drops it for a new one, and bumps the revision", async () => {
    const vault = new InMemoryVaultRepo({});
    await vault.put({ record: row(), expectedRevision: null });
    const repo = new VendorCredentialSetVaultRepo({ vault, policy });
    await repo.update(vendorRecord({ label: "Renamed", worksFor: undefined as unknown as string[] }));
    expect(await vault.find({ workspaceId: "site", id: "v1" })).toMatchObject({ label: "Renamed", revision: 2, last4: "WXYZ", tokenLength: 20, meta: { worksFor: ["acme"] } });
    await repo.update(vendorRecord({ sealed: { ...sealed, ciphertext: "c2" } }));
    expect(await vault.find({ workspaceId: "site", id: "v1" })).toMatchObject({ revision: 3, last4: null, tokenLength: null });
  });

  it("update of a missing or foreign row writes nothing; source-control writes carry no vendor meta", async () => {
    const vault: VaultRepoPort = { find: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(row({ ownerKey: "foreign" })), list: vi.fn(), put: vi.fn(), delete: vi.fn(), patchMeta: vi.fn() };
    const repo = new VendorCredentialSetVaultRepo({ vault, policy });
    await repo.update(vendorRecord());
    await repo.update(vendorRecord());
    expect(vault.put).not.toHaveBeenCalled();
    const mem = new InMemoryVaultRepo({});
    const source = new CredentialSetVaultAdapter({ vault: mem, kind: "source-control", policy, projectRecord: toSourceControlCredentialRecord });
    await source.insert({ workspaceId: "site", id: "s1", label: "Git", sealed, providerId: "gh", isDefault: false, accountLabel: "me", createdAt: "t0", updatedAt: "t0" });
    expect((await mem.find({ workspaceId: "site", id: "s1" }))?.meta).toEqual({ accountLabel: "me" });
  });
});

describe("vendor repo reads", () => {
  it("a vendor row whose meta is not vendor-typed is hidden; an unsealed row is an invalid record", async () => {
    const vault: VaultRepoPort = { find: vi.fn().mockResolvedValueOnce(row({ meta: { credentialType: "custom", worksFor: [] } })).mockResolvedValueOnce(row({ sealed: null })), list: vi.fn(), put: vi.fn(), delete: vi.fn(), patchMeta: vi.fn() };
    const repo = new VendorCredentialSetVaultRepo({ vault, policy });
    expect(await repo.findById({ workspaceId: "site", id: "v1" })).toBeNull();
    await expect(repo.findById({ workspaceId: "site", id: "v1" })).rejects.toMatchObject({ code: "invalid-record" });
  });

  it("default lookup requires a vault that supports it", async () => {
    const vault: VaultRepoPort = { find: vi.fn(), list: vi.fn(), put: vi.fn(), delete: vi.fn(), patchMeta: vi.fn() };
    await expect(new VendorCredentialSetVaultRepo({ vault, policy }).findDefaultByVendor({ workspaceId: "site", vendorId: "acme" })).rejects.toBeInstanceOf(VaultError);
  });
});

describe("updateAccountLabel", () => {
  const port = (found: VaultRecord | null, patchMeta: VaultRepoPort["patchMeta"] = vi.fn(async () => row())): VaultRepoPort => ({ find: vi.fn(async () => found), list: vi.fn(), put: vi.fn(), delete: vi.fn(), patchMeta });

  it("patches only the account label at the row's revision and updatedAt", async () => {
    const vault = port(row({ revision: 4, updatedAt: "t9" }));
    await new VendorCredentialSetVaultRepo({ vault, policy }).updateAccountLabel({ workspaceId: "site", id: "v1", accountLabel: "new", expectedSealed: sealed });
    expect(vault.patchMeta).toHaveBeenCalledWith({ workspaceId: "site", id: "v1", accountLabel: "new", expectedSealed: sealed, expectedRevision: 4, patch: { accountLabel: "new" }, updatedAt: "t9" });
  });

  it("missing or foreign rows are a no-op; a conflict is swallowed but other failures propagate", async () => {
    for (const found of [null, row({ ownerKey: "foreign" })]) {
      const vault = port(found);
      await new VendorCredentialSetVaultRepo({ vault, policy }).updateAccountLabel({ workspaceId: "site", id: "v1", accountLabel: "x" });
      expect(vault.patchMeta).not.toHaveBeenCalled();
    }
    const conflict = port(row(), vi.fn(async () => { throw new VaultError({ code: "conflict" }); }));
    await expect(new VendorCredentialSetVaultRepo({ vault: conflict, policy }).updateAccountLabel({ workspaceId: "site", id: "v1", accountLabel: "x" })).resolves.toBeUndefined();
    const broken = port(row(), vi.fn(async () => { throw new Error("disk"); }));
    await expect(new VendorCredentialSetVaultRepo({ vault: broken, policy }).updateAccountLabel({ workspaceId: "site", id: "v1", accountLabel: "x" })).rejects.toThrow("disk");
  });

  it("a label the host's meta parser clears is refused as invalid meta and never patched", async () => {
    const dropBlankLabel = createVaultMetaParsers({}, { parsers: { vendor: ({ meta }) => {
      if (typeof meta !== "object" || meta === null) throw new Error("meta must be an object");
      return Object.fromEntries(Object.entries(meta).filter(([key, value]) => key !== "accountLabel" || (typeof value === "string" && value.trim() !== "")));
    } } });
    const vault = port(row());
    const repo = new VendorCredentialSetVaultRepo({ vault, policy: { ...policy, metaParsers: dropBlankLabel } });
    await expect(repo.updateAccountLabel({ workspaceId: "site", id: "v1", accountLabel: "   " })).rejects.toMatchObject({ code: "invalid-meta" });
    expect(vault.patchMeta).not.toHaveBeenCalled();
  });
});

describe("vendor repo delete and listing", () => {
  it("delete removes an owned row at its current revision; a missing or foreign row is left alone", async () => {
    const vault: VaultRepoPort = { find: vi.fn().mockResolvedValueOnce(row({ revision: 6 })).mockResolvedValueOnce(null).mockResolvedValueOnce(row({ ownerKey: "foreign" })),
      list: vi.fn(), put: vi.fn(), delete: vi.fn(async () => true), patchMeta: vi.fn() };
    const repo = new VendorCredentialSetVaultRepo({ vault, policy });
    await repo.delete({ workspaceId: "site", id: "v1" });
    await repo.delete({ workspaceId: "site", id: "gone" });
    await repo.delete({ workspaceId: "site", id: "v1" });
    expect(vault.delete).toHaveBeenCalledTimes(1);
    expect(vault.delete).toHaveBeenCalledWith({ workspaceId: "site", id: "v1", expectedRevision: 6 });
  });

  it("lists skip rows that are not this owner's vendor credentials", async () => {
    const rows = [row({ id: "mine" }), row({ id: "theirs", ownerKey: "foreign" }), row({ id: "custom", meta: { credentialType: "custom", worksFor: [] } })];
    const vault: VaultRepoPort = { find: vi.fn(), list: vi.fn(async () => rows), put: vi.fn(), delete: vi.fn(), patchMeta: vi.fn() };
    const repo = new VendorCredentialSetVaultRepo({ vault, policy });
    expect((await repo.listByVendor({ workspaceId: "site", vendorId: "acme" })).map((r) => r.id)).toEqual(["mine"]);
    expect((await repo.listByWorkspace({ workspaceId: "site" })).map((r) => r.id)).toEqual(["mine"]);
  });

  it("a vendor insert without a worksFor list falls back to its own vendor", async () => {
    const vault = new InMemoryVaultRepo({});
    const { worksFor: _worksFor, ...withoutWorksFor } = vendorRecord({ id: "v2", vendorId: "imgco" });
    await new VendorCredentialSetVaultRepo({ vault, policy }).insert(withoutWorksFor as VendorCredentialSetRecord);
    expect((await vault.find({ workspaceId: "site", id: "v2" }))?.meta).toMatchObject({ credentialType: "vendor", worksFor: ["imgco"] });
  });
});
