import { createHash } from 'node:crypto';
import type { RuntimeModelOption } from './types.js';
import type { AgentModelDiscoveryPort, AgentDiscoveryConfiguration, DefaultModelResolution, ModelCatalogSnapshot, ModelDiscoveryContext, ModelDiscoveryDeps, ModelDiscoveryProbes, ModelProbeResult } from './model-discovery-types.js';
import { readModelConfiguration } from './model-discovery-config.js';
import { ModelProbeError, ProbeTimeout, modelIdentityKind, normalizeDiscoveredModels, withModelProbeTimeout } from './model-discovery-shared.js';
export { ModelProbeError, modelIdentityKind, normalizeDiscoveredModels, withModelProbeTimeout } from './model-discovery-shared.js';
export type * from './model-discovery-types.js';
export const MODEL_CATALOG_TTL_MS = 15 * 60_000;
export const MODEL_NEGATIVE_TTL_MS = 30_000;
const MAX_CATALOG_SCOPES = 128;

/** Hash all launch-affecting state, including env credentials; none of the raw material escapes. */
export function modelLaunchFingerprint(context: ModelDiscoveryContext, configMaterial = ''): string {
  return createHash('sha256').update(JSON.stringify({ ...context, env: Object.entries(context.env).sort(([a], [b]) => a.localeCompare(b)), configMaterial })).digest('hex');
}
const probePools = new WeakMap<ModelDiscoveryDeps, { active: number; queue: (() => void)[] }>();
/** One cold catalog probe per host; queued callers keep cancellation responsive. */
async function boundedProbe<T>(deps: ModelDiscoveryDeps, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const pool = probePools.get(deps) || { active: 0, queue: [] };
  probePools.set(deps, pool);
  if (pool.active >= 1) {
    await new Promise<void>((resolve, reject) => {
      const ready = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { const index = pool.queue.indexOf(ready); if (index >= 0) pool.queue.splice(index, 1); reject(new ProbeTimeout('Probe cancelled')); };
      pool.queue.push(ready);
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
  } else pool.active += 1;
  try { if (signal?.aborted) throw new ProbeTimeout('Probe cancelled'); return await work(); }
  finally { const next = pool.queue.shift(); if (next) next(); else pool.active -= 1; }
}
function diagnostic(error: unknown): ModelCatalogSnapshot['diagnostics'][number] {
  // Never stringify vendor errors: stderr/HTTP bodies may include credentials or OAuth URLs.
  const code = error instanceof ProbeTimeout ? 'timeout' : error instanceof ModelProbeError ? error.code : 'offline';
  return { code, message: ({ timeout: 'Model discovery timed out or was cancelled.', 'auth-missing': 'CLI credentials are unavailable.', 'unsupported-version': 'Native metadata discovery is unavailable for this version.', 'malformed-response': 'Native metadata contained no usable catalog.', offline: 'Model discovery could not reach its source.' })[code] };
}
/** Bind supplied effect ports and probes without loading their native implementations. */
export function createAgentModelDiscovery(
  { agentId, configuration, deps: suppliedDeps, probes }: { agentId: string; configuration: AgentDiscoveryConfiguration; deps: ModelDiscoveryDeps; probes: ModelDiscoveryProbes },
  _optional: Record<string, never> = {},
): AgentModelDiscoveryPort {
  async function scoped(context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal?: AbortSignal) {
    const config = await withModelProbeTimeout((active) => readModelConfiguration(agentId, context, deps, active), 1000, signal);
    return { config, key: `${agentId}:${modelLaunchFingerprint(context, config.fingerprintMaterial)}` };
  }
  const port: AgentModelDiscoveryPort = {
    async discoverModels({ context }, { signal, force = false, staleWhileRevalidate = false, deps = suppliedDeps } = {}) {
      let state: Awaited<ReturnType<typeof scoped>>;
      try { state = await scoped(context, deps, signal); }
      catch (error) {
        return offlineSnapshot(modelLaunchFingerprint(context), deps.clock.now(), configuration.fallbackModels(), diagnostic(error));
      }
      const { key, config } = state;
      const fingerprint = key.slice(agentId.length + 1);
      const now = deps.clock.now();
      const cached = deps.cache.get(key) || {};
      const lastGood = () => cached.failed || (cached.good && {
        ...cached.good, freshness: Date.parse(cached.good.expiresAt) > now ? cached.good.freshness : 'stale' as const,
      });
      if (cached.pending) return staleWhileRevalidate && lastGood() || cached.pending;
      if (!force && cached.retryAt && cached.retryAt > now && cached.failed) return cached.failed;
      if (!force && !staleWhileRevalidate && !cached.failed && cached.good && Date.parse(cached.good.expiresAt) > now) return cached.good;
      // A fresh host process may still have a CLI-owned disk catalog. Use its observed rows
      // immediately; keep stale provenance and refresh without holding the first user prompt.
      if (staleWhileRevalidate && !cached.good && ['codex', 'opencode', 'claude', 'codebuddy'].includes(agentId)) {
        try {
          const disk = await withModelProbeTimeout(active => probes.cliCache({ agentId, context, deps, signal: active }), 1000, signal);
          const models = normalizeDiscoveredModels(disk.models);
          if (models.length) cached.good = { models, source: 'cli-cache', coverage: disk.coverage,
            freshness: 'stale', fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now).toISOString(),
            launchFingerprint: fingerprint, diagnostics: [],
            ...(config.selection ? { defaultSelectionId: config.selection } : {}) };
        } catch { /* No usable disk cache: keep the bounded cold-probe path below. */ }
        // Another caller may have started the refresh while disk metadata was read.
        const concurrent = deps.cache.get(key);
        if (concurrent?.pending) return concurrent.failed || concurrent.good || concurrent.pending;
      }
      const pending = (async (): Promise<ModelCatalogSnapshot> => {
        try {
          const result: ModelProbeResult = await boundedProbe(deps, () => withModelProbeTimeout((active) => probes.catalog({ agentId, context, configuration, deps, signal: active }), probes.timeoutMs({ agentId }), signal), signal);
          const models = normalizeDiscoveredModels(result.models);
          if (models.length === 0) throw new ModelProbeError('malformed-response');
          const fetched = deps.clock.now();
          // Native default metadata outranks a config guess (Grok can route despite its TOML).
          const nativeWins = result.source === 'rpc' && !['claude', 'codebuddy'].includes(agentId) || agentId === 'grok-build';
          const selection = context.model || (nativeWins ? result.defaultSelectionId || config.selection : config.selection || result.defaultSelectionId);
          // Disk fallbacks must let inventory readers retry live discovery after the failure cooldown.
          const ttl = result.source === 'cli-cache' ? MODEL_NEGATIVE_TTL_MS : MODEL_CATALOG_TTL_MS;
          const snapshot: ModelCatalogSnapshot = { models, source: result.source, coverage: result.coverage,
            fetchedAt: new Date(fetched).toISOString(), expiresAt: new Date(fetched + ttl).toISOString(),
            freshness: result.source === 'cli-cache' ? 'stale' : 'fresh', launchFingerprint: fingerprint, diagnostics: [],
            ...(selection ? { defaultSelectionId: selection } : {}) };
          cached.good = snapshot; delete cached.retryAt; delete cached.failed;
          return snapshot;
        } catch (error) {
          cached.retryAt = deps.clock.now() + MODEL_NEGATIVE_TTL_MS;
          // Outer inventory caches must retry failed refreshes on the negative lifetime too.
          cached.failed = cached.good ? { ...cached.good, freshness: 'stale', expiresAt: new Date(cached.retryAt).toISOString(), diagnostics: [diagnostic(error)] } : offlineSnapshot(fingerprint, deps.clock.now(), configuration.fallbackModels(), diagnostic(error));
          return cached.failed;
        } finally { delete cached.pending; }
      })();
      cached.pending = pending; deps.cache.set(key, cached);
      // Evict settled scopes first; coalesced callers must retain their in-flight entry.
      for (const [oldKey, entry] of deps.cache) {
        if (deps.cache.size <= MAX_CATALOG_SCOPES) break;
        if (!entry.pending) deps.cache.delete(oldKey);
      }
      // Explicit rescan still waits for live evidence. Launches retain the scoped last-good
      // catalog while this coalesced, timeout-bounded refresh updates the cache in the background.
      return staleWhileRevalidate && lastGood() || pending;
    },
    async resolveDefaultModel({ context, catalog }, { signal, deps = suppliedDeps } = {}): Promise<DefaultModelResolution> {
      let state: Awaited<ReturnType<typeof scoped>>;
      try { state = await scoped(context, deps, signal); } catch { return { status: 'unresolved', reason: 'Launch configuration could not be read.' }; }
      const fingerprint = state.key.slice(agentId.length + 1);
      if (fingerprint !== catalog.launchFingerprint) return { status: 'unresolved', reason: 'Launch configuration changed; refresh the catalog.' };
      if (context.resumeSessionId && !context.resumedModelId && !context.model) return { status: 'unresolved', reason: 'Resumed session model metadata is required.' };
      const selection = context.model || context.resumedModelId || catalog.defaultSelectionId || state.config.selection;
      if (!selection) return { status: 'unresolved', reason: 'Native metadata did not resolve a default; pick a concrete model.' };
      const row = catalog.models.find((model) => model.id === selection || model.label === selection);
      if (catalog.freshness === 'offline-fallback' && row && row.id !== selection) return { status: 'unresolved', selectionId: selection, reason: 'Offline hints cannot resolve a display name or alias.' };
      const id = row?.resolvedId || (row?.identityKind === 'concrete' ? row.id : undefined);
      if (!id || modelIdentityKind(id) !== 'concrete') return { status: 'unresolved', selectionId: selection, reason: 'The configured selection has no concrete model evidence.' };
      return { status: 'resolved', id, selectionId: selection, source: state.config.selection === selection ? 'config-file' : catalog.source, resolvedAt: new Date(deps.clock.now()).toISOString(), launchFingerprint: fingerprint };
    },
  };
  return port;
}
export function offlineSnapshot(fingerprint: string, now: number, fallback: readonly RuntimeModelOption[], issue?: ModelCatalogSnapshot['diagnostics'][number]): ModelCatalogSnapshot {
  return { models: normalizeDiscoveredModels(fallback), source: 'offline-fallback', freshness: 'offline-fallback', fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + MODEL_NEGATIVE_TTL_MS).toISOString(), coverage: 'configured', launchFingerprint: fingerprint, diagnostics: issue ? [issue] : [] };
}
/** Hosts may supply either discovery port independently; static definitions need no probes. */
export type ModelDiscoveryDefinition = Partial<AgentModelDiscoveryPort> & {
  id?: string;
  fallbackModels?: readonly RuntimeModelOption[];
  defaultModelEnvVar?: string;
  supportsCustomModel?: boolean;
  supportsConcreteModelSelection?: boolean;
};
export function modelDiscoveryForDef(
  { def, deps: suppliedDeps }: { def: ModelDiscoveryDefinition; deps: ModelDiscoveryDeps },
  _optional: Record<string, never> = {},
): AgentModelDiscoveryPort {
  return {
    discoverModels: def.discoverModels?.bind(def) || (async ({ context }, { deps = suppliedDeps } = {}) => {
      const catalog = offlineSnapshot(modelLaunchFingerprint(context), deps.clock.now(), def.fallbackModels || []);
      const configured = def.defaultModelEnvVar && context.env[def.defaultModelEnvVar]?.trim();
      // Static hosts used their first concrete fallback before discovery existed. Preserve
      // that contract while letting a declared env default or explicit selection take precedence.
      const selection = context.model || context.resumedModelId || configured || catalog.models.find(row => row.identityKind === 'concrete')?.id;
      return { ...catalog, ...(selection ? { defaultSelectionId: selection } : {}) };
    }),
    resolveDefaultModel: def.resolveDefaultModel?.bind(def) || (async ({ context, catalog }, { deps = suppliedDeps } = {}) => {
      if (context.resumeSessionId && !context.resumedModelId && !context.model) return { status: 'unresolved', reason: 'Resumed session model metadata is required.' };
      const configured = def.defaultModelEnvVar && context.env[def.defaultModelEnvVar]?.trim();
      const selection = context.model || context.resumedModelId || configured || catalog.defaultSelectionId;
      const row = catalog.models.find(model => model.id === selection || model.label === selection);
      // A host's declared env default is authoritative even when its static hints lag behind.
      const id = row?.resolvedId || (row?.identityKind === 'concrete' ? row.id : undefined)
        || (configured === selection && configured ? configured : undefined);
      if (!id || modelIdentityKind(id) !== 'concrete') return { status: 'unresolved', ...(selection ? { selectionId: selection } : {}), reason: 'The configured selection has no concrete model evidence.' };
      return { status: 'resolved', id, ...(selection ? { selectionId: selection } : {}), source: configured === selection ? 'config-file' : catalog.source,
        resolvedAt: new Date(deps.clock.now()).toISOString(), launchFingerprint: catalog.launchFingerprint };
    }),
  };
}
/** Resolve against the actual launch scope, pinning the same ID shown by the picker. */
export async function resolveModelForLaunch({ def, context, deps }: { def: ModelDiscoveryDefinition; context: ModelDiscoveryContext; deps: ModelDiscoveryDeps }, optional: { signal?: AbortSignal } = {}): Promise<{ model: string; catalog: ModelCatalogSnapshot; resolution: DefaultModelResolution }> {
  if (def.supportsConcreteModelSelection === false) throw new Error('This CLI cannot pin a concrete starting model.');
  const discovery = modelDiscoveryForDef({ def, deps });
  const catalog = await discovery.discoverModels({ context }, { ...optional, deps, staleWhileRevalidate: true });
  // Custom input is allowed unless the definition explicitly disables it: an unlisted user ID is already
  // the intended launch value. Never substitute a catalog default or reinterpret its spelling.
  const resolution: DefaultModelResolution = context.model && def.supportsCustomModel !== false && !catalog.models.some(row => row.id === context.model)
    ? { status: 'resolved', id: context.model, selectionId: context.model, source: 'config-file', resolvedAt: new Date(deps.clock.now()).toISOString(), launchFingerprint: catalog.launchFingerprint }
    : await discovery.resolveDefaultModel({ context, catalog }, { ...optional, deps });
  if (resolution.status !== 'resolved') throw new Error(resolution.reason);
  return { model: resolution.id, catalog, resolution };
}
