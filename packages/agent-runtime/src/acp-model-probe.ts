/**
 * @module acp-model-probe
 * Replaceable live-model probe for ACP-based runtime defs. The default uses the native,
 * prompt-free initialize/session-new handshake; setAcpModelProbe installs a host implementation
 * and null restores native transport. noopAcpModelProbe is an explicit opt-out that returns no
 * live models, allowing detection to fall back to the def's static catalog.
 */
import type { RuntimeEnv, RuntimeModelOption } from './types.js';
import { detectAcpModels as probeNativeModels, detectAcpModelMetadata } from './agent-protocol/acp/models.js';

export interface AcpModelProbeRequest {
  bin: string;
  args: string[];
  cwd?: string;
  env?: RuntimeEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  clientName?: string;
  clientVersion?: string;
  defaultModelOption?: RuntimeModelOption;
}

export interface AcpModelProbe {
  detectModels(requiredArgs: Pick<AcpModelProbeRequest, 'bin' | 'args'>,
    optionalArgs?: Omit<AcpModelProbeRequest, 'bin' | 'args'>): Promise<RuntimeModelOption[]>;
  /** Optional metadata capability preserves a native current selection without guessing from order. */
  detectMetadata?(requiredArgs: Pick<AcpModelProbeRequest, 'bin' | 'args'>,
    optionalArgs?: Omit<AcpModelProbeRequest, 'bin' | 'args'>): Promise<{ models: RuntimeModelOption[]; currentModelId: string | null }>;
}

export const noopAcpModelProbe: AcpModelProbe = {
  async detectModels() {
    return [];
  },
};

/** Native adapter selected once by each host composition; independent of the compatibility setter. */
export const nativeAcpModelProbe: AcpModelProbe = {
  detectModels: (required, optional = {}) => probeNativeModels(required, optional),
  detectMetadata: (required, optional = {}) => detectAcpModelMetadata(required, optional),
};
let activeAcpModelProbe: AcpModelProbe = nativeAcpModelProbe;

/** Compatibility setter for unbound definitions. Owned hosts keep their selected transport.
 * Pass `null` to restore the native transport for the legacy wrapper. */
export function setAcpModelProbe({ probe }: { probe: AcpModelProbe | null }): void {
  activeAcpModelProbe = probe ?? nativeAcpModelProbe;
}

/** Delegate to an explicit host probe, or the currently installed compatibility probe. */
export async function detectAcpModels(requiredArgs: Pick<AcpModelProbeRequest, "bin" | "args">, optionalArgs: Omit<AcpModelProbeRequest, "bin" | "args"> & { probe?: AcpModelProbe } = {}): Promise<RuntimeModelOption[]> {
  const { probe = activeAcpModelProbe, ...request } = optionalArgs;
  return probe.detectModels(requiredArgs, request);
}
