import { describe, expect, it } from 'vitest';
import { createAgentExecutor, createInMemoryEventLog, createRunLifecycle } from '@jini-ai/daemon';
import type { AgentLaunchResolution } from '@jini-ai/agent-runtime';
import { acpFixtureDef } from './acp-fixture.js';

describe('minimal host static ACP definition', () => {
  it('runs the real permission and prompt exchange with no discovery ports', async () => {
    const def = acpFixtureDef();
    expect(def.discoverModels).toBeUndefined();
    expect(def.resolveDefaultModel).toBeUndefined();
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const launch: AgentLaunchResolution = { selectedPath: process.execPath, pathResolvedPath: process.execPath, configuredOverridePath: null, launchPath: process.execPath, launchKind: 'selected', childPathPrepend: [], diagnostic: null };
    let permissions = 0;
    const executor = createAgentExecutor({ lifecycle }, {
      getAgentDef: () => def, resolveAgentLaunch: () => launch, applyAgentLaunchEnv: ({ env }) => env,
      ensureAgentCapabilities: async () => {},
      acpPermissionHandler: async () => { permissions++; return { outcome: 'selected', optionId: 'allow' }; },
    });
    const { run } = await lifecycle.start({ contextRef: 'fixture' });
    try {
      await executor.run({ runId: run.id, agentId: def.id, cwd: process.cwd(), prompt: 'hello' });
      expect((await lifecycle.waitForTerminal({ runId: run.id })).state).toBe('succeeded');
      expect(permissions).toBe(1);
      const payloads: unknown[] = [];
      await lifecycle.stream({ runId: run.id, onEvent: event => { if (event.kind === 'agent') payloads.push(event.payload); } });
      expect(payloads).toContainEqual({ type: 'status', label: 'starting_model', model: 'fixture-model' });
      expect(payloads).toContainEqual({ type: 'text_delta', delta: 'minimal-host ACP completed run' });
    } finally {
      // Failure must tear down the fixture process rather than leaving it behind after vitest.
      const state = (await lifecycle.get({ runId: run.id }))?.state;
      if (state === 'running' || state === 'queued' || state === 'starting') await lifecycle.cancel({ runId: run.id });
    }
  });
});
