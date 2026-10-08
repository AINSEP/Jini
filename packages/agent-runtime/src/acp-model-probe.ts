/**
 * @module acp-model-probe
 * Replaceable live-model probe for ACP-based runtime defs. The default uses the native,
 * prompt-free initialize/session-new handshake; setAcpModelProbe installs a host implementation
 * and null restores native transport. noopAcpModelProbe is an explicit opt-out that returns no
 * live models, allowing detection to fall back to the def's static catalog.
 */
import type { RuntimeEnv, RuntimeModelOption } from './types.js';
import { detectAcpModels as probeNativeModels } from './agent-protocol/acp/models.js';

export interface AcpModelProbeRequest {
  bin: string;
  args: string[];
  cwd?: string;
  env?: RuntimeEnv;
  timeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
  defaultModelOption?: RuntimeModelOption;
}

export interface AcpModelProbe {
  detectModels(requiredArgs: Pick<AcpModelProbeRequest, 'bin' | 'args'>,
    optionalArgs?: Omit<AcpModelProbeRequest, 'bin' | 'args'>): Promise<RuntimeModelOption[]>;
}

export const noopAcpModelProbe: AcpModelProbe = {
  async detectModels() {
    return [];
  },
};

const nativeAcpModelProbe: AcpModelProbe = { detectModels: (required, optional = {}) =>
  probeNativeModels(required, { ...optional, ...(optional.env ? { env: optional.env as NodeJS.ProcessEnv } : {}) }) };
let activeAcpModelProbe: AcpModelProbe = nativeAcpModelProbe;

/** Install a transport/test double. Pass `null` to restore the native transport. */
export function setAcpModelProbe({ probe }: { probe: AcpModelProbe | null }): void {
  activeAcpModelProbe = probe ?? nativeAcpModelProbe;
}

/** Delegate to the currently installed probe. */
export async function detectAcpModels(requiredArgs: Pick<AcpModelProbeRequest, "bin" | "args">, optionalArgs: Omit<AcpModelProbeRequest, "bin" | "args"> = {}): Promise<RuntimeModelOption[]> {
  return activeAcpModelProbe.detectModels(requiredArgs, optionalArgs);
}
