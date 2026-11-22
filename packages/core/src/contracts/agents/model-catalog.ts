/**
 * @file Model-catalog vocabulary for coding-agent runtimes: model options, discovered catalogs, default-model
 * resolution, the discovery ports a definition implements and the provider model-listing shapes. Types only,
 * plus one data-only error class a launcher checks with `instanceof`. Values (selection rules, probes, the
 * HTTP lister) belong to the runtime the host binds, usually `@jini-ai/agent-runtime`.
 */
export type ModelIdentityKind = 'concrete' | 'alias' | 'routing-mode';

/** Assignable both ways with Node's `ProcessEnv`, without naming the `NodeJS` namespace in a universal contract. */
export type RuntimeEnv = Record<string, string | undefined>;

export type RuntimeModelOption = {
  id: string;
  label: string;
  identityKind?: ModelIdentityKind;
  resolvedId?: string;
  /**
   * The reasoning-effort levels THIS model supports, when the runtime's own catalog reports them
   * per model rather than per agent.
   *
   * Present only where a live source actually carries the data — Codex's `debug models` catalog
   * does (`supported_reasoning_levels`), and the levels genuinely differ between models on the same
   * CLI: verified live against codex-cli 0.153.4, where `gpt-6-astra` offers
   * low/medium/high/xhigh/max/ultra while `gpt-5.5` stops at `xhigh`. A single agent-level
   * `RuntimeAgentDef.reasoningOptions` list cannot be correct for both, which is why this is a
   * property of the model row rather than of the def.
   *
   * Consumed by `RuntimeAgentDef.deriveReasoningOptions` to compute the agent-level list a picker
   * renders. Left `undefined` by every runtime whose effort vocabulary really is uniform, and by
   * every static fallback list — an absent value means "nothing catalog-specific to say", never
   * "this model supports no effort levels".
   */
  reasoning?: readonly RuntimeReasoningOption[];
};

/** A reasoning-effort choice; same shape as a model option. */
export interface RuntimeReasoningOption extends RuntimeModelOption {}

/*
 * Provider model-listing shapes.
 *
 * Vendored subset of OD's upstream contracts-package provider-connectivity
 * shapes needed by this package's own provider modules. `@jini-ai/agent-runtime`
 * has zero OD workspace-package imports (same policy as `types.ts`'s vendored
 * `AgentDiagnostic`/`AgentFixIntent`) — only the fields this package's own
 * code actually reads/writes are kept; the daemon-only surface (agent
 * connection-test request/response shapes, reasoning-execution fields) is
 * not ported.
 */

/** Category of outcome a provider model/connection probe can report. */
export type ConnectionTestKind =
  | 'success'
  | 'auth_failed'
  | 'forbidden'
  | 'not_found_model'
  | 'invalid_model_id'
  | 'invalid_base_url'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'timeout'
  | 'unknown';

/** Wire protocol family a BYOK provider speaks. */
export type ConnectionTestProtocol =
  | 'anthropic'
  | 'openai'
  | 'azure'
  | 'google'
  | 'ollama'
  | 'senseaudio'
  | 'aihubmix'
  | 'bedrock';

export interface ProviderModelOption {
  id: string;
  label: string;
}

export interface ProviderModelsRequest {
  protocol: ConnectionTestProtocol;
  baseUrl: string;
  apiKey: string;
  /** Azure only. Kept for shape parity with a provider-test request. */
  apiVersion?: string;
}

export type ProviderModelsKind = ConnectionTestKind | 'no_models' | 'unsupported_protocol';

export interface ProviderModelsResponse {
  ok: boolean;
  kind: ProviderModelsKind;
  latencyMs: number;
  models?: ProviderModelOption[];
  status?: number;
  detail?: string;
}

export type DnsLookupAddress = { address: string; family: number };
export type DnsLookupFn = (requiredArgs: { hostname: string }) => Promise<DnsLookupAddress[]>;

/** One provider model-listing call. A runtime may extend it with transport-only fields (an HTTP dispatcher). */
export interface ProviderModelsQuery extends ProviderModelsRequest {
  signal?: AbortSignal;
  /** Injectable DNS resolver for the base-URL SSRF guard; defaults to `node:dns`. */
  dnsLookup?: DnsLookupFn;
  /** Injectable HTTP transport for adapter conformance; defaults to fetch. */
  fetchFn?: typeof fetch;
}

export type ModelSource = 'cli' | 'rpc' | 'provider-api' | 'cli-cache' | 'config-file' | 'offline-fallback';
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
  http: { list(input: ProviderModelsQuery): Promise<ProviderModelsResponse> };
  credential: { connection(input: { agentId: string; context: ModelDiscoveryContext; signal: AbortSignal }): Promise<ProviderModelsQuery | null> };
  acp: { probe(input: { context: ModelDiscoveryContext; args: readonly string[]; signal: AbortSignal }): Promise<ModelProbeResult> };
  /** Droid SDK ports: no undocumented CLI flags or inference prompts. */
  rpc: { probe(input: { agentId: string; context: ModelDiscoveryContext; signal: AbortSignal }): Promise<ModelProbeResult> };
  clock: { now(): number };
  cache: Map<string, ModelCacheEntry>;
}

/** A refusal assembled by the shared selection validator, safe to show instead of provider errors. */
export class RuntimeSelectionError extends Error {}
