import type { CredentialTokenHint } from '@jini-ai/core/contracts/site/secrets-credential-token';
import type { MediaProviderCredentialRepoPort } from '../site/provider-credential-contracts.js';

/**
 * Saves one human-submitted key using the admin PUT's validation/sealing/save path.
 * Adapts its whole-set planner to a single-provider patch INSIDE the repo transaction: unrelated
 * rows are never tombstoned or rewritten, and current model/baseUrl metadata is preserved.
 * @param input - Existing write dependencies, workspace, canonical provider id and human key.
 * @returns Only whether the saved provider now has a key; never the store's key-tail markers.
 * @throws The existing store's validation, sealing or persistence errors; callers must not echo them.
 * @complexity Time O(n), space O(n), bounded by the canonical provider catalogue.
 * @example await saveMediaProviderKey({ deps, workspaceId, provider: 'openai', apiKey: humanKey });
 */
export async function saveMediaProviderKey<D extends { repo: Pick<MediaProviderCredentialRepoPort, 'replaceWorkspace' | 'vault'> }>(input: {
  deps: D; workspaceId: string; provider: string; apiKey: string;
  saveProviders: (required: { deps: D; workspaceId: string }, optional: { providers: Record<string, { apiKey: string }> }) => Promise<Record<string, { apiKeyConfigured?: boolean | undefined; apiKeyHint?: CredentialTokenHint | null | undefined }>>;
}, _optional = {}): Promise<{ configured: boolean; tokenHint: CredentialTokenHint | null }> {
  const { deps, workspaceId, provider, apiKey, saveProviders } = input;
  // Only `replaceWorkspace`: the store's save writes through nothing else.
  const repo: Pick<MediaProviderCredentialRepoPort, 'replaceWorkspace' | 'vault'> = {
    ...(deps.repo.vault ? { vault: deps.repo.vault } : {}),
    replaceWorkspace: spec => deps.repo.replaceWorkspace({
      workspaceId: spec.workspaceId,
      // Pure synchronous merge runs on CURRENT rows, after sealing, with no stale pre-read map.
      plan: ({ existing: current }) => {
        const patch = spec.plan({ existing: current });
        const existing = current.find(row => row.providerId === provider);
        return { tombstoneProviderIds: [], upserts: patch.upserts.map(row => {
          const merged = { ...row, baseUrl: existing?.baseUrl ?? null, model: existing?.model ?? null };
          Object.defineProperty(merged, 'vaultRecord', { value: row.vaultRecord });
          return merged;
        }) };
      },
    }),
  };
  const saved = await saveProviders({ deps: { ...deps, repo }, workspaceId }, { providers: { [provider]: { apiKey } } });
  return { configured: saved[provider]?.apiKeyConfigured === true, tokenHint: saved[provider]?.apiKeyHint ?? null };
}
