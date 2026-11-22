import type { ModelDiscoveryContext, ModelDiscoveryDeps, ModelProbeResult, RuntimeModelOption } from '@jini-ai/core/contracts/agents';


export interface AgentDiscoveryConfiguration {
  fallbackModels: () => readonly RuntimeModelOption[];
  parse?: (input: { stdout: string }) => RuntimeModelOption[] | null;
  args?: readonly string[];
  /** Listing budget requested by the definition, bounded by the outer discovery timeout. */
  timeoutMs?: number;
}
/** Host composition selects native probes or substitutes another discovery mechanism. */
export interface ModelDiscoveryProbes {
  catalog(required: { agentId: string; context: ModelDiscoveryContext; configuration: AgentDiscoveryConfiguration; deps: ModelDiscoveryDeps; signal: AbortSignal }, optional?: Record<string, never>): Promise<ModelProbeResult>;
  cliCache(required: { agentId: string; context: ModelDiscoveryContext; deps: ModelDiscoveryDeps; signal: AbortSignal }, optional?: Record<string, never>): Promise<ModelProbeResult>;
  timeoutMs(required: { agentId: string }, optional?: Record<string, never>): number;
}
