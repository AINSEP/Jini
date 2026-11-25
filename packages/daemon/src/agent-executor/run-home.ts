import type { NativeCapabilities, RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import type { AgentRuntimeStrategies, PreparedRunHome } from '../ports/agent-runtime.js';
import type { FailBeforeSpawn, McpBridgeDelivery, McpHttpEndpoint, McpJsonInjectionOptions } from './contracts.js';
import { defaultReadMcpJsonFile, defaultWriteMcpJsonFile } from './mcp-json-file.js';
import { errorMessage } from './values.js';

/**
 * Phase 10b: stages this run's scratch home directory through the runtime's bound `mcpHome` slot, returning the prepared
 * handle `cleanupStagedFiles` should later release (`null` when the def has no such slot, or the host is unconfigured —
 * matching `writeMcpJsonIfNeeded`'s identical gate). The slot owns what goes into the directory and its isolation; this
 * owns the order the host depends on: a refusal or failure releases every earlier staged resource before the run fails.
 * @param input.def - Only used for its `id`, in the failure message.
 * @param input.mcpBridge - Existing stdio delivery; HTTP uses the optional `httpEndpoint` instead.
 * @param input.httpEndpoint - Explicit run listener, using the same isolation, state links and cleanup as stdio.
 * @param deps.mcpHome - The runtime's bound slot for `input.def` (`strategies.for({ def }).mcpHome`).
 * @param deps.hostEnv - The daemon's own environment, passed in rather than read from a module-level `process.env` so this phase stays testable with an injected env.
 * @complexity O(1) plus the slot's own cost.
 * @overallScore 100/100
 */
export async function prepareRunHomeIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly nativeToolAccess?: boolean | undefined; readonly nativeCapabilities?: Partial<NativeCapabilities>; readonly def: RuntimeAgentDef; readonly mcpBridge: McpBridgeDelivery | null; readonly httpEndpoint?: Pick<McpHttpEndpoint, 'url' | 'token'> }; readonly deps: {
    readonly mcpHome: AgentRuntimeStrategies['mcpHome'];
    readonly mcpJsonInjection: McpJsonInjectionOptions | undefined;
    readonly hostEnv: NodeJS.ProcessEnv;
    readonly releaseStagedResources: () => Promise<void>;
    readonly failBeforeSpawn: FailBeforeSpawn;
  } }
): Promise<PreparedRunHome | null> {
  const { mcpHome, mcpJsonInjection } = deps;
  if (mcpHome === undefined) return null;
  const entry = input.httpEndpoint ?? (input.mcpBridge?.kind === 'codex-toml' ? input.mcpBridge.serverEntry : undefined);
  if (entry === undefined || mcpJsonInjection === undefined) {
    if (mcpHome.turnsOffPersonalConfig(input)) {
      await deps.releaseStagedResources();
      return deps.failBeforeSpawn({ runId: input.runId, code: 'NATIVE_TOOL_POLICY_UNSUPPORTED',
        message: 'AgentExecutor: disabling personal Codex configuration requires run-scoped home staging.' });
    }
    return null;
  }
  let staged: Awaited<ReturnType<NonNullable<AgentRuntimeStrategies['mcpHome']>['stage']>>;
  try {
    staged = await mcpHome.stage({
      runId: input.runId, entry, nativeToolAccess: input.nativeToolAccess, nativeCapabilities: input.nativeCapabilities,
      hostEnv: deps.hostEnv, toolApprovalOwner: mcpJsonInjection.toolApprovalOwner,
      io: { ...mcpJsonInjection, readFile: mcpJsonInjection.readFile ?? defaultReadMcpJsonFile, writeFile: mcpJsonInjection.writeFile ?? defaultWriteMcpJsonFile },
    });
  } catch (err) {
    await deps.releaseStagedResources();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not stage a ${mcpHome.envVar} for agent "${input.def.id}": ${errorMessage({ err })}` },
    );
  }
  if (staged.kind === 'staged') return staged.home;
  await deps.releaseStagedResources();
  return deps.failBeforeSpawn({ runId: input.runId, code: 'NATIVE_TOOL_POLICY_UNSUPPORTED', message: staged.message });
}
