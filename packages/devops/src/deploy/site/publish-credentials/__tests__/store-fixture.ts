import { VendorCredentialSetVaultRepo } from "@jini-ai/integrations/vendor-credentials/vault-adapter";
import { credentialScopes, credentialCreateTarget } from "@jini-ai/integrations/vendor-credentials/project-scope";
import { assertCredentialFreeField, CredentialInputError, normalizeCredentialToken } from "@jini-ai/platform/secrets/credential-token";
import { SecretsVaultService, InMemoryVaultRepo, createVaultMetaParsers, matchingCredentialProviderIds, normalizeCredentialWorksFor, selectCredentialForProvider } from "@jini-ai/platform/secrets/credential-sets";
import type { DeployTargetRegistry, LoadedDeployTarget, DeployTargetFieldSpec } from "../../deploy-targets/types.js";
import type { PublishCredentialWriteDeps } from "../store.js";
import { vi } from "vitest";

const token: DeployTargetFieldSpec = { name: "token", label: "Token", required: true };

export function credentialTarget(id: string, vendorId: string, fields: readonly DeployTargetFieldSpec[] = [token], tokenField = "token"): LoadedDeployTarget {
  return {
    descriptor: { id, label: id, module: `${id}.mjs`, configFields: [], credential: { vendorId, tokenField, fields } },
    pluginId: id + "-plugin", module: { create: () => { throw new Error("credential storage cannot deploy"); } },
  };
}

export function storeFixture(targets: readonly LoadedDeployTarget[], { withProject = false } = {}) {
  const registry: DeployTargetRegistry = { get: id => targets.find(target => target.descriptor.id === id), list: () => targets, refusals: [] };
  const ownerKey = "assistant";
  const metaParsers = createVaultMetaParsers({});
  const policy = { ownerKey, acceptedKinds: ["vendor", "custom"],
    metaParsers, openService: (required: ConstructorParameters<typeof SecretsVaultService>[0]) => new SecretsVaultService(required) };
  function store(keyId: string) {
    const vault = new InMemoryVaultRepo({});
    const keyring: PublishCredentialWriteDeps["keyring"] = {
      activeKey: async () => ({ keyId }), derive: async () => { throw new Error("unexpected derive"); },
      deriveSigningSecret: async () => { throw new Error("unexpected signing"); },
    };
    // The adapter and vault are real; the deterministic sealer stands in for the host's key store.
    const seal = vi.fn<PublishCredentialWriteDeps["sealer"]["seal"]>(async ({ plaintext, aad, key }) => ({
      keyId: key.keyId, nonce: aad, ciphertext: plaintext, alg: "test-only",
    }));
    const open = vi.fn<PublishCredentialWriteDeps["sealer"]["open"]>(async ({ sealed }, optional) => {
      if (sealed.keyId !== keyId || optional?.aad !== sealed.nonce) throw new Error("wrong key or scope");
      return sealed.ciphertext;
    });
    return { vault, keyring, sealer: { seal, open } };
  }
  const site = store("site-key");
  const project = store("project-key");
  const projectRepo = new VendorCredentialSetVaultRepo({ vault: project.vault, policy });
  const repo = new VendorCredentialSetVaultRepo({ vault: site.vault, policy }, withProject ? {
    project: { workspaceId: "project", repo: projectRepo, sealer: project.sealer, keyring: project.keyring },
  } : {});
  let id = 0;
  const deps: PublishCredentialWriteDeps = {
    repo, ownerKey, projectWorkspaceId: "project", loadDeployTargets: async () => registry,
    clock: { nowMs: () => 0 }, idGen: { newId: () => `key-${++id}` }, keyring: site.keyring, sealer: site.sealer,
    storageMessage: "The site credential store could not unlock the connection.",
    CredentialInputError, ProjectKeyCreateConflictError: class extends Error {},
    normalizeCredentialToken, normalizeCredentialWorksFor, matchingCredentialProviderIds, selectCredentialForProvider,
    assertCredentialFreeField: input => assertCredentialFreeField({ ...input, containsSecret: () => false }),
    credentialScopes, credentialCreateTarget,
    parseStoreMeta: ({ meta, provider }) => metaParsers.vendor({ meta, provider }),
  };
  return { deps, repo, registry, site, project, projectRepo };
}
