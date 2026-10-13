/** Native host composition: one state and transport, with environment policies resolved once. */
import { nativeAcpModelProbe, type AcpModelProbe } from './acp-model-probe.js';
import { detectAgents, probeAgentModels } from './detection.js';
import { resolveAgentLaunch } from './launch.js';
import { getAgentDef } from './registry.js';
import { createAcpDiscoveryAdapter } from './model-discovery-adapters.js';
import { bindRuntimeAgentDef, createAgentRuntimeState, type AgentRuntimeState } from './runtime-state.js';
import type { RuntimeEnv } from './types.js';

export interface NativeAgentRuntime {
  readonly state: AgentRuntimeState;
  readonly hostEnv: RuntimeEnv;
  readonly codexDisablePlugins: boolean;
  readonly piGracefulShutdownMs: number;
  readonly detectAgents: typeof detectAgents;
  readonly probeAgentModels: typeof probeAgentModels;
  readonly resolveAgentLaunch: typeof resolveAgentLaunch;
  readonly getAgentDef: (required: Parameters<typeof getAgentDef>[0], optional?: Record<string, never>) => ReturnType<typeof getAgentDef>;
  /** Drain owned discovery before clearing caches, so late probes cannot repopulate them. */
  dispose(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
}

/** Bind existing runtime owners to a host; copies env without performing I/O.
 * @param required - The host's selected environment, used instead of ambient process configuration.
 * @param optional - An existing state, ACP transport, or explicit policies overriding env defaults.
 * @returns Bound runtime operations and an idempotent cache disposer. Stop runs before disposing.
 * Discovery after disposal rejects with `InvalidStateError`; native probe failures retain their existing outcomes.
 * @example const runtime = createNativeAgentRuntime({ env: process.env });
 */
export function createNativeAgentRuntime(
  { env }: { env: RuntimeEnv },
  { state = createAgentRuntimeState({}), acpModelProbe = state.acpModelProbe ?? nativeAcpModelProbe,
    codexDisablePlugins = env.CODEX_DISABLE_PLUGINS === '1',
    piGracefulShutdownMs = Number(env.PI_GRACEFUL_SHUTDOWN_MS) || 5000,
  }: { state?: AgentRuntimeState; acpModelProbe?: AcpModelProbe; codexDisablePlugins?: boolean; piGracefulShutdownMs?: number } = {},
): NativeAgentRuntime {
  const hostEnv = { ...env };
  if (state.discoveryDeps && state.acpModelProbe !== acpModelProbe) {
    state.discoveryDeps = { ...state.discoveryDeps, acp: createAcpDiscoveryAdapter({ probe: acpModelProbe }) };
  }
  state.acpModelProbe = acpModelProbe;
  const pending = new Set<Promise<unknown>>();
  let disposal: Promise<void> | undefined;
  /** Retain operations until disposal can wait for their final cache writes. */
  function track<T>(work: () => Promise<T>): Promise<T> {
    if (disposal) return Promise.reject(new DOMException('Agent runtime is disposed', 'InvalidStateError'));
    const result = work();
    pending.add(result);
    void result.then(() => pending.delete(result), () => pending.delete(result));
    return result;
  }
  return {
    state, hostEnv, codexDisablePlugins, piGracefulShutdownMs,
    detectAgents: (required, optional = {}) => track(() => detectAgents(required, { ...optional, state, env: hostEnv })),
    probeAgentModels: (required, optional = {}) => track(() => probeAgentModels(required, { ...optional, state, env: hostEnv })),
    resolveAgentLaunch: (required, optional = {}) => resolveAgentLaunch(required, { ...optional, state, env: hostEnv }),
    getAgentDef: (required, _optional = {}) => {
      const def = getAgentDef(required);
      return def ? bindRuntimeAgentDef({ def, state }, { codexDisablePlugins }) : def;
    },
    dispose(_required, _optional = {}) {
      disposal ??= (async () => {
        await Promise.allSettled([...pending, ...state.detections.values(), ...state.capabilityProbes.values(),
          ...[...state.modelCatalog.values()].flatMap(entry => entry.pending ? [entry.pending] : []),
          ...[...state.claudeModels.values()].map(entry => entry.value),
        ]);
        state.clear({}, {});
      })();
      return disposal;
    },
  };
}
