import { AesGcmSecretSealer } from "@jini-ai/platform/secrets";
import { SecretsVaultService, createVaultMetaParsers } from "@jini-ai/platform/secrets/credential-sets";
import { describe, expect, it, vi } from "vitest";
import type { MediaProviderCredentialRepoPort } from "../provider-credential-contracts.js";
import type { MediaProviderCredentialSaveDeps, MediaProviderCredentialResolveDeps } from "../provider-credential-store.js";
import { mediaProviderSetRevision, saveMediaProviderCredentials, resolveMediaProviderCredential, MediaProviderCredentialStaleError } from "../provider-credential-store.js";
import type { VaultRecord, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { MediaCredentialVaultPolicy } from "../provider-credential-vault.js";
import { mediaProviderVault, mediaVaultRecord } from "../provider-credential-vault.js";

const vaultPolicy: MediaCredentialVaultPolicy = { ownerKey: "test", legacyIds: { canonical: ["legacy"] },
  parseMeta: ({ meta }) => { const m = meta as Record<string, unknown>; return {
    baseUrl: typeof m.baseUrl === "string" ? m.baseUrl : null, model: typeof m.model === "string" ? m.model : null }; } };
const row = (provider: string): VaultRecord => ({ workspaceId: "w", id: provider, kind: "media-provider", ownerKey: "test",
  principalId: null, binding: null, provider, label: provider, meta: { baseUrl: null, model: null }, sealed: { keyId: "k", ciphertext: provider, nonce: "n", alg: "a" },
  last4: null, tokenLength: null, isDefault: false, revision: 1, createdAt: "old", updatedAt: "old" });
const sha256Hex = ({ text }: { text: string }) => text;

function setup(rows: VaultRecord[]) {
  const prepare = vi.fn(async () => row("canonical"));
  const findOne = vi.fn(async () => ({ summary: { ...row("legacy"), configured: true }, payload: { apiKey: "secret" } }));
  const vault: VaultRepoPort = { list: vi.fn(async q => rows.filter(r => q.provider === undefined || r.provider === q.provider)),
    find: async () => null, put: async () => { throw new Error("unexpected put"); }, patchMeta: async () => { throw new Error("unexpected patch"); }, delete: async () => false };
  let records = rows.map(r => mediaVaultRecord({ row: r, policy: vaultPolicy }));
  const repo: MediaProviderCredentialRepoPort = { vault, listByWorkspaceId: async () => records, upsert: async () => {}, deleteByProviderIds: async () => {},
    replaceWorkspace: vi.fn(async ({ plan }) => { const next = plan({ existing: records }); records = [...next.upserts]; return records; }) };
  const deps: MediaProviderCredentialSaveDeps & MediaProviderCredentialResolveDeps = { repo, vaultPolicy, sha256Hex,
    builtInProviderIds: new Set(["canonical"]), credentialPolicy: { assertCredentialFreeField: () => {}, normalizeCredentialToken: ({ value }) => String(value) },
    credentialInputMessage: () => undefined, storageMessage: "storage", createVault: () => ({ prepare, findOne }),
    clock: { nowMs: () => Date.parse("2026-01-01") }, keyring: { activeKey: async () => ({ keyId: "k" }), derive: async () => new Uint8Array(), deriveSigningSecret: async () => new Uint8Array() },
    sealer: { seal: async () => row("canonical").sealed!, open: async () => "secret" } };
  return { deps, repo, prepare, findOne, records: () => records, vault };
}

describe("media credential set", () => {
  it("revision mismatch compares the locked snapshot and leaves the map untouched", async () => {
    const s = setup([row("canonical")]);
    const revision = mediaProviderSetRevision({ records: s.records(), sha256Hex });
    const before = s.records();
    s.repo.replaceWorkspace = vi.fn(async ({ plan }) => { const changed = before.map(r => ({ ...r, updatedAt: "new" })); plan({ existing: changed }); return changed; });
    await expect(saveMediaProviderCredentials({ deps: s.deps, input: { workspaceId: "w", providers: { canonical: { model: "new" } } } }, { expectedRevision: revision })).rejects.toBeInstanceOf(MediaProviderCredentialStaleError);
    expect(s.records()).toBe(before);
  });
  it("canonical unreadable row never opens a legacy row", async () => {
    const s = setup([row("canonical"), row("legacy")]);
    s.findOne.mockRejectedValue(new Error("unreadable"));
    await expect(resolveMediaProviderCredential({ deps: s.deps, workspaceId: "w", providerId: "canonical" })).rejects.toThrow("unreadable");
    expect(s.findOne).toHaveBeenCalledTimes(1);
    expect(s.findOne).toHaveBeenCalledWith(expect.objectContaining({ provider: "canonical" }));
  });
  it("metadata-only canonicalization reseals under the new identity", async () => {
    const s = setup([row("legacy")]);
    await saveMediaProviderCredentials({ deps: s.deps, input: { workspaceId: "w", providers: { canonical: { model: "next" } } } });
    expect(s.findOne).toHaveBeenCalledWith(expect.objectContaining({ provider: "legacy" }));
    expect(s.prepare).toHaveBeenCalledWith(expect.objectContaining({ provider: "canonical", payload: { apiKey: "secret" }, expectedRevision: null }));
    expect(s.records()[0]?.sealed?.ciphertext).toBe("canonical");
  });
});


it("opens a legacy credential under its stored identity and existing AAD", async () => {
  const legacy = { ...row("legacy"), sealed: { keyId: "k", alg: "aes-256-gcm", nonce: "AwMDAwMDAwMDAwMD", ciphertext: "XtzCczNjOztYemE6gi+LeZ9ZzYTR7LYNg0DFHYCtNywiYNqJ21DCqQ==" } };
  const s = setup([legacy]);
  const keyring = { activeKey: async () => ({ keyId: "k" }), derive: async () => new Uint8Array(32).fill(7), deriveSigningSecret: async () => new Uint8Array(32) };
  const sealer = new AesGcmSecretSealer({ keyring });
  const open = vi.spyOn(sealer, "open");
  const deps = { ...s.deps, sealer, createVault: ({ repo }: Parameters<MediaProviderCredentialResolveDeps["createVault"]>[0]) => new SecretsVaultService({
    repo: repo.vault!, keyring, sealer, metaParsers: createVaultMetaParsers({}), authorize: async () => {}, now: () => "now", newId: () => "id",
  }) };
  expect(await resolveMediaProviderCredential({ deps, workspaceId: "w", providerId: "canonical" })).toEqual({ apiKey: "fixture-key", baseUrl: null, model: null });
  expect(open).toHaveBeenCalledWith({ sealed: legacy.sealed }, { aad: 'secrets-vault:v1:["w","legacy","media-provider","test",null,null]' });
});


it("the singleton adapter delegates ownership validation to the vault service", async () => {
  const s = setup([]);
  const stored = { ...row("canonical"), ownerKey: "foreign" };
  vi.mocked(s.vault.list).mockResolvedValue([stored]);
  const vault = mediaProviderVault({ vault: s.vault, providerId: "canonical", policy: vaultPolicy });
  expect(await vault.findOne!({ workspaceId: "w", kind: "media-provider", ownerKey: "test", principalId: null, binding: null })).toBe(stored);
});
