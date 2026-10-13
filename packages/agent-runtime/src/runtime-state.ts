/** Mutable runtime data belongs to one host. Compatibility functions use defaultRuntimeState. */
import type { AcpModelProbe } from './acp-model-probe.js';
import type { RuntimeAgentDef, RuntimeCapabilityMap, RuntimeModelOption, DetectedAgent } from './types.js';
import type { ModelCacheEntry, ModelDiscoveryDeps } from './model-discovery-types.js';

export interface AgentRuntimeState {
  /** One in-flight or settled complete detection per launch scope until explicit Rescan. */
  readonly detections: Map<string, Promise<DetectedAgent>>;
  readonly capabilities: Map<string, RuntimeCapabilityMap>;
  /** One in-flight or settled `--help` probe per def id + launch path, so a run never re-spawns it. */
  readonly capabilityProbes: Map<string, Promise<void>>;
  readonly liveModelCache: Map<string, Set<string>>;
  readonly liveModelOrder: Map<string, string[]>;
  readonly claudeModels: Map<string, { expiresAt: number; value: Promise<readonly RuntimeModelOption[] | null> }>;
  /** Host-owned transport. Absent only for legacy definitions using the compatibility wrapper. */
  acpModelProbe?: AcpModelProbe;
  discoveryDeps?: ModelDiscoveryDeps;
  readonly modelCatalog: Map<string, ModelCacheEntry>;
  readonly executable: {
    /** Env var names consulted by detection-home/resource-root resolution. Overridable via `configureExecutableResolutionEnv`. */
    envNames: { agentHomeEnvVar: string; resourceRootEnvVar: string };
    toolchainKey: string | null; toolchainDirs: string[] | null; toolchainDirsAt: number;
  };
  /** Clear settled caches after host operations finish; retain its configured env names. */
  clear(required: Record<string, never>, optional: Record<string, never>): void;
}
/** Independent state, including in-flight probes, for each embedding host.
 * Returns empty owned maps; no I/O. @complexity O(1) initialization; retained data grows with probes. */
export function createAgentRuntimeState(_required: Record<string, never>, _optional: Record<string, never> = {}): AgentRuntimeState {
  const state: AgentRuntimeState = {
    detections: new Map(), capabilities: new Map(), capabilityProbes: new Map(), liveModelCache: new Map(), liveModelOrder: new Map(),
    claudeModels: new Map(), modelCatalog: new Map(),
    executable: { envNames: { agentHomeEnvVar: 'AGENT_RUNTIME_HOME', resourceRootEnvVar: 'AGENT_RUNTIME_RESOURCE_ROOT' }, toolchainKey: null, toolchainDirs: null, toolchainDirsAt: 0 },
    clear() {
      state.detections.clear(); state.capabilities.clear(); state.capabilityProbes.clear(); state.liveModelCache.clear(); state.liveModelOrder.clear();
      state.claudeModels.clear(); state.modelCatalog.clear();
      state.executable.toolchainKey = null; state.executable.toolchainDirs = null; state.executable.toolchainDirsAt = 0;
    },
  };
  return state;
}
export const defaultRuntimeState = createAgentRuntimeState({});

/** Bind model probes and the argument builder to the host transport, capability state and plugin policy.
 * Returns a definition copy without mutating the registry. @complexity O(1). */
export function bindRuntimeAgentDef({ def, state }: { def: RuntimeAgentDef; state: AgentRuntimeState }, { codexDisablePlugins }: { codexDisablePlugins?: boolean } = {}): RuntimeAgentDef {
  const fetchModels = def.fetchModels;
  const boundFetchModels: RuntimeAgentDef['fetchModels'] = fetchModels
    ? (required, optional = {}) => fetchModels(required, {
      ...optional, ...(state.acpModelProbe ? { acpModelProbe: state.acpModelProbe } : {}),
    }) : undefined;
  return { ...def, ...(boundFetchModels ? { fetchModels: boundFetchModels } : {}), buildArgs: (required, optional = {}) => def.buildArgs(required, {
    ...optional, options: { ...optional.options, capabilities: state.capabilities.get(def.id) ?? {},
      ...(codexDisablePlugins !== undefined ? { codexDisablePlugins } : {}) },
  }) };
}
