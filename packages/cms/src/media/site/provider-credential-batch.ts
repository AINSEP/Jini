import { nowIso } from "@jini-ai/core/primitives";
import type { UUID } from "@jini-ai/core/primitives";
import { resolveMediaCredentialIds } from "./provider-credential-vault.js";
import {
  assertValidEntry, buildProviderUpsertRow, getMediaProviderCredentialsModel, mergedPatchEntry,
  MediaProviderCredentialValidationError, rethrowAsValidation, sealNewProviderKeys,
  type MediaProviderCredentialInput, type MediaProviderCredentialReadModel, type MediaProviderCredentialRowDeps,
} from "./provider-credential-store.js";

export interface ApplyMediaProviderChangesRequired {
  deps: MediaProviderCredentialRowDeps;
  workspaceId: UUID;
  removes: readonly string[];
  patches: readonly { providerId: string; fields: MediaProviderCredentialInput }[];
}

export async function applyMediaProviderChanges(
  { deps, workspaceId, removes, patches }: ApplyMediaProviderChangesRequired,
  _optional = {},
): Promise<MediaProviderCredentialReadModel> {
  const policy = deps.credentialPolicy;
  const removedIds = removes.flatMap(providerId => {
    rethrowAsValidation({ credentialInputMessage: deps.credentialInputMessage,
      run: () => policy.assertCredentialFreeField({ value: providerId, field: "providerId" }) });
    const { writeId, readIds } = resolveMediaCredentialIds({ providerId, policy: deps.vaultPolicy });
    return providerId === writeId ? readIds : [providerId];
  });
  const removed = new Set(removedIds);
  const patched = new Set(patches.map(({ providerId }) => providerId));
  if (removed.size !== removedIds.length || patched.size !== patches.length || patches.some(({ providerId }) => removed.has(providerId))) {
    throw new MediaProviderCredentialValidationError("provider changes must not contain duplicate or overlapping ids");
  }
  for (const { providerId, fields } of patches) {
    assertValidEntry({ providerId, entry: fields, catalog: deps.providerCatalog, policy,
      builtInProviderIds: deps.builtInProviderIds, credentialInputMessage: deps.credentialInputMessage });
  }
  const now = nowIso({ clock: deps.clock });
  const sealed = await sealNewProviderKeys(deps, { workspaceId,
    providers: Object.fromEntries(patches.map(({ providerId, fields }) => [providerId, fields])) }, policy);
  await deps.repo.replaceWorkspace({ workspaceId, plan: ({ existing: existingRows }) => {
    const existingByProviderId = new Map(existingRows.map(row => [row.providerId, row]));
    const upserts = patches.map(({ providerId, fields }) => {
      const existing = existingByProviderId.get(providerId);
      const entry = mergedPatchEntry({ fields, existing });
      return buildProviderUpsertRow({ workspaceId, providerId, entry, existing,
        fresh: sealed.get(providerId), now, vaultPolicy: deps.vaultPolicy });
    });
    return { upserts, tombstoneProviderIds: removedIds };
  } });
  return getMediaProviderCredentialsModel({ deps, workspaceId });
}
