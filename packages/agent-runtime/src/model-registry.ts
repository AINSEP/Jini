/**
 * @module model-registry
 *
 * The provider/model/agent vocabulary that any Jini consumer picking "which
 * model" or "which coding agent" to run needs, plus the handful of pure
 * helpers (credential-status resolution, model-list merging, a stable cache
 * key, model-choice normalization against a live catalogue) those pickers
 * all independently re-derive today.
 *
 * Ported and generified from OD's `apps/web/src/state/config.ts`
 * (`KnownProvider`/`KNOWN_PROVIDERS`), `packages/contracts/src/api/registry.ts`
 * (`AgentInfo`/`AgentDiagnostic`/`AgentFixIntent`/`AgentModelOption`),
 * `packages/contracts/src/api/providerModels.ts` (`ProviderModelOption`),
 * `packages/contracts/src/api/app-config.ts` (`AgentModelPrefs`),
 * `apps/web/src/components/providerModelsCache.ts`, and
 * `apps/web/src/components/agentModelSelection.ts` — see
 * `packages/agent-runtime/source-map.md` for the full per-symbol mapping.
 * No OD product-identity strings or OD-specific gating (e.g. the original's
 * hardcoded `agent.id === 'amr'` carve-out) survived the port.
 *
 * Named `model-registry.ts`, not `registry.ts`: this package already has a
 * `registry.ts` (the `BASE_AGENT_DEFS` static CLI-adapter catalog +
 * `getAgentDef(id)`) — a different concept that happens to share the word
 * "registry". `AgentDiagnostic`/`AgentDiagnosticSeverity`/`AgentFixIntent`
 * are NOT redefined here either, for the same reason `ModelOption` isn't:
 * this package already has real, more complete versions of all three
 * (`./types.js`, vendored from the same OD `packages/contracts/src/api/
 * registry.ts` source this module cites above — main's `AgentFixIntent`
 * adds a `launchOAuth` case this port's copy lacked, and its
 * `AgentDiagnostic.reason` is the specific `AgentDiagnosticReason` literal
 * union rather than a bare `string`). Reusing them keeps one canonical
 * diagnostic shape in the package instead of two divergent ones under the
 * same names. `ModelOption` alone is renamed (to `ModelCatalogOption`)
 * rather than reused, because the package's existing `ModelOption`
 * (`agent-protocol/acp/models.ts`, `{ id, label }`) is a narrower,
 * genuinely different shape for ACP model-probe results, not a compatible
 * version of this module's `{ id, label, hint, providerId, default, caps }`
 * model-catalogue entry.
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
export function resolveCredentialStatus(
  provider: Pick<ModelProvider, 'credentialsRequired'>,
  hasStoredCredential: boolean,
): CredentialStatus {
  if (provider.credentialsRequired === false) return 'available';
  return hasStoredCredential ? 'configured' : 'unconfigured';
}

/**
 * Merges a live-fetched model list with a static suggestion list, keeping
 * fetched entries first and deduping by id (first write wins). Blank ids are
 * dropped; blank labels fall back to the id.
 */
export function mergeModelOptions(
  fetchedModels: readonly ModelCatalogOption[],
  suggestedModels: readonly ModelCatalogOption[],
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
export function fingerprintCredential(value: string): string {
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
 */
export function modelCatalogCacheKey(
  providerId: string,
  baseUrl: string,
  credential: string,
  variant = '',
): string {
  return [
    providerId,
    baseUrl.trim().replace(/\/+$/, ''),
    fingerprintCredential(credential.trim()),
    variant.trim(),
  ].join('\n');
}

/**
 * If `choice` names a model no longer in the agent's current catalogue,
 * falls back to the agent's first available model. Returns `null` when no
 * normalization is needed (nothing to change) or possible (no configured
 * model, or the agent has no models to fall back to).
 */
export function normalizeAgentModelChoice(
  agent: Pick<AgentDefinition, 'models'> | null | undefined,
  choice: AgentModelChoice | undefined,
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
export function effectiveAgentModelChoice(
  agent: Pick<AgentDefinition, 'models'> | null | undefined,
  choice: AgentModelChoice | undefined,
): AgentModelChoice | undefined {
  return normalizeAgentModelChoice(agent, choice) ?? choice;
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
