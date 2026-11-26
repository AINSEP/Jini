import type { ImageGenerationPorts, ImageGenerationCredential as ProviderCredentials } from "@jini-ai/core/contracts/site/media-tool-ports";

/**
 * Resolves usable credentials for `providerId` — the saved workspace credential
 * ({@link resolveMediaProviderCredential}) first, falling through to
 * {@link resolveProviderCredentialsFromEnv} ONLY when nothing is saved at all (no row, or a row with
 * no key yet — both `null` from that function's own documented contract). A saved row that exists
 * but fails to DECRYPT throws `MediaProviderCredentialSecretStoreUnconfiguredError` from
 * `resolveMediaProviderCredential` itself and is deliberately NOT caught here — that is a broken
 * credential, not an absent one, and must surface as its own loud error rather than silently trying
 * the environment instead (see this file's own module doc).
 *
 * @returns `null` when neither source has anything usable — an absent/blank env value never counts
 *   as found (see `resolveProviderCredentialsFromEnv`'s own "`{}` when nothing set" contract).
 * @complexity O(1) beyond {@link resolveMediaProviderCredential}'s own cost (one workspace-scoped
 *   credential-row read, plus a decrypt only when a key is present).
 */
export async function resolveCredentialForProvider({ routeDeps, providerId }: { routeDeps: { workspaceId: string; providers: Pick<ImageGenerationPorts, "readSavedCredential"> & { readEnvCredential: (required: { providerId: string }, optional?: Record<string, never>) => ProviderCredentials } }; providerId: string }, _optional = {}): Promise<ProviderCredentials | null> {
  const saved = await routeDeps.providers.readSavedCredential({ workspaceId: routeDeps.workspaceId, providerId }, {});
  if (saved) {
    return { apiKey: saved.apiKey, ...(saved.baseUrl ? { baseUrl: saved.baseUrl } : {}) };
  }
  const fromEnv = routeDeps.providers.readEnvCredential({ providerId }, {});
  return fromEnv.apiKey ? fromEnv : null;
}

/**
 * Resolves which image model to use as the DEFAULT when the caller omits `model` — the first
 * catalog model (in `imageModelIds` (`agent-tools.ts`'s `IMAGE_MODEL_IDS` rule over the live registry) order) whose provider actually has a REACHABLE
 * credential (saved row first, then env — same precedence {@link resolveCredentialForProvider}
 * itself applies), not simply the catalog's `default: true` entry regardless of whether anything
 * can actually generate with it. `IMAGE_MODEL_IDS` already starts with that `default: true` entry
 * (`gpt-image-2`/openai), so this still resolves to it whenever OpenAI's own credential is the one
 * that succeeds — unchanged from before this function existed. Falls back to
 * {@link DEFAULT_MODEL} only when NO provider anywhere has a resolvable credential; the caller then
 * gets the same "no credential configured" rejection as always, just for whichever provider was
 * actually tried rather than a provider hardcoded independent of what this workspace has configured.
 * A saved credential's own image model (Admin -> Media providers) wins first, in catalog order.
 *
 * Each DISTINCT provider is checked at most once ({@link checkedProviders}) rather than once per
 * model — `IMAGE_MODEL_IDS` spans ~20 distinct providers, so re-checking a provider that already
 * failed (or already won) for each of its other models would be wasted, catalog-bounded I/O.
 *
 * @complexity O(P) credential lookups, P = the number of distinct providers among
 *   `IMAGE_MODEL_IDS` — a fixed, catalog-bounded count, never caller-controlled.
 */
export async function resolveDefaultImageModel({ routeDeps, imageModelIds, defaultModelId }: { routeDeps: Parameters<typeof resolveCredentialForProvider>[0]["routeDeps"] & { providers: Pick<ImageGenerationPorts, "readSavedSelections">; findModel: (required: { id: string }) => { provider: string } | undefined }; imageModelIds: readonly string[]; defaultModelId: string }, _optional = {}): Promise<string> {
  const saved = await routeDeps.providers.readSavedSelections({ workspaceId: routeDeps.workspaceId }, {});
  const savedModel = imageModelIds.find((id) => {
    const entry = saved[routeDeps.findModel({ id })?.provider ?? ""];
    return entry?.apiKeyConfigured === true && entry.model === id;
  });
  if (savedModel) return savedModel;
  const checkedProviders = new Set<string>();
  for (const modelId of imageModelIds) {
    // Non-null: every id in imageModelIds is derived from this same registry (agent-tools.ts).
    const model = routeDeps.findModel({ id: modelId });
    if (model == null) throw new Error(`Media generation registry has no model ${modelId}`);
    const providerId = model.provider;
    if (checkedProviders.has(providerId)) continue;
    checkedProviders.add(providerId);
    const credential = await resolveCredentialForProvider({ routeDeps, providerId });
    if (credential) return modelId;
  }
  return defaultModelId;
}
