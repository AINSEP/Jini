import { createHash } from 'node:crypto';
import type { RuntimeModelOption } from './types.js';
import type { AgentModelDiscoveryPort, AgentDiscoveryConfiguration, DefaultModelResolution, DiscoveredModel, ModelCacheEntry, ModelCatalogSnapshot, ModelDiscoveryContext, ModelDiscoveryDeps, ModelDiscoveryProbes, ModelProbeResult } from './model-discovery-types.js';
import { readModelConfiguration } from './model-discovery-config.js';
import { ModelProbeError, ProbeTimeout, modelIdentityKind, normalizeDiscoveredModels, withModelProbeTimeout } from './core/model-discovery-shared.js';
export { ModelProbeError, modelIdentityKind, normalizeDiscoveredModels, withModelProbeTimeout } from './core/model-discovery-shared.js';
export type * from './model-discovery-types.js';
export const MODEL_CATALOG_TTL_MS = 15 * 60_000;
export const MODEL_NEGATIVE_TTL_MS = 30_000;
const MAX_CATALOG_SCOPES = 128;
/** CLIs that keep their own on-disk model catalog a fresh host can read before probing. */
const DISK_CATALOG_AGENTS = ['codex', 'opencode', 'claude', 'codebuddy'];
/** Agents whose config-file selection outranks native rpc default metadata. */
const CONFIG_FIRST_AGENTS = ['claude', 'codebuddy'];
const NO_CONCRETE_EVIDENCE = 'The configured selection has no concrete model evidence.';
const RESUMED_MODEL_REQUIRED: DefaultModelResolution = { status: 'unresolved', reason: 'Resumed session model metadata is required.' };

type Diagnostic = ModelCatalogSnapshot['diagnostics'][number];
type ScopedConfiguration = { selection?: string; fingerprintMaterial: string };

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
const DIAGNOSTIC_MESSAGES: Record<Diagnostic['code'], string> = {
  timeout: 'Model discovery timed out or was cancelled.',
  'auth-missing': 'CLI credentials are unavailable.',
  'unsupported-version': 'Native metadata discovery is unavailable for this version.',
  'malformed-response': 'Native metadata contained no usable catalog.',
  offline: 'Model discovery could not reach its source.',
};
function diagnostic(error: unknown): Diagnostic {
  // Never stringify vendor errors: stderr/HTTP bodies may include credentials or OAuth URLs.
  const code = error instanceof ProbeTimeout ? 'timeout' : error instanceof ModelProbeError ? error.code : 'offline';
  return { code, message: DIAGNOSTIC_MESSAGES[code] };
}
function isUnexpired(snapshot: ModelCatalogSnapshot, now: number): boolean {
  return Date.parse(snapshot.expiresAt) > now;
}
/** What a stale-while-revalidate caller may see: a recorded failure, else the last good catalog aged to `stale` once expired. */
function lastGoodSnapshot(cached: ModelCacheEntry, now: number): ModelCatalogSnapshot | undefined {
  if (cached.failed) return cached.failed;
  if (!cached.good) return undefined;
  return { ...cached.good, freshness: isUnexpired(cached.good, now) ? cached.good.freshness : 'stale' };
}
/** A cached catalog that needs no refresh: the cooling-down failure, else an unexpired good catalog. */
function settledAnswer(cached: ModelCacheEntry, now: number, { staleWhileRevalidate }: { staleWhileRevalidate: boolean }): ModelCatalogSnapshot | undefined {
  if (cached.retryAt && cached.retryAt > now && cached.failed) return cached.failed;
  if (staleWhileRevalidate || cached.failed || !cached.good) return undefined;
  return isUnexpired(cached.good, now) ? cached.good : undefined;
}
/** Answer from the scope's cache entry, or undefined when a refresh must start. */
function cachedAnswer(
  { cached, now }: { cached: ModelCacheEntry; now: number },
  { force, staleWhileRevalidate }: { force: boolean; staleWhileRevalidate: boolean },
): ModelCatalogSnapshot | Promise<ModelCatalogSnapshot> | undefined {
  if (cached.pending) return (staleWhileRevalidate && lastGoodSnapshot(cached, now)) || cached.pending;
  return force ? undefined : settledAnswer(cached, now, { staleWhileRevalidate });
}
/** Native default metadata outranks a config guess (Grok can route despite its TOML). */
function pickSelection({ agentId, context, configSelection, result }: { agentId: string; context: ModelDiscoveryContext; configSelection: string | undefined; result: ModelProbeResult }): string | undefined {
  if (context.model) return context.model;
  const nativeWins = result.source === 'rpc' && !CONFIG_FIRST_AGENTS.includes(agentId) || agentId === 'grok-build';
  return nativeWins ? result.defaultSelectionId || configSelection : configSelection || result.defaultSelectionId;
}
function liveSnapshot({ models, result, fingerprint, selection, fetched }: { models: DiscoveredModel[]; result: ModelProbeResult; fingerprint: string; selection: string | undefined; fetched: number }): ModelCatalogSnapshot {
  // Disk fallbacks must let inventory readers retry live discovery after the failure cooldown.
  const fromDisk = result.source === 'cli-cache';
  const ttl = fromDisk ? MODEL_NEGATIVE_TTL_MS : MODEL_CATALOG_TTL_MS;
  return { models, source: result.source, coverage: result.coverage,
    fetchedAt: new Date(fetched).toISOString(), expiresAt: new Date(fetched + ttl).toISOString(),
    freshness: fromDisk ? 'stale' : 'fresh', launchFingerprint: fingerprint, diagnostics: [],
    ...(selection ? { defaultSelectionId: selection } : {}) };
}
/** Evict settled scopes first; coalesced callers must retain their in-flight entry. */
function evictSettledScopes(cache: ModelDiscoveryDeps['cache']): void {
  for (const [oldKey, entry] of cache) {
    if (cache.size <= MAX_CATALOG_SCOPES) break;
    if (!entry.pending) cache.delete(oldKey);
  }
}
function missingResumedModel(context: ModelDiscoveryContext): boolean {
  return Boolean(context.resumeSessionId && !context.resumedModelId && !context.model);
}
function findRow(models: readonly DiscoveredModel[], selection: string): DiscoveredModel | undefined {
  return models.find((model) => model.id === selection || model.label === selection);
}
/** The launch ID a catalog row vouches for: its resolved ID, or its own ID when concrete. */
function rowEvidence(row: DiscoveredModel | undefined): string | undefined {
  return row?.resolvedId || (row?.identityKind === 'concrete' ? row.id : undefined);
}
function isConcreteId(id: string | undefined): id is string {
  return Boolean(id) && modelIdentityKind(id as string) === 'concrete';
}
function catalogSelection({ context, catalog, configSelection }: { context: ModelDiscoveryContext; catalog: ModelCatalogSnapshot; configSelection: string | undefined }): string | undefined {
  return context.model || context.resumedModelId || catalog.defaultSelectionId || configSelection;
}
/** Offline hints carry no alias metadata, so only an exact ID match is trustworthy. */
function isOfflineLabelMatch({ catalog, row, selection }: { catalog: ModelCatalogSnapshot; row: DiscoveredModel | undefined; selection: string }): boolean {
  return catalog.freshness === 'offline-fallback' && row !== undefined && row.id !== selection;
}
/** Resolve a scoped catalog's selection to concrete launch evidence. Pure. */
function resolveFromCatalog(
  { context, catalog, configSelection, fingerprint, resolvedAt }: { context: ModelDiscoveryContext; catalog: ModelCatalogSnapshot; configSelection: string | undefined; fingerprint: string; resolvedAt: string },
): DefaultModelResolution {
  if (missingResumedModel(context)) return RESUMED_MODEL_REQUIRED;
  const selection = catalogSelection({ context, catalog, configSelection });
  if (!selection) return { status: 'unresolved', reason: 'Native metadata did not resolve a default; pick a concrete model.' };
  const row = findRow(catalog.models, selection);
  if (isOfflineLabelMatch({ catalog, row, selection })) return { status: 'unresolved', selectionId: selection, reason: 'Offline hints cannot resolve a display name or alias.' };
  const id = rowEvidence(row);
  if (!isConcreteId(id)) return { status: 'unresolved', selectionId: selection, reason: NO_CONCRETE_EVIDENCE };
  return { status: 'resolved', id, selectionId: selection, source: configSelection === selection ? 'config-file' : catalog.source, resolvedAt, launchFingerprint: fingerprint };
}
/** Bind supplied effect ports and probes without loading their native implementations. */
export function createAgentModelDiscovery(
  { agentId, configuration, deps: suppliedDeps, probes }: { agentId: string; configuration: AgentDiscoveryConfiguration; deps: ModelDiscoveryDeps; probes: ModelDiscoveryProbes },
  _optional: Record<string, never> = {},
): AgentModelDiscoveryPort {
  async function scoped(context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal?: AbortSignal) {
    const config = await withModelProbeTimeout((active) => readModelConfiguration(agentId, context, deps, active), 1000, signal);
    const key = `${agentId}:${modelLaunchFingerprint(context, config.fingerprintMaterial)}`;
    return { config, key, fingerprint: key.slice(agentId.length + 1) };
  }
  type Scope = { context: ModelDiscoveryContext; deps: ModelDiscoveryDeps; signal: AbortSignal | undefined; key: string; fingerprint: string; config: ScopedConfiguration; cached: ModelCacheEntry; now: number };

  async function readDiskCatalog({ context, deps, signal, fingerprint, config, now }: Scope): Promise<ModelCatalogSnapshot | undefined> {
    try {
      const disk = await withModelProbeTimeout(active => probes.cliCache({ agentId, context, deps, signal: active }), 1000, signal);
      const models = normalizeDiscoveredModels(disk.models);
      if (!models.length) return undefined;
      return { models, source: 'cli-cache', coverage: disk.coverage,
        freshness: 'stale', fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now).toISOString(),
        launchFingerprint: fingerprint, diagnostics: [],
        ...(config.selection ? { defaultSelectionId: config.selection } : {}) };
    } catch { /* No usable disk cache: keep the bounded cold-probe path below. */ return undefined; }
  }

  /** A fresh host process may still have a CLI-owned disk catalog. Use its observed rows
   * immediately; keep stale provenance and refresh without holding the first user prompt.
   * Returns a concurrent caller's answer when one started refreshing during the read. */
  async function primeFromDisk(scope: Scope) {
    const disk = await readDiskCatalog(scope);
    if (disk) scope.cached.good = disk;
    // Another caller may have started the refresh while disk metadata was read.
    const concurrent = scope.deps.cache.get(scope.key);
    return concurrent?.pending ? concurrent.failed || concurrent.good || concurrent.pending : undefined;
  }

  function failureSnapshot({ cached, deps, fingerprint }: Scope, error: unknown): ModelCatalogSnapshot {
    const retryAt = cached.retryAt as number;
    // Outer inventory caches must retry failed refreshes on the negative lifetime too.
    if (cached.good) return { ...cached.good, freshness: 'stale', expiresAt: new Date(retryAt).toISOString(), diagnostics: [diagnostic(error)] };
    return offlineSnapshot(fingerprint, deps.clock.now(), configuration.fallbackModels(), diagnostic(error));
  }

  async function probeAndStore(scope: Scope): Promise<ModelCatalogSnapshot> {
    const { context, deps, signal, cached } = scope;
    const result: ModelProbeResult = await boundedProbe(deps, () => withModelProbeTimeout((active) => probes.catalog({ agentId, context, configuration, deps, signal: active }), probes.timeoutMs({ agentId }), signal), signal);
    const models = normalizeDiscoveredModels(result.models);
    if (models.length === 0) throw new ModelProbeError('malformed-response');
    const selection = pickSelection({ agentId, context, configSelection: scope.config.selection, result });
    const snapshot = liveSnapshot({ models, result, fingerprint: scope.fingerprint, selection, fetched: deps.clock.now() });
    cached.good = snapshot; delete cached.retryAt; delete cached.failed;
    return snapshot;
  }

  async function refresh(scope: Scope): Promise<ModelCatalogSnapshot> {
    const { deps, cached } = scope;
    let snapshot: ModelCatalogSnapshot;
    try { snapshot = await probeAndStore(scope); }
    catch (error) {
      cached.retryAt = deps.clock.now() + MODEL_NEGATIVE_TTL_MS;
      snapshot = failureSnapshot(scope, error);
      cached.failed = snapshot;
    } finally { delete cached.pending; }
    return snapshot;
  }

  async function discover(
    { context, deps }: { context: ModelDiscoveryContext; deps: ModelDiscoveryDeps },
    { signal, force, staleWhileRevalidate }: { signal: AbortSignal | undefined; force: boolean; staleWhileRevalidate: boolean },
  ): Promise<ModelCatalogSnapshot> {
    let state: Awaited<ReturnType<typeof scoped>>;
    try { state = await scoped(context, deps, signal); }
    catch (error) {
      return offlineSnapshot(modelLaunchFingerprint(context), deps.clock.now(), configuration.fallbackModels(), diagnostic(error));
    }
    const now = deps.clock.now();
    const scope: Scope = { context, deps, signal, ...state, cached: deps.cache.get(state.key) || {}, now };
    const hit = cachedAnswer({ cached: scope.cached, now }, { force, staleWhileRevalidate });
    if (hit) return hit;
    // Only await on the disk path: any other await here would let a concurrent caller start a second probe.
    const joined = staleWhileRevalidate && !scope.cached.good && DISK_CATALOG_AGENTS.includes(agentId) ? await primeFromDisk(scope) : undefined;
    if (joined) return joined;
    const pending = refresh(scope);
    scope.cached.pending = pending; deps.cache.set(scope.key, scope.cached);
    evictSettledScopes(deps.cache);
    // Explicit rescan still waits for live evidence. Launches retain the scoped last-good
    // catalog while this coalesced, timeout-bounded refresh updates the cache in the background.
    return (staleWhileRevalidate && lastGoodSnapshot(scope.cached, now)) || pending;
  }

  const port: AgentModelDiscoveryPort = {
    async discoverModels({ context }, optional = {}) {
      return discover({ context, deps: optional.deps ?? suppliedDeps },
        { signal: optional.signal, force: optional.force === true, staleWhileRevalidate: optional.staleWhileRevalidate === true });
    },
    async resolveDefaultModel({ context, catalog }, { signal, deps = suppliedDeps } = {}): Promise<DefaultModelResolution> {
      let state: Awaited<ReturnType<typeof scoped>>;
      try { state = await scoped(context, deps, signal); } catch { return { status: 'unresolved', reason: 'Launch configuration could not be read.' }; }
      if (state.fingerprint !== catalog.launchFingerprint) return { status: 'unresolved', reason: 'Launch configuration changed; refresh the catalog.' };
      return resolveFromCatalog({ context, catalog, configSelection: state.config.selection, fingerprint: state.fingerprint, resolvedAt: new Date(deps.clock.now()).toISOString() });
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
/** The definition's declared env default, trimmed; undefined when unset or blank. */
function configuredDefault(def: ModelDiscoveryDefinition, context: ModelDiscoveryContext): string | undefined {
  return (def.defaultModelEnvVar && context.env[def.defaultModelEnvVar]?.trim()) || undefined;
}
async function staticDiscover({ def, context, deps }: { def: ModelDiscoveryDefinition; context: ModelDiscoveryContext; deps: ModelDiscoveryDeps }): Promise<ModelCatalogSnapshot> {
  const catalog = offlineSnapshot(modelLaunchFingerprint(context), deps.clock.now(), def.fallbackModels || []);
  // Static hosts used their first concrete fallback before discovery existed. Preserve
  // that contract while letting a declared env default or explicit selection take precedence.
  const selection = context.model || context.resumedModelId || configuredDefault(def, context) || catalog.models.find(row => row.identityKind === 'concrete')?.id;
  return { ...catalog, ...(selection ? { defaultSelectionId: selection } : {}) };
}
async function staticResolve({ def, context, catalog, deps }: { def: ModelDiscoveryDefinition; context: ModelDiscoveryContext; catalog: ModelCatalogSnapshot; deps: ModelDiscoveryDeps }): Promise<DefaultModelResolution> {
  if (missingResumedModel(context)) return RESUMED_MODEL_REQUIRED;
  const configured = configuredDefault(def, context);
  const selection = context.model || context.resumedModelId || configured || catalog.defaultSelectionId;
  if (!selection) return { status: 'unresolved', reason: NO_CONCRETE_EVIDENCE };
  // A host's declared env default is authoritative even when its static hints lag behind.
  const id = rowEvidence(findRow(catalog.models, selection)) || (configured === selection ? configured : undefined);
  if (!isConcreteId(id)) return { status: 'unresolved', selectionId: selection, reason: NO_CONCRETE_EVIDENCE };
  return { status: 'resolved', id, selectionId: selection, source: configured === selection ? 'config-file' : catalog.source,
    resolvedAt: new Date(deps.clock.now()).toISOString(), launchFingerprint: catalog.launchFingerprint };
}
export function modelDiscoveryForDef(
  { def, deps: suppliedDeps }: { def: ModelDiscoveryDefinition; deps: ModelDiscoveryDeps },
  _optional: Record<string, never> = {},
): AgentModelDiscoveryPort {
  return {
    discoverModels: def.discoverModels?.bind(def) || (async ({ context }, { deps = suppliedDeps } = {}) => staticDiscover({ def, context, deps })),
    resolveDefaultModel: def.resolveDefaultModel?.bind(def) || (async ({ context, catalog }, { deps = suppliedDeps } = {}) => staticResolve({ def, context, catalog, deps })),
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
