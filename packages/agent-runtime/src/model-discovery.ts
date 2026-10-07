import { createHash } from 'node:crypto';
import type { RuntimeModelOption } from './types.js';
import type { AgentModelDiscoveryPort, DefaultModelResolution, DiscoveredModel, ModelCatalogSnapshot, ModelDiscoveryContext, ModelDiscoveryDeps, ModelProbeResult } from './model-discovery-types.js';
import { readModelConfiguration } from './model-discovery-config.js';
import { defaultModelDiscoveryDeps, probeAgentCatalog, modelProbeTimeoutMs } from './model-discovery-adapters.js';
export * from './model-discovery-types.js';
export const MODEL_CATALOG_TTL_MS = 15 * 60_000;
export const MODEL_NEGATIVE_TTL_MS = 30_000;
const MAX_CATALOG_SCOPES = 128;

export function modelIdentityKind(id: string): DiscoveredModel['identityKind'] {
  const token = id.slice(id.lastIndexOf('/') + 1);
  if (/^(default|auto|adaptive|smart|deep|rush|ultimate|premium|balanced|fast|vercel-ai-gateway|grok-build)$/i.test(token) || /(?:^|[-/])gateway$/i.test(id)) return 'routing-mode';
  if (/^(opus|sonnet|haiku|fable|best|latest|claude|gemini|gpt|codex|swe)(?:\[.*\])?$/i.test(token) || /(?:^|[-/])latest$/i.test(id)) return 'alias';
  return 'concrete';
}
export function normalizeDiscoveredModels(models: readonly RuntimeModelOption[]): DiscoveredModel[] {
  const seen = new Set<string>();
  return models.flatMap((row) => {
    if (!row.id || row.id === 'default' || seen.has(row.id)) return [];
    seen.add(row.id);
    const model = row as Partial<DiscoveredModel>;
    return [{ ...row, identityKind: model.identityKind ?? modelIdentityKind(row.id), ...(model.resolvedId ? { resolvedId: model.resolvedId } : {}) }];
  });
}
/** Hash all launch-affecting state, including env credentials; none of the raw material escapes. */
export function modelLaunchFingerprint(context: ModelDiscoveryContext, configMaterial = ''): string {
  return createHash('sha256').update(JSON.stringify({ ...context, env: Object.entries(context.env).sort(([a], [b]) => a.localeCompare(b)), configMaterial })).digest('hex');
}
class ProbeTimeout extends Error {}
const probePools = new WeakMap<ModelDiscoveryDeps, { active: number; queue: (() => void)[] }>();
/** Four simultaneous cold probes per host; queued callers keep cancellation responsive. */
async function boundedProbe<T>(deps: ModelDiscoveryDeps, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const pool = probePools.get(deps) || { active: 0, queue: [] };
  probePools.set(deps, pool);
  if (pool.active >= 4) {
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
/** Cancellation always reaches the effect port. A broken port cannot hold callers indefinitely. */
export async function withModelProbeTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  if (parent?.aborted) throw new ProbeTimeout('Probe cancelled');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    abortListener = () => { controller.abort(); reject(new ProbeTimeout('Probe cancelled')); };
    if (parent?.aborted) abortListener();
    else parent?.addEventListener('abort', abortListener, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new ProbeTimeout('Probe timed out')); }, timeoutMs);
  });
  try { return await Promise.race([work(controller.signal), stopped]); }
  finally { if (timer) clearTimeout(timer); if (abortListener) parent?.removeEventListener('abort', abortListener); }
}
function diagnostic(error: unknown): ModelCatalogSnapshot['diagnostics'][number] {
  // Never stringify vendor errors: stderr/HTTP bodies may include credentials or OAuth URLs.
  const code = error instanceof ProbeTimeout ? 'timeout' : error instanceof ModelProbeError ? error.code : 'offline';
  return { code, message: ({ timeout: 'Model discovery timed out or was cancelled.', 'auth-missing': 'CLI credentials are unavailable.', 'unsupported-version': 'Native metadata discovery is unavailable for this version.', 'malformed-response': 'Native metadata contained no usable catalog.', offline: 'Model discovery could not reach its source.' })[code] };
}
export class ModelProbeError extends Error {
  constructor(readonly code: ModelCatalogSnapshot['diagnostics'][number]['code']) { super(code); }
}
export interface AgentDiscoveryConfiguration {
  fallbackModels: () => readonly RuntimeModelOption[];
  parse?: (input: { stdout: string }) => RuntimeModelOption[] | null;
  args?: readonly string[];
}
export function createAgentModelDiscovery(agentId: string, configuration: AgentDiscoveryConfiguration): AgentModelDiscoveryPort {
  async function scoped(context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal?: AbortSignal) {
    const config = await withModelProbeTimeout((active) => readModelConfiguration(agentId, context, deps, active), 1000, signal);
    return { config, key: `${agentId}:${modelLaunchFingerprint(context, config.fingerprintMaterial)}` };
  }
  const port: AgentModelDiscoveryPort = {
    async discoverModels({ context }, { signal, force = false, deps = defaultModelDiscoveryDeps } = {}) {
      let state: Awaited<ReturnType<typeof scoped>>;
      try { state = await scoped(context, deps, signal); }
      catch (error) {
        return offlineSnapshot(modelLaunchFingerprint(context), deps.clock.now(), configuration.fallbackModels(), diagnostic(error));
      }
      const { key, config } = state;
      const fingerprint = key.slice(agentId.length + 1);
      const now = deps.clock.now();
      const cached = deps.cache.get(key) || {};
      if (cached.pending) return cached.pending;
      if (!force && cached.retryAt && cached.retryAt > now && cached.failed) return cached.failed;
      if (!force && !cached.failed && cached.good && Date.parse(cached.good.expiresAt) > now) return cached.good;
      const pending = (async (): Promise<ModelCatalogSnapshot> => {
        try {
          const result: ModelProbeResult = await boundedProbe(deps, () => withModelProbeTimeout((active) => probeAgentCatalog(agentId, context, configuration, deps, active), modelProbeTimeoutMs(agentId), signal), signal);
          const models = normalizeDiscoveredModels(result.models);
          if (models.length === 0) throw new ModelProbeError('malformed-response');
          const fetched = deps.clock.now();
          // Native default metadata outranks a config guess (Grok can route despite its TOML).
          const nativeWins = result.source === 'rpc' && !['claude', 'codebuddy'].includes(agentId) || agentId === 'grok-build';
          const selection = context.model || (nativeWins ? result.defaultSelectionId || config.selection : config.selection || result.defaultSelectionId);
          const snapshot: ModelCatalogSnapshot = { models, source: result.source, coverage: result.coverage,
            fetchedAt: new Date(fetched).toISOString(), expiresAt: new Date(fetched + MODEL_CATALOG_TTL_MS).toISOString(),
            freshness: result.source === 'cli-cache' ? 'stale' : 'fresh', launchFingerprint: fingerprint, diagnostics: [],
            ...(selection ? { defaultSelectionId: selection } : {}) };
          cached.good = snapshot; delete cached.retryAt; delete cached.failed;
          return snapshot;
        } catch (error) {
          cached.retryAt = deps.clock.now() + MODEL_NEGATIVE_TTL_MS;
          cached.failed = cached.good ? { ...cached.good, freshness: 'stale', diagnostics: [diagnostic(error)] } : offlineSnapshot(fingerprint, deps.clock.now(), configuration.fallbackModels(), diagnostic(error));
          return cached.failed;
        } finally { delete cached.pending; }
      })();
      cached.pending = pending; deps.cache.set(key, cached);
      // Evict settled scopes first; coalesced callers must retain their in-flight entry.
      for (const [oldKey, entry] of deps.cache) {
        if (deps.cache.size <= MAX_CATALOG_SCOPES) break;
        if (!entry.pending) deps.cache.delete(oldKey);
      }
      return pending;
    },
    async resolveDefaultModel({ context, catalog }, { signal, deps = defaultModelDiscoveryDeps } = {}): Promise<DefaultModelResolution> {
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
/** Resolve again against the actual launch scope, and pin the displayed concrete ID. */
export async function resolveModelForLaunch({ def, context }: { def: AgentModelDiscoveryPort & { supportsConcreteModelSelection?: boolean }; context: ModelDiscoveryContext }, optional: { deps?: ModelDiscoveryDeps; signal?: AbortSignal } = {}): Promise<{ model: string; catalog: ModelCatalogSnapshot; resolution: DefaultModelResolution }> {
  if (def.supportsConcreteModelSelection === false) throw new Error('This CLI cannot pin a concrete starting model.');
  const catalog = await def.discoverModels({ context }, { ...optional, ...(!context.model || modelIdentityKind(context.model) !== 'concrete' ? { force: true } : {}) });
  const resolution = await def.resolveDefaultModel({ context, catalog }, optional);
  if (resolution.status !== 'resolved') throw new Error(resolution.reason);
  return { model: resolution.id, catalog, resolution };
}
