import { describe, expect, it } from 'vitest';
import type { spawn as nodeSpawn } from 'node:child_process';
import type { RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { createAgentExecutor, AgentExecutorError } from '../index.js';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { fixtureModelDiscovery } from './model-discovery-fixture.js';

function def(): RuntimeAgentDef {
  return { ...fixtureModelDiscovery, id: 'fixture', name: 'Fixture', bin: 'fixture', versionArgs: [], fallbackModels: [], streamFormat: 'plain', promptViaStdin: true,
    async resolveDefaultModel() { return { status: 'resolved', id: 'cli-pinned', source: 'rpc', resolvedAt: '2026-10-06T00:00:00.000Z', launchFingerprint: 'fixture' }; },
    buildArgs: (_required, { options = {} } = {}) => ['--model', options.model!],
  };
}
const launch = { selectedPath: '/fake', pathResolvedPath: '/fake', configuredOverridePath: null, launchPath: '/fake', launchKind: 'selected' as const, childPathPrepend: [], diagnostic: null };
describe('starting-model launch agreement', () => {
  it('passes the resolved default into the native model-selection flag', async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const agent = def(); const args: string[][] = [];
    const executor = createAgentExecutor({ lifecycle }, {
      getAgentDef: () => agent, resolveAgentLaunch: () => launch, ensureAgentCapabilities: async () => {}, applyAgentLaunchEnv: ({ env }) => env,
      createCommandInvocation: ({ command, args }) => ({ command, args: [...(args ?? [])], windowsVerbatimArguments: false }),
      spawn: ((_command: string, argv: readonly string[]) => { args.push([...argv]); throw new Error('Fixture stops before a real process'); }) as unknown as typeof nodeSpawn,
    });
    const { run } = await lifecycle.start({ contextRef: 'fixture' });
    await expect(executor.run({ runId: run.id, agentId: 'fixture', cwd: '/workspace', prompt: 'hello' })).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
    expect(args).toEqual([['--model', 'cli-pinned']]);
  });
  it('does not spawn or send a prompt when the concrete default is unresolved', async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const agent = def(); let spawned = false;
    agent.resolveDefaultModel = async () => ({ status: 'unresolved', selectionId: 'adaptive', reason: 'No concrete evidence' });
    const executor = createAgentExecutor({ lifecycle }, { getAgentDef: () => agent, resolveAgentLaunch: () => launch, ensureAgentCapabilities: async () => {}, applyAgentLaunchEnv: ({ env }) => env,
      spawn: (() => { spawned = true; throw new Error('Must not spawn'); }) as unknown as typeof nodeSpawn });
    const { run } = await lifecycle.start({ contextRef: 'fixture' });
    await expect(executor.run({ runId: run.id, agentId: 'fixture', cwd: '/workspace', prompt: 'hello' })).rejects.toEqual(new AgentExecutorError({ code: 'AGENT_MODEL_UNRESOLVED', message: 'AgentExecutor: pick a concrete model; the starting model could not be resolved for this launch.' }));
    expect(spawned).toBe(false);
  });
});
