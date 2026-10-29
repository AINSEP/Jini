import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import type { RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { expect, it, vi } from 'vitest';
import { createAgentExecutor } from '../index.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createInMemoryEventLog } from '../../event-log.js';
import { fixtureLaunchModel, fixtureModelDiscovery } from './model-discovery-fixture.js';

const definition: RuntimeAgentDef = { ...fixtureModelDiscovery, id: 'm1-cli', name: 'Fixture CLI', bin: 'fixture',
  versionArgs: [], fallbackModels: [], streamFormat: 'acp-json-rpc', buildArgs: () => [], supportsNativeToolAccess: true };

async function start({ bridge }: { bridge: boolean }) {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
  const def = { ...definition, ...(bridge ? { externalMcpInjection: 'acp-merge' as const } : {}) };
  const executor = createAgentExecutor({ lifecycle }, { getAgentDef: () => def, hostEnv: {},
    resolveAgentLaunch: () => ({ selectedPath: '/fixture', pathResolvedPath: '/fixture', configuredOverridePath: null,
      launchPath: '/fixture', launchKind: 'selected', childPathPrepend: [], diagnostic: null }),
    applyAgentLaunchEnv: ({ env }) => env, ensureAgentCapabilities: async () => {}, resolveModelForLaunch: fixtureLaunchModel,
    spawn: (() => { queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess; }) as typeof nodeSpawn,
    attachAcpSession: () => ({ hasFatalError: () => false, getDurableSessionId: () => null, completedSuccessfully: () => true, abort() {} }),
    ...(bridge ? { mcpJsonInjection: { command: 'fixture-bridge', daemonUrl: 'http://daemon.invalid' } } : {}),
  });
  const { run } = await lifecycle.start({ contextRef: 'm1-relay' });
  await executor.run({ runId: run.id, agentId: def.id, cwd: '/fixture', prompt: 'Hello' });
  return { executor, runId: run.id, close: async () => { child.emit('close', 0, null); await lifecycle.waitForTerminal({ runId: run.id }); } };
}

it('keeps a live ACP run without a bridge on next-turn fallback', async () => {
  const f = await start({ bridge: false });
  try {
    expect(await f.executor.sendUserMessage({ runId: f.runId, text: 'Next' })).toBe('unsupported');
    expect(f.executor.claimUserMessages({ runId: f.runId, via: 'check_messages' })).toEqual([]);
  } finally { await f.close(); }
  expect(await f.executor.sendUserMessage({ runId: f.runId, text: 'Late' })).toBe('not-running');
});

it.each(['none', 'file', 'image'] as const)('queues ACP steering through the bridge and preserves the %s attachment boundary', async kind => {
  const f = await start({ bridge: true });
  try {
    expect(await f.executor.sendUserMessage({ runId: f.runId, id: 'message', text: 'Next',
      ...(kind === 'file' ? { attachmentIds: ['attachment:one'] } : {}) },
    kind === 'image' ? { imageContents: [{ mimeType: 'image/png', data: 'iVBORw==' }] } : {})).toBe('delivered');
    expect(f.executor.claimUserMessages({ runId: f.runId, via: 'check_messages' })).toEqual(
      kind === 'none' ? [{ id: 'message', seq: 1, text: 'Next' }] : []);
  } finally { await f.close(); }
});

it('names an unknown disabled capability in the refusal before any model probe or spawn', async () => {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const spawn = vi.fn();
  const resolveModelForLaunch = vi.fn();
  const executor = createAgentExecutor({ lifecycle }, { getAgentDef: () => ({ ...definition, supportsNativeToolAccess: false }), spawn, resolveModelForLaunch });
  const { run } = await lifecycle.start({ contextRef: 'm1-unknown-switch' });
  await expect(executor.run({ runId: run.id, agentId: definition.id, cwd: '/fixture', prompt: 'Hello' }, {
    nativeCapabilities: JSON.parse('{"futureSwitch":false}'),
  })).rejects.toMatchObject({ code: 'NATIVE_TOOL_POLICY_UNSUPPORTED',
    message: "Fixture CLI can't run with 'futureSwitch' off. Turn it on in the assistant settings, or choose Claude or Codex." });
  expect(spawn).not.toHaveBeenCalled();
  expect(resolveModelForLaunch).not.toHaveBeenCalled();
});
