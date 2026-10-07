import type { RuntimeEnv, RuntimeModelOption } from './types.js';
import type { ProviderModelsInput } from './providers/model-catalog.js';

export type ModelSource = 'cli' | 'rpc' | 'provider-api' | 'cli-cache' | 'config-file' | 'offline-fallback';
export type ModelIdentityKind = 'concrete' | 'alias' | 'routing-mode';
export interface DiscoveredModel extends RuntimeModelOption {
  identityKind: ModelIdentityKind;
  resolvedId?: string;
  provider?: string;
}
export interface ModelCatalogSnapshot {
  models: DiscoveredModel[];
  source: ModelSource;
  freshness: 'fresh' | 'stale' | 'offline-fallback';
  fetchedAt: string;
  expiresAt: string;
  coverage: 'account' | 'provider' | 'configured' | 'observed';
  launchFingerprint: string;
  diagnostics: readonly { code: 'auth-missing' | 'unsupported-version' | 'timeout' | 'offline' | 'malformed-response'; message: string }[];
  /** Native current selection, preserved even when it is an opaque route. */
  defaultSelectionId?: string;
}
export type DefaultModelResolution =
  | { status: 'resolved'; id: string; selectionId?: string; source: ModelSource; resolvedAt: string; launchFingerprint: string }
  | { status: 'unresolved'; selectionId?: string; reason: string };
/** Represents the actual launch; fingerprints are opaque, never credential values. */
export interface ModelDiscoveryContext {
  executable: string;
  version?: string | null;
  cwd: string;
  profile?: string;
  configFingerprint?: string;
  projectRoot?: string;
  configPath?: string;
  accountScope?: string;
  env: RuntimeEnv;
  model?: string;
  resumeSessionId?: string;
  /** Host-supplied authoritative metadata for the resumed session. */
  resumedModelId?: string;
  settingSources?: readonly string[];
  settings?: string;
}
export interface AgentModelDiscoveryPort {
  discoverModels(requiredArgs: { context: ModelDiscoveryContext }, optionalArgs?: { signal?: AbortSignal; force?: boolean; staleWhileRevalidate?: boolean; deps?: ModelDiscoveryDeps }): Promise<ModelCatalogSnapshot>;
  resolveDefaultModel(requiredArgs: { context: ModelDiscoveryContext; catalog: ModelCatalogSnapshot }, optionalArgs?: { signal?: AbortSignal; deps?: ModelDiscoveryDeps }): Promise<DefaultModelResolution>;
}
export interface ModelProbeResult {
  models: readonly RuntimeModelOption[];
  defaultSelectionId?: string;
  source: ModelSource;
  coverage: ModelCatalogSnapshot['coverage'];
}
export interface ModelCacheEntry {
  good?: ModelCatalogSnapshot;
  retryAt?: number;
  failed?: ModelCatalogSnapshot;
  pending?: Promise<ModelCatalogSnapshot>;
}
/** All effects belong to ports. Credentials never enter snapshots or diagnostic strings. */
export interface ModelDiscoveryDeps {
  process: { run(input: { context: ModelDiscoveryContext; args: readonly string[]; stdin?: string; signal: AbortSignal; timeoutMs: number; complete?: (stdout: string) => boolean; terminateProcessTree?: boolean }): Promise<{ stdout: string; stderr: string }> };
  fs: { read(path: string, options: { signal: AbortSignal }): Promise<string | null>; projectRoot?(input: { cwd: string; signal: AbortSignal }): Promise<string | null> };
  http: { list(input: ProviderModelsInput): Promise<import('./providers/types.js').ProviderModelsResponse> };
  credential: { connection(input: { agentId: string; context: ModelDiscoveryContext; signal: AbortSignal }): Promise<ProviderModelsInput | null> };
  acp: { probe(input: { context: ModelDiscoveryContext; args: readonly string[]; signal: AbortSignal }): Promise<ModelProbeResult> };
  /** Copilot/Droid SDK ports: no undocumented CLI flags or inference prompts. */
  rpc: { probe(input: { agentId: string; context: ModelDiscoveryContext; signal: AbortSignal }): Promise<ModelProbeResult> };
  clock: { now(): number };
  cache: Map<string, ModelCacheEntry>;
}
