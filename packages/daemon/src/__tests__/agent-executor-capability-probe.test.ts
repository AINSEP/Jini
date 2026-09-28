import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { agentCapabilities, type AgentLaunchResolution, type RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle } from '../run-lifecycle.js';
import { createAgentExecutor } from '../agent-executor.js';

/**
 * The capability gate (`agentCapabilities`) used to be filled only by `detectAgents`, which a host's
 * run process may never call — so `claude` ran without `--include-partial-messages` (no streamed
 * text) on a CLI that supports it. The run path now asks for the probe itself, with the exact launch
 * path and env it is about to spawn, before `buildArgs` reads the gate.
 */
describe('AgentExecutor — probes the def\'s --help capabilities before buildArgs', () => {
  it('awaits ensureAgentCapabilities(def, launchPath, env) and buildArgs sees the probed flag', async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const probeCalls: Array<{ id: string; launchPath: string; hasEnv: boolean }> = [];
    const def: RuntimeAgentDef = {
      id: 'probe-agent',
      name: 'Probe Agent',
      bin: 'probe-bin',
      versionArgs: ['--version'],
      fallbackModels: [],
      helpArgs: ['--help'],
      capabilityFlags: { '--stream-partials': 'partialMessages' },
      buildArgs: () => (agentCapabilities.get('probe-agent')?.partialMessages ? ['--stream-partials'] : []),
      streamFormat: 'json-event-stream',
      eventParser: 'codex',
      promptViaStdin: true,
    };
    const spawnedArgs: string[][] = [];
    const executor = createAgentExecutor({
      lifecycle,
      getAgentDef: (id: string) => (id === def.id ? def : null),
      resolveAgentLaunch: () =>
        ({
          selectedPath: '/fake/probe-bin',
          pathResolvedPath: '/fake/probe-bin',
          configuredOverridePath: null,
          launchPath: '/fake/probe-bin',
          launchKind: 'selected',
          childPathPrepend: [],
          diagnostic: null,
        }) as AgentLaunchResolution,
      applyAgentLaunchEnv: (env) => env,
      ensureAgentCapabilities: async (probed, launchPath, env) => {
        probeCalls.push({ id: probed.id, launchPath, hasEnv: typeof env === 'object' && env !== null });
        agentCapabilities.set(probed.id, { partialMessages: true });
      },
      spawn: ((_command: string, args: readonly string[]) => {
        spawnedArgs.push([...args]);
        throw new Error('stop after argv');
      }) as unknown as typeof nodeSpawn,
    });
    try {
      const { run } = await lifecycle.start({ contextRef: 'ctx-probe' });
      await executor.run({ runId: run.id, agentId: def.id, prompt: 'hi', cwd: '/work' }).catch(() => undefined);
      expect(probeCalls).toEqual([{ id: 'probe-agent', launchPath: '/fake/probe-bin', hasEnv: true }]);
      expect(spawnedArgs).toEqual([['--stream-partials']]);
    } finally {
      agentCapabilities.delete('probe-agent');
    }
  });
});
