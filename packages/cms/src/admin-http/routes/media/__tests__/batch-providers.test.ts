import { createHash } from "node:crypto";
import { InMemoryVaultRepo, SecretsVaultService, createVaultMetaParsers } from "@jini-ai/platform/secrets/credential-sets";
import { AesGcmSecretSealer } from "@jini-ai/platform/secrets";
import { VaultError } from "@jini-ai/core/contracts/vault";
import { expect, it, vi } from "vitest";
import { MediaProviderCredentialVaultRepo } from "../../../../media/site/provider-credential-vault.js";
import { applyMediaProviderChanges } from "../../../../media/site/provider-credential-batch.js";
import type { MediaProviderCredentialRowDeps } from "../../../../media/site/provider-credential-store.js";
import { mediaBatchProvidersRoute, type MediaBatchProvidersRouteDeps } from "../batch-providers.js";
import { NOW, PRINCIPAL, WORKSPACE_ID, recordingAuthorize, refusalOf } from "./helpers.js";

async function batchFixture() {
  const vault = new InMemoryVaultRepo({});
  const policy = { ownerKey: "test", legacyIds: {}, parseMeta: ({ meta }: { meta: unknown }) => {
    const fields = meta as { baseUrl: string | null; model: string | null };
    return { baseUrl: fields.baseUrl, model: fields.model };
  } };
  const idGen = { newId: () => "new-provider" };
  const repo = new MediaProviderCredentialVaultRepo({ vault, policy, idGen });
  for (const provider of ["edited", "cleared", "unmentioned"]) {
    await vault.put({ expectedRevision: null, record: {
      workspaceId: WORKSPACE_ID, id: provider, kind: "media-provider", ownerKey: "test", principalId: null, binding: null,
      provider, label: provider, meta: { baseUrl: null, model: "old" }, sealed: { keyId: "k", ciphertext: "sealed", nonce: "n", alg: "aes-256-gcm" },
      last4: "1234", tokenLength: 16, isDefault: false, revision: 1, createdAt: NOW, updatedAt: NOW,
    } });
  }
  const keyring = { activeKey: async () => ({ keyId: "k" }), derive: async () => new Uint8Array(32), deriveSigningSecret: async () => new Uint8Array(32) };
  const sealer = new AesGcmSecretSealer({ keyring });
  const storeDeps: MediaProviderCredentialRowDeps = {
    repo, vaultPolicy: policy, idGen, sealer, keyring, clock: { nowMs: () => Date.parse(NOW) },
    builtInProviderIds: new Set(["edited", "cleared", "unmentioned"]),
    credentialPolicy: { assertCredentialFreeField: () => {}, normalizeCredentialToken: ({ value }) => String(value) },
    credentialInputMessage: () => undefined, storageMessage: "storage unavailable",
    sha256Hex: ({ text }) => createHash("sha256").update(text).digest("hex"),
    createVault: ({ repo: source }) => new SecretsVaultService({ repo: source.vault!, keyring, sealer,
      metaParsers: createVaultMetaParsers({}), authorize: async () => {}, now: () => NOW, newId: idGen.newId }),
  };
  const deps: MediaBatchProvidersRouteDeps = {
    workspaceId: WORKSPACE_ID,
    applyProviderChanges: (input) => applyMediaProviderChanges({ deps: storeDeps, ...input }),
    saveErrorMappings: [{ matches: ({ err }) => err instanceof VaultError, status: 409, code: "TEST_CONFLICT" }],
    outwardErrorMessage: () => "provider conflict",
  };
  return { vault, deps };
}

it("a failed provider batch leaves the cleared provider and edited provider unchanged", async () => {
  const { vault, deps } = await batchFixture();
  const before = await vault.list({ workspaceId: WORKSPACE_ID, kind: "media-provider", ownerKey: "test", principalId: null });
  expect(before).toHaveLength(3);
  const applyBatch = vault.applyBatch.bind(vault);
  let operation = 0;
  const batch = vi.spyOn(vault, "applyBatch").mockImplementation(async ({ ops }) => applyBatch({ ops: ops.map(op => {
    if (++operation !== 2) return op;
    if ("put" in op) return { put: { ...op.put, expectedRevision: -1 } };
    if ("delete" in op) return { delete: { ...op.delete, expectedRevision: -1 } };
    return op;
  }) }));
  const { authorize, calls } = recordingAuthorize();
  const input = { body: { removes: ["cleared"], patches: [{ providerId: "edited", fields: { model: "new" } }] } };
  const run = () => mediaBatchProvidersRoute.handle({ input, deps, context: PRINCIPAL, authorize });

  expect([mediaBatchProvidersRoute.method, mediaBatchProvidersRoute.path]).toEqual(["patch", "/api/admin/v1/workspaces/:workspaceId/media/providers"]);
  expect(await refusalOf(run)).toEqual({ status: 409, body: { error: "provider conflict", code: "TEST_CONFLICT" } });
  expect(batch).toHaveBeenCalledTimes(1);
  expect(batch.mock.calls[0]?.[0].ops).toHaveLength(2);
  expect(await vault.list({ workspaceId: WORKSPACE_ID, kind: "media-provider", ownerKey: "test", principalId: null })).toEqual(before);
  expect(calls).toEqual([{ permission: "admin.integrations.manage", entityType: "media" }]);

  batch.mockImplementation(applyBatch);
  const reply = await run();
  const after = await vault.list({ workspaceId: WORKSPACE_ID, kind: "media-provider", ownerKey: "test", principalId: null });
  expect(after.find(row => row.provider === "cleared")).toBeUndefined();
  expect(after.find(row => row.provider === "edited")?.meta.model).toBe("new");
  expect(after.find(row => row.provider === "unmentioned")).toEqual(before.find(row => row.provider === "unmentioned"));
  expect(reply).toEqual({ ok: true, value: { status: 200, body: {
    edited: { model: "new", apiKeyConfigured: true, apiKeyHint: { length: 16, last4: "1234" }, apiKeyTail: "1234" },
    unmentioned: { model: "old", apiKeyConfigured: true, apiKeyHint: { length: 16, last4: "1234" }, apiKeyTail: "1234" },
  }, headers: { etag: expect.stringMatching(/^"mp1-[a-f0-9]{64}"$/) } } });
  expect(JSON.stringify(reply)).not.toContain("sealed");
  expect(JSON.stringify(reply)).not.toContain('"apiKey":');
});

it("a denied provider batch never reaches the service or changes the vault", async () => {
  const { vault, deps } = await batchFixture();
  const scope = { workspaceId: WORKSPACE_ID, kind: "media-provider", ownerKey: "test", principalId: null } as const;
  const before = await vault.list(scope);
  const apply = vi.fn(deps.applyProviderChanges);
  const { authorize } = recordingAuthorize(["admin.integrations.manage"]);
  const input = { body: { removes: ["cleared"], patches: [{ providerId: "edited", fields: { model: "new" } }] } };

  await expect(mediaBatchProvidersRoute.handle({ input, deps: { ...deps, applyProviderChanges: apply }, context: PRINCIPAL, authorize }))
    .rejects.toThrow("denied admin.integrations.manage");
  expect(apply).not.toHaveBeenCalled();
  expect(await vault.list(scope)).toEqual(before);
});

it.each([
  { label: "non-object batch", body: "invalid" },
  { label: "null batch", body: null },
  { label: "array batch", body: [] },
  { label: "unknown batch field", body: { removes: [], patches: [], provider: {} } },
  { label: "non-array removes", body: { removes: "old", patches: [] } },
  { label: "non-array patches", body: { removes: [], patches: "new" } },
  { label: "non-string removed id", body: { removes: ["old", 1], patches: [] } },
  { label: "non-object patch", body: { removes: [], patches: ["not a patch"] } },
  { label: "null patch", body: { removes: [], patches: [null] } },
  { label: "array patch", body: { removes: [], patches: [[]] } },
  { label: "unknown patch field", body: { removes: [], patches: [{ providerId: "new", fields: {}, extra: true }] } },
  { label: "non-string patch id", body: { removes: [], patches: [{ providerId: 1, fields: {} }] } },
  { label: "non-string editable value", body: { removes: [], patches: [{ providerId: "new", fields: { model: 34 } }] } },
])("refuses $label without applying any provider changes", async ({ body }) => {
  const applyProviderChanges = vi.fn<MediaBatchProvidersRouteDeps["applyProviderChanges"]>();
  const { authorize, calls } = recordingAuthorize();
  const parsed = await mediaBatchProvidersRoute.parse({ body, query: {}, params: { workspaceId: WORKSPACE_ID } });
  if (!parsed.ok) throw new Error("the body must be validated only after authorization");
  expect(await refusalOf(() => mediaBatchProvidersRoute.handle({ input: parsed.value, context: PRINCIPAL, authorize, deps: {
    workspaceId: WORKSPACE_ID, applyProviderChanges, saveErrorMappings: [], outwardErrorMessage: () => "unexpected store failure",
  } }))).toStrictEqual({ status: 400, body: {
    error: "Send the settings for one provider only: its API key, base URL or model, each as text.",
    code: "MEDIA_PROVIDER_FIELDS_INVALID",
  } });
  expect(calls).toEqual([{ permission: "admin.integrations.manage", entityType: "media" }]);
  expect(applyProviderChanges).not.toHaveBeenCalled();
});
