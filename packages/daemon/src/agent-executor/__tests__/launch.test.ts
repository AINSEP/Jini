/** launch.ts boundaries the transport suites do not reach: real default seams, policy refusals, overlay staging. */
import { existsSync, promises as fsPromises } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PromptAugmenter, RuntimeAgentDef, resolveModelForLaunch } from '@jini-ai/agent-runtime';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle, type RunLifecycle } from '../../run-lifecycle.js';
import { AgentExecutorError, type AgentExecutorRunInput, type FailBeforeSpawn } from '../contracts.js';
import {
  buildAgentBuildArgsOptions,
  createAgentExecutor,
  guardWindowsCommandLineBudget,
  prepareSystemPromptOverlayFileIfNeeded,
} from '../launch.js';
import { fixtureLaunchModel, fixtureModelDiscovery } from './model-discovery-fixture.js';

/** A real `node` child as the agent CLI, so spawn/launch/stop run their production defaults. */
function nodeDef(script: string, overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
  return {
    ...fixtureModelDiscovery,
    id: 'node-agent',
    name: 'Node Agent',
    bin: 'node',
    versionArgs: ['--version'],
    fallbackModels: [],
    buildArgs: () => ['-e', script],
    streamFormat: 'plain',
    promptViaStdin: true,
    ...overrides,
  };
}

const NODE_HOST_ENV: NodeJS.ProcessEnv = { PATH: dirname(process.execPath) };

function createNodeExecutor(
  def: RuntimeAgentDef,
  optional: Parameters<typeof createAgentExecutor>[1] = {},
): { lifecycle: RunLifecycle; executor: ReturnType<typeof createAgentExecutor> } {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const executor = createAgentExecutor({ lifecycle }, {
    hostEnv: NODE_HOST_ENV,
    getAgentDef: ({ id }) => (id === def.id ? def : null),
    resolveModelForLaunch: fixtureLaunchModel,
    ensureAgentCapabilities: async () => {},
    ...optional,
  });
  return { lifecycle, executor };
}

async function agentText(lifecycle: RunLifecycle, runId: string): Promise<string> {
  const events: RunProtocolEvent[] = [];
  await lifecycle.stream({ runId, onEvent: (event) => events.push(event) });
  return events
    .map((event) => event.payload)
    .filter((payload): payload is { type: 'text_delta'; delta: string } =>
      typeof payload === 'object' && payload !== null && 'type' in payload && payload.type === 'text_delta')
    .map((payload) => payload.delta)
    .join('');
}

function rejectingFailBeforeSpawn(): FailBeforeSpawn & ReturnType<typeof vi.fn> {
  return vi.fn(async ({ code, message }: Parameters<FailBeforeSpawn>[0]): Promise<never> => {
    throw new AgentExecutorError({ code, message });
  });
}

describe('createAgentExecutor production defaults', () => {
  it('resolves, spawns and cancels a real child with the default launch, env and stop seams', async () => {
    const { lifecycle, executor } = createNodeExecutor(nodeDef('setInterval(() => {}, 1000)'), { codexDisablePlugins: true });
    const { run } = await lifecycle.start({ contextRef: 'defaults' });
    await executor.run({ runId: run.id, agentId: 'node-agent', prompt: 'hi', cwd: process.cwd() });
    await lifecycle.cancel({ runId: run.id });
    expect((await lifecycle.waitForTerminal({ runId: run.id })).state).toBe('cancelled');
  });
});

describe('AgentExecutor.run refusals', () => {
  it('refuses an unknown permission mode before resolving the agent', async () => {
    const getAgentDef = vi.fn(() => null);
    const { lifecycle, executor } = createNodeExecutor(nodeDef(''), { getAgentDef });
    const { run } = await lifecycle.start({ contextRef: 'bad-mode' });
    // A wire value that escaped type checking — the runtime guard is what stands behind the type.
    const permissionMode: NonNullable<AgentExecutorRunInput['permissionMode']> = JSON.parse('"auto"');
    await expect(executor.run({ runId: run.id, agentId: 'node-agent', prompt: 'hi', cwd: '/' }, { permissionMode }))
      .rejects.toThrow(new AgentExecutorError({ code: 'AGENT_PERMISSION_MODE_INVALID', message: 'AgentExecutor: permissionMode must be restricted or bypass' }));
    expect(getAgentDef).not.toHaveBeenCalled();
  });
});

describe('AgentExecutor.run model selection', () => {
  it('passes the run settings and setting sources to model selection', async () => {
    const selectModel = vi.fn<typeof resolveModelForLaunch>(fixtureLaunchModel);
    const { lifecycle, executor } = createNodeExecutor(nodeDef('process.stdin.resume()'), { resolveModelForLaunch: selectModel });
    const { run } = await lifecycle.start({ contextRef: 'settings' });
    await executor.run({ runId: run.id, agentId: 'node-agent', prompt: 'hi', cwd: process.cwd() }, { settingSources: ['user'], settings: '{"a":1}' });
    await lifecycle.waitForTerminal({ runId: run.id });
    expect(selectModel.mock.calls[0]![0].context).toMatchObject({ settingSources: ['user'], settings: '{"a":1}' });
  });
});

describe('AgentExecutor.run system-prompt overlay', () => {
  it('stages a config-instructions-file overlay for the child and removes it after close', async () => {
    const script = "const c = JSON.parse(process.env.NODE_AGENT_CONFIG); process.stdout.write(c.instructions[0] + '|' + require('fs').readFileSync(c.instructions[0], 'utf8'))";
    const def = nodeDef(script, { systemPromptDelivery: { strategy: 'config-instructions-file', varName: 'NODE_AGENT_CONFIG' } });
    const promptAugmenter: PromptAugmenter = { contextKinds: () => [], augmentUserRequest: ({ basePrompt }) => basePrompt, systemOverlay: () => 'house rules' };
    const { lifecycle, executor } = createNodeExecutor(def, { promptAugmenter });
    const { run } = await lifecycle.start({ contextRef: 'overlay-file' });
    await executor.run({ runId: run.id, agentId: 'node-agent', prompt: 'hi', cwd: process.cwd() });
    await lifecycle.waitForTerminal({ runId: run.id });
    const [overlayPath, overlayText] = (await agentText(lifecycle, run.id)).split('|');
    expect(overlayText).toBe('house rules');
    expect(existsSync(overlayPath!)).toBe(false);
  });

  // Pins current behaviour: the coarse turnIndex is documented as 0/1, but run() only ever hands
  // the augmenter a context without `hasPriorAssistantTurn`, so a resumed session still reads 0.
  it('asks the augmenter for turn 0 even when resuming a session', async () => {
    const systemOverlay = vi.fn((): string | null => null);
    const promptAugmenter: PromptAugmenter = { contextKinds: () => [], augmentUserRequest: ({ basePrompt }) => basePrompt, systemOverlay };
    const { lifecycle, executor } = createNodeExecutor(nodeDef('process.stdin.resume()'), { promptAugmenter });
    const { run } = await lifecycle.start({ contextRef: 'resume' });
    await executor.run({ runId: run.id, agentId: 'node-agent', prompt: 'hi', cwd: process.cwd() }, { resumeSessionId: 'prior-session' });
    await lifecycle.waitForTerminal({ runId: run.id });
    expect(systemOverlay).toHaveBeenCalledWith({ agentId: 'node-agent', turnIndex: 0 });
  });
});

describe('buildAgentBuildArgsOptions', () => {
  it('refuses an unknown permission mode', () => {
    const permissionMode: NonNullable<AgentExecutorRunInput['permissionMode']> = JSON.parse('"auto"');
    expect(() => buildAgentBuildArgsOptions({ input: { permissionMode }, systemPromptOverlay: undefined }))
      .toThrow(new AgentExecutorError({ code: 'AGENT_PERMISSION_MODE_INVALID', message: 'AgentExecutor: permissionMode must be restricted or bypass' }));
  });
});

describe('prepareSystemPromptOverlayFileIfNeeded', () => {
  const def = nodeDef('', { systemPromptDelivery: { strategy: 'config-instructions-file', varName: 'NODE_AGENT_CONFIG' } });

  it('names the staging directory "run" when the run id has no usable characters', async () => {
    const releaseStagedResources = vi.fn(async () => {});
    const staged = await prepareSystemPromptOverlayFileIfNeeded({ input: { runId: '', def, overlay: 'rules' }, deps: { releaseStagedResources, failBeforeSpawn: rejectingFailBeforeSpawn() } });
    expect(staged!.path).toMatch(/jini-system-prompt-overlay-run-[^/]+\/overlay\.md$/);
    await staged!.cleanup();
    expect(existsSync(staged!.path)).toBe(false);
  });

  it('releases staged resources and fails the run when the overlay cannot be written', async () => {
    const mkdtemp = vi.spyOn(fsPromises, 'mkdtemp').mockRejectedValueOnce(new Error('ENOSPC: no space left'));
    const releaseStagedResources = vi.fn(async () => {});
    const failBeforeSpawn = rejectingFailBeforeSpawn();
    try {
      await expect(prepareSystemPromptOverlayFileIfNeeded({ input: { runId: 'r1', def, overlay: 'rules' }, deps: { releaseStagedResources, failBeforeSpawn } }))
        .rejects.toThrow('AgentExecutor: could not stage a system-prompt overlay file for agent "node-agent": ENOSPC: no space left');
    } finally {
      mkdtemp.mockRestore();
    }
    expect(releaseStagedResources).toHaveBeenCalledOnce();
    expect(failBeforeSpawn).toHaveBeenCalledWith(expect.objectContaining({ runId: 'r1', code: 'AGENT_SPAWN_FAILED' }));
  });
});

describe('guardWindowsCommandLineBudget', () => {
  it('releases staged resources and fails with AGENT_PROMPT_TOO_LARGE for an oversized cmd-shim command line', async () => {
    const def = nodeDef('', { maxPromptArgBytes: 10 });
    const releaseStagedResources = vi.fn(async () => {});
    const failBeforeSpawn = rejectingFailBeforeSpawn();
    await expect(guardWindowsCommandLineBudget({ input: { runId: 'r1', def, launchPath: 'C:\\tools\\agent.cmd', args: ['x'.repeat(40_000)] }, deps: { releaseStagedResources, failBeforeSpawn } }))
      .rejects.toMatchObject({ code: 'AGENT_PROMPT_TOO_LARGE' });
    expect(releaseStagedResources).toHaveBeenCalledOnce();
  });
});
