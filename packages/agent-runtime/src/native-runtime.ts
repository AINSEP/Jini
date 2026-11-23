/** Native host composition: one state and transport, with environment policies resolved once. */
import { nativeAcpModelProbe } from './acp-model-probe.js';
import { type AcpModelProbe } from '@jini-ai/core/contracts/agents';
import { detectAgents, probeAgentModels } from './detection.js';
import { resolveAgentLaunch } from './launch.js';
import { getAgentDef } from './registry.js';
import { createAcpDiscoveryAdapter } from './model-discovery-adapters.js';
import { createAgentRuntimeState, type AgentRuntimeState } from './runtime-state.js';
import { bindRuntimeAgentDef } from './runtime-def-binding.js';
import { codexDefOptionsFromEnv, type CodexDefOptions } from './defs/codex/options.js';
import { piDefOptionsFromEnv, type PiDefOptions } from './defs/pi/options.js';
import type { RuntimeEnv } from '@jini-ai/core/contracts/agents';
import type { AgentRuntimeHostPorts } from './host-ports.js';

export interface NativeAgentRuntime {
  readonly state: AgentRuntimeState;
  readonly hostEnv: RuntimeEnv;
  /** Codex definition config; the runtime-port binding closes over it, hosts never read it. */
  readonly codex: CodexDefOptions;
  /** Pi definition config; the runtime-port binding's PI session member closes over it. */
  readonly pi: PiDefOptions;
  readonly detectAgents: typeof detectAgents;
  readonly probeAgentModels: typeof probeAgentModels;
  readonly resolveAgentLaunch: typeof resolveAgentLaunch;
  readonly getAgentDef: (required: Parameters<typeof getAgentDef>[0], optional?: Record<string, never>) => ReturnType<typeof getAgentDef>;
  /** Drain owned discovery before clearing caches, so late probes cannot repopulate them. */
  dispose(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
}

/** Bind existing runtime owners to a host; copies env without performing I/O.
 * @param required - The host's selected environment, used instead of ambient process configuration.
 * @param optional - An existing state, ACP transport, host ports, or explicit policies overriding env defaults.
 * `hostPorts` carries the host's toolchain, proxy-env and provider-catalog collaborators; composers
 * always pass it. It stays optional only for hosts not yet wired, which then search PATH only,
 * skip proxy normalization and have no default provider base URLs.
 * @returns Bound runtime operations and an idempotent cache disposer. Stop runs before disposing.
 * Discovery after disposal rejects with `InvalidStateError`; native probe failures retain their existing outcomes.
 * @example const runtime = createNativeAgentRuntime({ env: process.env }, { hostPorts });
 */
export function createNativeAgentRuntime(
  { env }: { env: RuntimeEnv },
  { state = createAgentRuntimeState({}), acpModelProbe = state.acpModelProbe ?? nativeAcpModelProbe,
    codex = codexDefOptionsFromEnv({ env }), pi = piDefOptionsFromEnv({ env }), hostPorts,
  }: { state?: AgentRuntimeState; acpModelProbe?: AcpModelProbe; codex?: CodexDefOptions; pi?: PiDefOptions; hostPorts?: AgentRuntimeHostPorts } = {},
): NativeAgentRuntime {
  const hostEnv = { ...env };
  if (hostPorts) state.hostPorts = hostPorts;
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
    state, hostEnv, codex, pi,
    detectAgents: (required, optional = {}) => track(() => detectAgents(required, { ...optional, state, env: hostEnv })),
    probeAgentModels: (required, optional = {}) => track(() => probeAgentModels(required, { ...optional, state, env: hostEnv })),
    resolveAgentLaunch: (required, optional = {}) => resolveAgentLaunch(required, { ...optional, state, env: hostEnv }),
    getAgentDef: (required, _optional = {}) => {
      const def = getAgentDef(required);
      return def ? bindRuntimeAgentDef({ def, state }, { codex }) : def;
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
