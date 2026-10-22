import type { spawn as nodeSpawn, SpawnOptions } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { getAgentDef } from '@jini-ai/agent-runtime';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createAgentExecutor } from '../index.js';
import { fixtureLaunchModel } from './model-discovery-fixture.js';

const CEILING_ENV = 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS';

/** Captures the real executor's spawn env through injected ports; no process or CLI probe runs. */
async function captureSpawnEnv(
  { agentId }: { agentId: string },
  { env }: { env?: NodeJS.ProcessEnv } = {},
): Promise<NodeJS.ProcessEnv> {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  let captured: NodeJS.ProcessEnv | undefined;
  // Accept both Node call shapes; throwing returns never, satisfying every child-process overload.
  const spawn: typeof nodeSpawn = (_command: string, argsOrOptions?: readonly string[] | SpawnOptions, options?: SpawnOptions): never => {
    captured = argsOrOptions && 'env' in argsOrOptions ? argsOrOptions.env : options?.env;
    throw new Error('Fixture stops after capturing spawn');
  };
  const executor = createAgentExecutor({ lifecycle }, {
    hostEnv: {},
    getAgentDef,
    resolveModelForLaunch: fixtureLaunchModel,
    ensureAgentCapabilities: async () => {},
    resolveAgentLaunch: () => ({
      selectedPath: '/fake/agent', pathResolvedPath: '/fake/agent', configuredOverridePath: null,
      launchPath: '/fake/agent', launchKind: 'selected', childPathPrepend: [], diagnostic: null,
    }),
    applyAgentLaunchEnv: ({ env: launchEnv }) => launchEnv,
    spawn,
  });
  const { run } = await lifecycle.start({ contextRef: 'background-ceiling' });
  await expect(executor.run(
    { runId: run.id, agentId, prompt: 'hello', cwd: '/work' },
    env === undefined ? {} : { env },
  )).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
  if (!captured) throw new Error('Fixture never reached spawn');
  return captured;
}

describe('Claude background task wait ceiling', () => {
  it('disables the ceiling in Claude spawn env while preserving existing defaults', async () => {
    // 2026-10-10: two plannie theme subagents were stopped ten minutes after the reply ended.
    const env = await captureSpawnEnv({ agentId: 'claude' });
    expect(env[CEILING_ENV]).toBe('0');
    expect(env.ENABLE_TOOL_SEARCH).toBe('false');
  });

  it.each(['1200000', '0'])('lets a host explicitly override the default with %s', async (value) => {
    // Paired baseline proves the default exists; an override alone would pass without the fix.
    expect((await captureSpawnEnv({ agentId: 'claude' }))[CEILING_ENV]).toBe('0');
    const env = await captureSpawnEnv({ agentId: 'claude' }, { env: { [CEILING_ENV]: value } });
    expect(env[CEILING_ENV]).toBe(value);
    expect(env.ENABLE_TOOL_SEARCH).toBe('false');
  });

  it.each(['codex', 'opencode', 'qwen'])('keeps the default exclusive to Claude when spawning %s', async (agentId) => {
    expect((await captureSpawnEnv({ agentId: 'claude' }))[CEILING_ENV]).toBe('0');
    expect(await captureSpawnEnv({ agentId })).not.toHaveProperty(CEILING_ENV);
  });
});
