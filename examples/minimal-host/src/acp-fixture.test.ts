import { describe, expect, it } from 'vitest';
import { createAgentExecutor, createInMemoryEventLog, createRunLifecycle } from '@jini-ai/daemon';
import type { AgentLaunchResolution } from '@jini-ai/core/contracts/agents';
import { acpFixtureDef } from './acp-fixture.js';
import { createAtomicWriterPort, createFileLockPort } from '@jini-ai/node-adapters/fs';
import { backupOriginalOnce, withFileLock, writeFileAtomicAsync, writeJsonFileAtomicAsync } from '@jini-ai/platform/fs';
import { createProcessControlPort, nodeCommandShell, nodeSpawnPort } from '@jini-ai/node-adapters/process';
import { listProcessSnapshots, stopProcesses, waitForProcessExit } from '@jini-ai/platform/process';
import type { AgentExecutorRuntimePorts } from '@jini-ai/daemon/ports/runtime';
import type { AgentRuntimePort } from '@jini-ai/daemon/ports/agent-runtime';
import { createAgentRuntimeBindings, createNativeAgentRuntime } from '@jini-ai/agent-runtime';

describe('minimal host static ACP definition', () => {
  it('runs the real permission and prompt exchange with no discovery ports', async () => {
    const def = acpFixtureDef();
    expect(def.discoverModels).toBeUndefined();
    expect(def.resolveDefaultModel).toBeUndefined();
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const launch: AgentLaunchResolution = { selectedPath: process.execPath, pathResolvedPath: process.execPath, configuredOverridePath: null, launchPath: process.execPath, launchKind: 'selected', childPathPrepend: [], diagnostic: null };
    let permissions = 0;
    const bound = createAgentRuntimeBindings({ runtime: createNativeAgentRuntime({ env: process.env }) }) satisfies AgentRuntimePort;
    const executor = createAgentExecutor({
      lifecycle, hostEnv: process.env,
      runtime: { spawn: nodeSpawnPort, processes: createProcessControlPort({ functions: { listProcessSnapshots, stopProcesses, waitForProcessExit } }), fileLock: createFileLockPort({ withFileLock }), writer: createAtomicWriterPort({ writeFileAtomicAsync, writeJsonFileAtomicAsync, backupOriginalOnce }), commandShell: nodeCommandShell({ env: process.env }) },
      agentRuntime: { ...bound, defs: { ...bound.defs, get: () => def, ensureCapabilities: async () => {} },
        launch: { ...bound.launch, resolve: () => launch, applyEnv: ({ env }) => env } },
    }, {
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
