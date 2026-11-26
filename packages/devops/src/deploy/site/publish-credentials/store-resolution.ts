import type { UUID } from '@jini-ai/core/primitives';
import type { SecretSealerPort, VaultSummary } from '@jini-ai/core/contracts/vault';
import type { DeployTargetRegistry, DeployTargetCredentialSpec } from '../deploy-targets/types.js';
import type { PublishConnectionInput, PublishProviderId } from './types.js';
import { PublishCredentialSecretStoreUnconfiguredError, bound, vault, inventory, scopeOfRow, providerContract, publishHostsForCredential, selectPublishCredential, type PublishCredentialReadDeps, type VendorCredentialSetRecord, type VendorCredentialSetRepoPort } from './store.js';

/** The store holding vendor row `id`: this site's, else the project's when one is attached (ids are
 *  unique across both). Never opens a row. @complexity At most one lookup. */
export async function ownerOf<R extends Pick<VendorCredentialSetRepoPort, "findById" | "project">>(repo: R, input: { workspaceId: string; id: string }): Promise<{ repo: R | VendorCredentialSetRepoPort; workspaceId: string }> {
  const project = repo.project;
  if (!project || await repo.findById(input)) return { repo, workspaceId: input.workspaceId };
  return { repo: project.repo, workspaceId: project.workspaceId };
}

/** The vendor row with this id from whichever store holds it — this site's or the project's. */
export async function findPublishCredentialRecord(deps: { repo: Pick<VendorCredentialSetRepoPort, "findById" | "project"> },
  input: { workspaceId: UUID; id: UUID }): Promise<VendorCredentialSetRecord | null> {
  const owner = await ownerOf(deps.repo, input);
  return owner.repo.findById({ workspaceId: owner.workspaceId, id: input.id });
}

/** Jini checks exact ownership before opening. Keep the typed error used by HTTP and daemon
 * boundaries: a missing key must not become an unhandled rejection in a publishing process. */
export async function decryptRecord({ deps, record, providerId }: { deps: PublishCredentialResolveDeps; record: VendorCredentialSetRecord; providerId: PublishProviderId }, _options = {}): Promise<PublishConnectionInput> {
  try {
    const resolved = await vault(deps).get({ ...bound(deps).scope({ workspaceId: record.workspaceId, kind: "vendor" }), id: record.id });
    if (!resolved?.payload) throw new PublishCredentialSecretStoreUnconfiguredError(deps.storageMessage);
    const { vendorId: _vendorId, ...fields } = resolved.payload as Record<string, string>;
    return { ...fields, providerId };
  } catch { throw new PublishCredentialSecretStoreUnconfiguredError(deps.storageMessage); }
}

export interface PublishCredentialResolveDeps extends PublishCredentialReadDeps {
  sealer: SecretSealerPort;
}

/** Resolve exactly one compatible row. Recheck metadata from the same read as its payload so
 * concurrent compatibility edits cannot pair an ineligible secret with an old selection.
 * @throws PublishCredentialSecretStoreUnconfiguredError on crypto or payload failure.
 * @complexity O(rows × hosts + payload), one metadata inventory and one selected open.
 */
export async function resolveForPublish(deps: PublishCredentialResolveDeps,
  input: { workspaceId: UUID; id: UUID; providerId?: PublishProviderId },
): Promise<{ providerId: PublishProviderId; vendorId: string; label: string; isDefault: boolean; connection: PublishConnectionInput } | null> {
  const registry = await deps.loadDeployTargets({ workspaceId: input.workspaceId });
  const rows = await inventory({ deps, workspaceId: input.workspaceId });
  return resolveFromInventory({ deps, input, registry, rows });
}

/** Open the selected credential through Jini using one already-authorized inventory.
 * Both resolution entrypoints share compatibility rechecks and connection projection.
 * @throws PublishCredentialSecretStoreUnconfiguredError on crypto or payload failure.
 * @complexity O(rows × compatibility IDs + payload); one selected row read/open, no list reads.
 */
async function resolveFromInventory({ deps, input, registry, rows }: {
  deps: PublishCredentialResolveDeps; input: { workspaceId: UUID; id: UUID; providerId?: PublishProviderId };
  registry: DeployTargetRegistry; rows: VaultSummary[];
}, _options = {}): ReturnType<typeof resolveForPublish> {
  const candidate = rows.find(row => row.id === input.id);
  const providerId = selectedCandidateProviderId({ deps, explicitId: input.providerId, candidate, registry });
  if (!candidate || !providerId) return null;
  const provider = providerContract({ registry, providerId });
  if (!provider || !selectPublishCredential({ deps, registry, credentials: rows, provider, id: input.id })) return null;
  return resolveSelectedPublishCredential({ deps, input, registry, rows, candidate, providerId, provider });
}

async function resolveSelectedPublishCredential({ deps, input, registry, rows, candidate, providerId, provider }: {
  deps: PublishCredentialResolveDeps; input: { workspaceId: UUID; id: UUID; providerId?: PublishProviderId };
  registry: DeployTargetRegistry; rows: VaultSummary[]; candidate: VaultSummary; providerId: PublishProviderId;
  provider: NonNullable<ReturnType<typeof providerContract>>;
}): ReturnType<typeof resolveForPublish> {
  const resolved = await openPublishVaultRecord({ deps, input, candidate });
  if (!resolved || !selectPublishCredential({ deps, registry, credentials: [resolved.summary], provider, id: input.id })) return null;
  const spec = registry.get(providerId)?.descriptor.credential;
  if (!spec) return null;
  const connection = publishConnectionFromPayload({ deps, providerId, spec,
    summary: resolved.summary, payload: resolved.payload });
  return { providerId, vendorId: provider.vendorId, label: resolved.summary.label,
    isDefault: selectPublishCredential({ deps, registry, credentials: rows, provider })?.id === input.id, connection };
}

function selectedCandidateProviderId({ deps, explicitId, candidate, registry }: {
  deps: PublishCredentialReadDeps;
  explicitId: string | undefined; candidate: VaultSummary | undefined; registry: DeployTargetRegistry;
}, _options = {}): string | undefined {
  if (explicitId !== undefined) return explicitId;
  if (!candidate) return undefined;
  return publishHostsForCredential({ deps, credential: candidate, registry })[0];
}

/** Crypto faults retain the established typed refusal and never echo payloads. */
async function openPublishVaultRecord({ deps, input, candidate }: {
  deps: PublishCredentialResolveDeps; input: { workspaceId: UUID; id: UUID }; candidate: VaultSummary;
}, _options = {}) {
  // Opened with the store that sealed it: this site's, or the project's (`credentialScopes`).
  const scoped = scopeOfRow(deps, { workspaceId: input.workspaceId, row: candidate });
  try { return await vault(scoped.deps).get({ ...bound(scoped.deps).scope({ workspaceId: scoped.workspaceId, kind: candidate.kind === "custom" ? "custom" : "vendor" }), id: input.id }); }
  catch { throw new PublishCredentialSecretStoreUnconfiguredError(deps.storageMessage); }
}

function publishConnectionFromPayload({ deps, providerId, spec, summary, payload }: {
  deps: PublishCredentialReadDeps; providerId: string; spec: DeployTargetCredentialSpec; summary: VaultSummary; payload: unknown;
}, _options = {}): PublishConnectionInput {
  if (!payload) throw new PublishCredentialSecretStoreUnconfiguredError(deps.storageMessage);
  const { vendorId: _vendorId, ...fields } = payload as Record<string, string>;
  // A custom payload with no token becomes the blank token the check below refuses.
  const connection = summary.meta.credentialType === "custom" ? { providerId, [spec.tokenField]: fields.token ?? "" } : { ...fields, providerId };
  const token = connection[spec.tokenField];
  if (typeof token !== "string" || !token.trim()) throw new PublishCredentialSecretStoreUnconfiguredError(deps.storageMessage);
  return connection;
}

/** The same selection policy serves implicit publishing, readiness and explicit-ID resolution.
 * @complexity O(rows × compatibility IDs + payload); one two-kind inventory and one selected open.
 */
export async function resolveDefaultForPublish(deps: PublishCredentialResolveDeps,
  input: { workspaceId: UUID; providerId: PublishProviderId },
): Promise<{ id: UUID; label: string; connection: PublishConnectionInput } | null> {
  const registry = await deps.loadDeployTargets({ workspaceId: input.workspaceId });
  const provider = providerContract({ registry, providerId: input.providerId });
  if (!provider) return null;
  const rows = await inventory({ deps, workspaceId: input.workspaceId });
  const selected = selectPublishCredential({ deps, registry, credentials: rows, provider });
  if (!selected) return null;
  const resolved = await resolveFromInventory({ deps, input: { ...input, id: selected.id }, registry, rows });
  return resolved ? { id: selected.id, label: resolved.label, connection: resolved.connection } : null;
}

/** Configuration requires a compatible selected candidate, not merely a provider-group default.
 * An explicit id must select that authorized row; no secret is opened.
 * @complexity O(rows × compatibility IDs), one metadata inventory per store and one catalog load. */
export async function hasDefaultForPublish(deps: PublishCredentialReadDeps, input: { workspaceId: UUID; providerId: PublishProviderId; id?: UUID }): Promise<boolean> {
  const registry = await deps.loadDeployTargets({ workspaceId: input.workspaceId });
  const provider = providerContract({ registry, providerId: input.providerId });
  return provider !== null && selectPublishCredential({ deps, registry, credentials: await inventory({ deps, workspaceId: input.workspaceId }), provider, id: input.id }) !== null;
}

