import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import type { AgentRuntimeStrategies } from '../ports/agent-runtime.js';
import type { ClaudeConfigDirIsolationOptions, FailBeforeSpawn, PreparedClaudeConfigDir } from './contracts.js';
import { errorMessage } from './values.js';

/** A staged scratch config directory together with the env key the runtime binds it under. */
export type StagedConfigDir = PreparedClaudeConfigDir & { readonly envKey: string };

/** The child env with the staged config directory set under the runtime's own key. Pure; returns a copy. */
export function withStagedConfigDir({ env, stagedConfigDir }: { env: NodeJS.ProcessEnv; stagedConfigDir: Pick<StagedConfigDir, 'envKey' | 'path'> }): NodeJS.ProcessEnv {
  return { ...env, [stagedConfigDir.envKey]: stagedConfigDir.path };
}

/**
 * Stages this run's scratch config directory through the runtime's bound `configDir` slot, returning the handle
 * `cleanupStagedFiles` should later release (`null` when the definition binds no such slot or the host left isolation off).
 *
 * Gated on `deps.enabled` (`CreateAgentExecutorOptions.claudeConfigDirIsolationEnabled`, default `false`) since this
 * task's own fix — see that field's doc for why it defaults off (Keychain login is `CLAUDE_CONFIG_DIR`-keyed and no
 * caller was supplying a credential when this was unconditional). The slot is bound by definition id, so a host that
 * flips this flag on should not suddenly stage a directory for `codebuddy` or any other def.
 * A staging failure releases what this run already staged and fails before spawn.
 * @param input.def - Used for the failure message.
 * @param deps.enabled - The isolation on/off switch — see this function's own doc above.
 * @param deps.hostEnv - The daemon's own environment, threaded through rather than read from a module-level `process.env`.
 * @complexity O(1) plus the slot's own cost.
 */
export async function prepareStagedConfigDirIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef; readonly configDir: AgentRuntimeStrategies['configDir'] }; readonly deps: {
    readonly enabled: boolean;
    readonly claudeConfigDirIsolation: ClaudeConfigDirIsolationOptions | undefined;
    readonly hostEnv: NodeJS.ProcessEnv;
    readonly releaseStagedResources: () => Promise<void>;
    readonly failBeforeSpawn: FailBeforeSpawn;
  } }
): Promise<StagedConfigDir | null> {
  const { configDir } = input;
  if (configDir === undefined || !deps.enabled) {
    return null;
  }
  try {
    const prepared = await configDir.stage({ runId: input.runId, hostEnv: deps.hostEnv }, { seams: deps.claudeConfigDirIsolation });
    return { ...prepared, envKey: configDir.envKey };
  } catch (err) {
    await deps.releaseStagedResources();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not stage a ${configDir.envKey} for agent "${input.def.id}": ${errorMessage({ err })}` },
    );
  }
}
