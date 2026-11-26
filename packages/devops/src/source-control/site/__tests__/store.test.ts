import { CREDENTIAL_MESSAGES, CredentialInputError, normalizeCredentialToken } from "@jini-ai/platform/secrets/credential-token";
import { credentialScopes, credentialCreateTarget } from "@jini-ai/integrations/vendor-credentials/project-scope";
import { expect, it, vi } from "vitest";
import { SecretsVaultService, InMemoryVaultRepo, createVaultMetaParsers } from "@jini-ai/platform/secrets/credential-sets";
import { CredentialSetVaultAdapter, toSourceControlCredentialRecord } from "@jini-ai/integrations/vendor-credentials/vault-adapter";
import { createSourceControlCredential, updateSourceControlCredential, type SourceControlCredentialWriteDeps } from "../store.js";

function fixture() {
  const vault = new InMemoryVaultRepo({});
  const policy = { ownerKey: "host", acceptedKinds: ["source-control"], metaParsers: createVaultMetaParsers({}), openService: (required: ConstructorParameters<typeof SecretsVaultService>[0]) => new SecretsVaultService(required) };
  const repo = new CredentialSetVaultAdapter({ vault, kind: "source-control", policy, projectRecord: toSourceControlCredentialRecord });
  const descriptor = { id: "git", label: "Git", apiOrigin: "https://git.example", module: "git.mjs", credential: { tokenField: "token", fields: [{ name: "token", label: "Token", required: true, secret: true }] } };
  const loadSourceControlProviders = vi.fn(async () => ({ get: () => ({ descriptor, module: {} }), list: () => [{ descriptor }], refusals: [] }));
  const buildSourceControlProvider = vi.fn(async () => { throw new Error("probe failed"); });
  const deps = { deps: { CREDENTIAL_MESSAGES, CredentialInputError, normalizeCredentialToken, credentialScopes, credentialCreateTarget }, repo, clock: { nowMs: () => 0 }, idGen: { newId: () => "credential" }, keyring: { activeKey: async () => ({ keyId: "k" }), derive: vi.fn(), deriveSigningSecret: vi.fn() },
    sealer: { seal: async ({ plaintext }: { plaintext: string }) => ({ keyId: "k", alg: "test", nonce: "nonce", ciphertext: plaintext }), open: async ({ sealed }: { sealed: { ciphertext: string } }) => sealed.ciphertext },
    loadSourceControlProviders, buildSourceControlProvider, assertCredentialFreeField: vi.fn(), isProjectKeyCreateConflictError: () => false,
  } as unknown as SourceControlCredentialWriteDeps;
  return { deps, vault, loadSourceControlProviders, buildSourceControlProvider };
}

it("a blank token patch preserves the saved envelope without probing", async () => {
  const f = fixture();
  await createSourceControlCredential({ deps: f.deps, input: { workspaceId: "w", label: "label", connection: { providerId: "git", token: "original-token" } } });
  const before = await f.vault.find({ workspaceId: "w", id: "credential" });
  f.buildSourceControlProvider.mockClear(); f.loadSourceControlProviders.mockClear();
  await updateSourceControlCredential({ deps: f.deps, input: { workspaceId: "w", id: "credential", connection: { token: "" } } });
  expect((await f.vault.find({ workspaceId: "w", id: "credential" }))?.sealed).toEqual(before?.sealed);
  expect(f.buildSourceControlProvider).not.toHaveBeenCalled(); expect(f.loadSourceControlProviders).not.toHaveBeenCalled();
});

it("a failed identity probe leaves the newly saved credential intact", async () => {
  const f = fixture();
  const patch = vi.spyOn(f.vault, "patchMeta");
  const result = await createSourceControlCredential({ deps: f.deps, input: { workspaceId: "w", label: "label", connection: { providerId: "git", token: "original-token" } } });
  expect(result).toMatchObject({ configured: true, connection: "saved", accountLabel: null });
  expect((await f.vault.find({ workspaceId: "w", id: "credential" }))?.sealed?.ciphertext).toBe('{"providerId":"git","token":"original-token"}');
  expect(patch).not.toHaveBeenCalled();
});
