/**
 * @module model-registry
 * Provider/model/agent picker vocabulary and credential-status, merge, cache and choice helpers.
 * registry.ts owns the CLI-adapter catalog, a distinct concept. Reuse the canonical protocol
 * catalog types and runtime diagnostic types rather than redefining looser copies.
 * ModelCatalogOption carries provider/hint/default/capability data; the protocol ACP ModelOption
 * is a narrower id/label probe shape, so their names and contracts stay separate.
 */
import type { AgentDefinition, CredentialStatus, ModelCatalogOption, ModelProvider } from '@jini-ai/protocol';


export interface AgentModelChoice {
  model?: string;
  reasoning?: string;
}

/**
 * Resolves a provider's credential status for display. A provider that
 * doesn't require credentials is always `available`; otherwise the status
 * depends on whether a credential has actually been stored.
 */
export function resolveCredentialStatus({ provider, hasStoredCredential }: { provider: Pick<ModelProvider, 'credentialsRequired'>; hasStoredCredential: boolean }
): CredentialStatus {
  if (provider.credentialsRequired === false) return 'available';
  return hasStoredCredential ? 'configured' : 'unconfigured';
}

/**
 * Merges a live-fetched model list with a static suggestion list, keeping
 * fetched entries first and deduping by id (first write wins). Blank ids are
 * dropped; blank labels fall back to the id.
 */
export function mergeModelOptions({ fetchedModels, suggestedModels }: { fetchedModels: readonly ModelCatalogOption[]; suggestedModels: readonly ModelCatalogOption[] }
): ModelCatalogOption[] {
  const seen = new Set<string>();
  const merged: ModelCatalogOption[] = [];
  const add = (model: ModelCatalogOption) => {
    const id = model.id.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    merged.push({ ...model, id, label: model.label.trim() || id });
  };
  for (const model of fetchedModels) add(model);
  for (const model of suggestedModels) add(model);
  return merged;
}

/** Deterministic, non-reversible fingerprint — never persist or transmit the raw credential. */
export function fingerprintCredential({ value }: { value: string }): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length}:${(hash >>> 0).toString(36)}`;
}

/**
 * A stable key for caching a fetched model catalogue, scoped to the
 * provider, endpoint, and credential in use — so switching any one of them
 * misses the cache instead of silently reusing another provider's list.
 * `variant` covers protocols that key on more than credential + endpoint
 * (e.g. an API version).
 * @throws {TypeError} When a supplied variant is not a string.
 */
export function modelCatalogCacheKey({ providerId, baseUrl, credential }: { providerId: string; baseUrl: string; credential: string }, { variant = '' }: { variant?: unknown } = {}
): string {
  if (typeof variant !== 'string') throw new TypeError('Model catalog variant must be a string');
  return [
    providerId,
    baseUrl.trim().replace(/\/+$/, ''),
    fingerprintCredential({ value: credential.trim() }),
    variant.trim(),
  ].join('\n');
}

/**
 * If `choice` names a model no longer in the agent's current catalogue,
 * falls back to the agent's first available model. Returns `null` when no
 * normalization is needed (nothing to change) or possible (no configured
 * model, or the agent has no models to fall back to).
 */
export function normalizeAgentModelChoice({ agent, choice }: { agent: Pick<AgentDefinition, 'models'> | null | undefined; choice: AgentModelChoice | undefined }
): AgentModelChoice | null {
  const configuredModel = typeof choice?.model === 'string' && choice.model ? choice.model : null;
  if (!configuredModel) return null;

  const modelIds = agent?.models?.map((model) => model.id) ?? [];
  if (modelIds.length === 0 || modelIds.includes(configuredModel)) return null;

  // modelIds.length === 0 already returned above, so index 0 always exists;
  // the `| undefined` in its type is only `noUncheckedIndexedAccess` noise.
  return { ...choice, model: modelIds[0]! };
}

/** `normalizeAgentModelChoice`'s result if normalization applied, else the original choice. */
export function effectiveAgentModelChoice({ agent, choice }: { agent: Pick<AgentDefinition, 'models'> | null | undefined; choice: AgentModelChoice | undefined }
): AgentModelChoice | undefined {
  return normalizeAgentModelChoice({ agent: agent, choice: choice }) ?? choice;
}

/**
 * Model/provider/agent catalogue vocabulary. Moved to `@jini-ai/protocol` on 2026-07-29 (see that
 * package's `agent-catalog.ts`) so a browser package can consume it without depending on this
 * Node-only runtime. Re-exported here so every existing import keeps working unchanged.
 */
export type {
  AgentDefinition,
  CredentialStatus,
  ModelCatalogOption,
  ModelProvider,
} from '@jini-ai/protocol';
