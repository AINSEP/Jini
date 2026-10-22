/** Native composition and legacy public signatures. Injected hosts import model-discovery instead. */
import {
  createAgentModelDiscovery as createPolicyDiscovery,
  modelDiscoveryForDef as policyDiscoveryForDef,
  resolveModelForLaunch as resolvePolicyModelForLaunch,
  type ModelDiscoveryDefinition,
} from './model-discovery.js';
import { defaultModelDiscoveryDeps, modelProbeTimeoutMs, probeAgentCatalog, probeCliCache } from './model-discovery-adapters.js';
import type { AgentDiscoveryConfiguration, AgentModelDiscoveryPort, ModelDiscoveryContext, ModelDiscoveryDeps, ModelDiscoveryProbes } from './model-discovery-types.js';

export * from './model-discovery.js';

/** Reuse the existing probe owners, including their credential, cancellation and cache guards. */
const nativeModelDiscoveryProbes: ModelDiscoveryProbes = {
  catalog: ({ agentId, context, configuration, deps, signal }, _optional = {}) => probeAgentCatalog(agentId, context, configuration, deps, signal),
  cliCache: ({ agentId, context, deps, signal }, _optional = {}) => probeCliCache(agentId, context, deps, signal),
  timeoutMs: ({ agentId }, _optional = {}) => modelProbeTimeoutMs(agentId),
};

// These forwarding signatures deliberately retain the published API. New policy APIs use
// required/optional objects; changing these compatibility wrappers would break existing hosts.
export function createAgentModelDiscovery(agentId: string, configuration: AgentDiscoveryConfiguration): AgentModelDiscoveryPort {
  return createPolicyDiscovery({ agentId, configuration, deps: defaultModelDiscoveryDeps, probes: nativeModelDiscoveryProbes });
}

export function modelDiscoveryForDef(def: ModelDiscoveryDefinition): AgentModelDiscoveryPort {
  return policyDiscoveryForDef({ def, deps: defaultModelDiscoveryDeps });
}

export function resolveModelForLaunch(
  required: { def: ModelDiscoveryDefinition; context: ModelDiscoveryContext },
  { deps = defaultModelDiscoveryDeps, ...optional }: { deps?: ModelDiscoveryDeps; signal?: AbortSignal } = {},
): ReturnType<typeof resolvePolicyModelForLaunch> {
  return resolvePolicyModelForLaunch({ ...required, deps }, optional);
}
