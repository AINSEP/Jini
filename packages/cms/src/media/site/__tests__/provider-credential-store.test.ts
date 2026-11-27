import { AesGcmSecretSealer } from "@jini-ai/platform/secrets";
import { InMemoryVaultRepo, SecretsVaultService, createVaultMetaParsers } from "@jini-ai/platform/secrets/credential-sets";
import { describe, expect, it, vi } from "vitest";
import type { MediaProviderCredentialRepoPort } from "../provider-credential-contracts.js";
import type { MediaProviderCredentialSaveDeps, MediaProviderCredentialResolveDeps } from "../provider-credential-store.js";
import { getMediaProviderCredentials, mediaProviderSetRevision, saveMediaProviderCredentials, resolveMediaProviderCredential, MediaProviderCredentialStaleError, MediaProviderCredentialValidationError } from "../provider-credential-store.js";
import type { VaultRecord, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { MediaCredentialVaultPolicy } from "../provider-credential-vault.js";
import { MediaProviderCredentialVaultRepo, mediaProviderVault, mediaVaultRecord, mediaVaultScope } from "../provider-credential-vault.js";

import { applyMediaProviderChanges } from "../provider-credential-batch.js";

const vaultPolicy: MediaCredentialVaultPolicy = { ownerKey: "test", legacyIds: { canonical: ["legacy"] },
  parseMeta: ({ meta }) => { const m = meta as Record<string, unknown>; return {
    baseUrl: typeof m.baseUrl === "string" ? m.baseUrl : null, model: typeof m.model === "string" ? m.model : null }; } };
const row = (provider: string): VaultRecord => ({ workspaceId: "w", id: provider, kind: "media-provider", ownerKey: "test",
  principalId: null, binding: null, provider, label: provider, meta: { baseUrl: null, model: null }, sealed: { keyId: "k", ciphertext: provider, nonce: "n", alg: "a" },
  last4: null, tokenLength: null, isDefault: false, revision: 1, createdAt: "old", updatedAt: "old" });
const sha256Hex = ({ text }: { text: string }) => text;
const legacy = { ...row("legacy"), sealed: { keyId: "k", alg: "aes-256-gcm", nonce: "AwMDAwMDAwMDAwMD", ciphertext: "XtzCczNjOztYemE6gi+LeZ9ZzYTR7LYNg0DFHYCtNywiYNqJ21DCqQ==" } };

function setup(rows: VaultRecord[]) {
  const prepare = vi.fn(async () => row("canonical"));
  const findOne = vi.fn(async () => ({ summary: { ...row("legacy"), configured: true }, payload: { apiKey: "secret" } }));
  const vault: VaultRepoPort = { list: vi.fn(async q => rows.filter(r => q.provider === undefined || r.provider === q.provider)),
    find: async () => null, put: async () => { throw new Error("unexpected put"); }, patchMeta: async () => { throw new Error("unexpected patch"); }, delete: async () => false };
  let records = rows.map(r => mediaVaultRecord({ row: r, policy: vaultPolicy }));
  const repo: MediaProviderCredentialRepoPort = { vault, listByWorkspaceId: async () => records, upsert: async () => {}, deleteByProviderIds: async () => {},
    replaceWorkspace: vi.fn(async ({ plan }) => { const next = plan({ existing: records }); records = [...next.upserts]; return records; }) };
  const deps: MediaProviderCredentialSaveDeps & MediaProviderCredentialResolveDeps = { repo, vaultPolicy, sha256Hex,
    idGen: { newId: () => "fresh-canonical" },
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
    const vault = new InMemoryVaultRepo({});
    await vault.put({ record: legacy, expectedRevision: null });
    const repo = new MediaProviderCredentialVaultRepo({ vault, policy: vaultPolicy, idGen: { newId: () => "repo-fallback" } });
    const keyring = { activeKey: async () => ({ keyId: "k" }), derive: async () => new Uint8Array(32).fill(7), deriveSigningSecret: async () => new Uint8Array(32) };
    const sealer = new AesGcmSecretSealer({ keyring }, { randomBytesFn: ({ byteLength }) => new Uint8Array(byteLength).fill(4) });
    const deps: MediaProviderCredentialSaveDeps = { ...setup([]).deps, repo, keyring, sealer,
      createVault: ({ repo }) => new SecretsVaultService({
        repo: repo.vault!, keyring, sealer, metaParsers: createVaultMetaParsers({}), authorize: async () => {}, now: () => "now", newId: () => "id",
      }),
    };
    await saveMediaProviderCredentials({ deps, input: { workspaceId: "w", providers: { canonical: { model: "next" } } } });
    const [canonical] = await vault.list(mediaVaultScope({ workspaceId: "w", providerId: "canonical", policy: vaultPolicy }));
    expect(canonical).toMatchObject({ id: "fresh-canonical", provider: "canonical", revision: 1, meta: { baseUrl: null, model: "next" } });
    expect(canonical?.sealed?.ciphertext).not.toBe(legacy.sealed.ciphertext);
    expect(await resolveMediaProviderCredential({ deps, workspaceId: "w", providerId: "canonical" })).toEqual({ apiKey: "fixture-key", baseUrl: null, model: "next" });
  });
});


it("opens a legacy credential under its stored identity and existing AAD", async () => {
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
  expect(await vault.findOne!({ workspaceId: "w", kind: "media-provider", ownerKey: "test", principalId: null })).toBe(stored);
});

it("marker reads collapse legacy ids without decrypting, with the canonical row taking precedence", async () => {
  const prior = { ...legacy, meta: { model: "old-model" }, tokenLength: 16, last4: "9876" };
  const newRow = { ...row("canonical"), sealed: null, meta: { model: "better-model" } };
  const lookup = async (rows: VaultRecord[]) => {
    const s = setup(rows);
    const view = await getMediaProviderCredentials({ deps: s.deps, workspaceId: "w" });
    expect(s.findOne.mock.calls).toEqual([]);
    return view;
  };
  expect(await lookup([prior])).toEqual({ canonical: { model: "old-model", apiKeyConfigured: true,
    apiKeyHint: { length: 16, last4: "9876" }, apiKeyTail: "9876" } });
  expect(await lookup([prior, newRow])).toEqual({ canonical: { model: "better-model" } });
});

it("no canonical or legacy row returns null without opening a credential", async () => {
  const s = setup([]);
  expect(await resolveMediaProviderCredential({ deps: s.deps, workspaceId: "w", providerId: "canonical" })).toBeNull();
  expect(s.findOne.mock.calls).toEqual([]);
});

it("a malformed credential edit never prepares secrets or changes the stored set", async () => {
  const s = setup([row("canonical")]);
  type Providers = Parameters<typeof saveMediaProviderCredentials>[0]["input"]["providers"];
  const choices: Array<[unknown, string]> = [
    [[], "providers must be an object keyed by provider id"],
    [{ canonical: null }, 'provider "canonical" must be an object'],
    [{ unknown: {} }, 'unknown media provider "unknown"'],
    [{ canonical: { apiKey: 7 } }, 'apiKey for "canonical" must be a string'],
    [{ canonical: { model: "x".repeat(2049) } }, 'model for "canonical" exceeds 2048 characters'],
  ];
  for (const [providers, diagnostic] of choices) {
    const failed = saveMediaProviderCredentials({ deps: s.deps, input: { workspaceId: "w", providers: providers as Providers } });
    await expect(failed).rejects.toBeInstanceOf(MediaProviderCredentialValidationError);
    await expect(failed).rejects.toThrow(diagnostic);
  }
  expect(s.prepare.mock.calls).toEqual([]);
  expect(vi.mocked(s.repo.replaceWorkspace).mock.calls).toEqual([]);
  expect(s.records().map(record => [record.providerId, record.sealed])).toEqual([["canonical", row("canonical").sealed]]);
});

it("batch rejects duplicate and overlapping ids, including canonical removal with a legacy removal", async () => {
  const s = setup([row("canonical")]);
  for (const changes of [
    { removes: ["canonical", "legacy"], patches: [] },
    { removes: [], patches: [{ providerId: "canonical", fields: { model: "first" } }, { providerId: "canonical", fields: { model: "second" } }] },
    { removes: ["canonical"], patches: [{ providerId: "canonical", fields: { model: "first" } }] },
  ]) {
    const call = applyMediaProviderChanges({ deps: s.deps, workspaceId: "w", ...changes });
    await expect(call).rejects.toBeInstanceOf(MediaProviderCredentialValidationError);
    await expect(call).rejects.toThrow("provider changes must not contain duplicate or overlapping ids");
  }
  expect(s.prepare.mock.calls).toEqual([]);
  expect(vi.mocked(s.repo.replaceWorkspace).mock.calls).toEqual([]);
});
