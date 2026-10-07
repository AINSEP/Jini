/**
 * @module acp-model-probe
 *
 * Port replacing OD's `detectAcpModels` import
 * (`apps/daemon/src/acp.js`) inside `defs/shared.ts`. Eight of this
 * package's def literals (devin, hermes, kilo, kimi, kiro, reasonix,
 * trae-cli, vibe) fetch their live model list by speaking a session/new →
 * session/list_models-shaped ACP JSON-RPC handshake to the spawned CLI.
 *
 * That handshake lives in OD's `acp.ts` (1744 lines) — the full ACP
 * subprocess transport, which r1's recon classifies as its own separate
 * GENERIC-ENGINE zone (`agent-protocol/`, 17 files) and a *later*
 * extraction task, not this one. Porting it here would blow this task's
 * scope far past "harvest wholesale" for what is genuinely a large,
 * separate subsystem.
 *
 * So `detectAcpModels` becomes an injectable port: an `AcpModelProbe` with
 * a single `detectModels(requiredArgs, optionalArgs)` method, matching the real call shape
 * every ACP-based def literal already uses. The default implementation is
 * a no-op that resolves to `[]`, which makes `detection.ts`'s `fetchModels`
 * step treat the live-fetch as "returned nothing" and fall back to the
 * def's static `fallbackModels` — the same behavior OD gets when the vela
 * probe times out or errors. A future task that ports the ACP transport
 * (or the OD adapter, sooner) calls `setAcpModelProbe()` once at startup to
 * wire in the real implementation; every def literal that calls
 * `detectAcpModels(...)` picks it up automatically, no per-def changes
 * needed.
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

// The earlier no-op was an extraction boundary (see the historical rationale above).
// The transport is now ported: use its prompt-free initialize/session-new handshake by default.
const nativeAcpModelProbe: AcpModelProbe = { detectModels: (required, optional = {}) =>
  probeNativeModels(required, { ...optional, ...(optional.env ? { env: optional.env as NodeJS.ProcessEnv } : {}) }) };
let activeAcpModelProbe: AcpModelProbe = nativeAcpModelProbe;

/** Install a transport/test double. Pass `null` to restore the native transport. */
export function setAcpModelProbe({ probe }: { probe: AcpModelProbe | null }): void {
  activeAcpModelProbe = probe ?? nativeAcpModelProbe;
}

/** Drop-in replacement for OD's `detectAcpModels` — delegates to whatever probe is currently installed. */
export async function detectAcpModels(requiredArgs: Pick<AcpModelProbeRequest, "bin" | "args">, optionalArgs: Omit<AcpModelProbeRequest, "bin" | "args"> = {}): Promise<RuntimeModelOption[]> {
  return activeAcpModelProbe.detectModels(requiredArgs, optionalArgs);
}
