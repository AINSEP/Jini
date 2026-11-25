import type { spawn as nodeSpawn } from 'node:child_process';
import { fixtureModelDiscovery } from './model-discovery-fixture.js';
import { createAgentExecutor } from '../index.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createInMemoryEventLog } from '../../event-log.js';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import { expect, it } from 'vitest';
import { resolveRunEnv, selectAgentExecutorHostEnv, resolveSystemPromptOverlayDelivery } from '../launch.js';
import { createAgentRuntimeState } from '@jini-ai/agent-runtime';
import { runtimeFixture, agentRuntimeFixture } from './runtime-fixture.js';

it('copies host-configured resolution names from the runtime port, never from scanning the env', () => {
  const selected = selectAgentExecutorHostEnv({ env: {
    HOST_RUNTIME_HOME: '/host/runtime', HOST_RESOURCE_ROOT: '/host/resources', UNRELATED_TOKEN: 'fixture-secret',
  }, hostEnvNames: ['HOST_RUNTIME_HOME', 'HOST_RESOURCE_ROOT'] });
  expect(selected).toEqual({ HOST_RUNTIME_HOME: '/host/runtime', HOST_RESOURCE_ROOT: '/host/resources' });
  expect(resolveRunEnv({ input: {}, hostEnv: selected })).toEqual({});
});

// hwb #15: only known source-config keys accompany the existing baseline spawn environment.
it('snapshots an explicit host allowlist and keeps configuration paths out of the child environment', () => {
  const env = { PATH: '/bin', USER: 'operator', HOME: '/home/operator', CODEX_HOME: '/host/codex', CLAUDE_CONFIG_DIR: '/host/claude', UNRELATED_TOKEN: 'fixture-secret' };
  expect(selectAgentExecutorHostEnv({ env: { HOST_RUNTIME_HOME: '/host/runtime', UNRELATED_TOKEN: 'fixture-secret' }, hostEnvNames: ['HOST_RUNTIME_HOME'] })).toEqual({ HOST_RUNTIME_HOME: '/host/runtime' });
  const selected = selectAgentExecutorHostEnv({ env, hostEnvNames: [] });
  expect(selected).toEqual({ PATH: '/bin', USER: 'operator', HOME: '/home/operator', CODEX_HOME: '/host/codex', CLAUDE_CONFIG_DIR: '/host/claude' });
  env.CODEX_HOME = '/changed';
  expect(selected.CODEX_HOME).toBe('/host/codex');
  expect(resolveRunEnv({ input: { credentialEnv: { OPENAI_API_KEY: 'delegated-fixture' } }, hostEnv: selected })).toEqual({ PATH: '/bin', USER: 'operator', HOME: '/home/operator', OPENAI_API_KEY: 'delegated-fixture' });
});

it('reads the capability map the caller passes for overlay flags', () => {
  const input = { systemPromptDelivery: { strategy: 'append-flag' as const, flag: '--append-system-prompt', capabilityKey: 'appendSystemPrompt' }, resumesSessionViaCli: undefined, resumesSessionViaAcpLoad: undefined, overlay: 'host overlay', prompt: 'question', resumeSessionId: undefined };
  expect(resolveSystemPromptOverlayDelivery(input, { capabilities: { appendSystemPrompt: false } }).extraArgs).toEqual([]);
  expect(resolveSystemPromptOverlayDelivery(input, { capabilities: { appendSystemPrompt: true } }).extraArgs).toEqual(['--append-system-prompt', 'host overlay']);
});

it('unknown capability allows the flag; only an explicit false withholds it', () => {
  const input = { systemPromptDelivery: { strategy: 'append-flag' as const, flag: '--append-system-prompt', capabilityKey: 'appendSystemPrompt' }, resumesSessionViaCli: undefined, resumesSessionViaAcpLoad: undefined, overlay: 'host overlay', prompt: 'question', resumeSessionId: undefined };
  // Never probed: no map at all, or a map that does not name this key.
  expect(resolveSystemPromptOverlayDelivery(input, { capabilities: undefined }).extraArgs).toEqual(['--append-system-prompt', 'host overlay']);
  expect(resolveSystemPromptOverlayDelivery(input, { capabilities: {} }).extraArgs).toEqual(['--append-system-prompt', 'host overlay']);
  expect(resolveSystemPromptOverlayDelivery(input, { capabilities: { appendSystemPrompt: false } }).extraArgs).toEqual([]);
});

it('threads the host snapshot and bound capabilities through a real executor run', async () => {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const state = createAgentRuntimeState({});
  state.capabilities.set('host-agent', { partialMessages: true });
  const def: RuntimeAgentDef = {
    ...fixtureModelDiscovery, id: 'host-agent', name: 'Host Agent', bin: 'host-agent', versionArgs: [], fallbackModels: [],
    streamFormat: 'json-event-stream', eventParser: 'codex', promptViaStdin: true,
    buildArgs: (_input, { options } = {}) => options?.capabilities?.partialMessages ? ['--host-partials'] : [],
  };
  const hostEnv = { PATH: '/host/bin', HOME: '/host/home', UNRELATED_TOKEN: 'fixture-secret' };
  const calls: unknown[] = [];
  const executor = createAgentExecutor({ lifecycle, hostEnv: hostEnv, runtime: runtimeFixture({ spawn: ((_command: string, args: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => { calls.push({ args, env: options?.env }); throw new Error('stop after capturing spawn'); }) as unknown as typeof nodeSpawn }), agentRuntime: agentRuntimeFixture({ runtimeState: state, getAgentDef: () => def, resolveAgentLaunch: () => ({ selectedPath: '/fake/host-agent', pathResolvedPath: '/fake/host-agent', configuredOverridePath: null, launchPath: '/fake/host-agent', launchKind: 'selected', childPathPrepend: [], diagnostic: null }), applyAgentLaunchEnv: ({ env }) => env, ensureAgentCapabilities: async () => {} }, { env: hostEnv }) });
  hostEnv.HOME = '/changed';
  const { run } = await lifecycle.start({ contextRef: 'host-port-test' });
  await executor.run({ runId: run.id, agentId: def.id, prompt: 'question', cwd: '/work' }).catch(() => undefined);
  expect(calls).toEqual([{ args: ['--host-partials'], env: { PATH: '/host/bin', HOME: '/host/home' } }]);
});

// F1 fix wave (Stryker L8 §4 launch.ts:193-208 `typeof env[key]==='string'` → true survived):
// a present-but-non-string allowlisted key must not leak into the snapshot as a key at all.
it('F1: allowlisted and host-configured keys with non-string values are dropped, not copied as undefined', () => {
  const env = { CODEX_HOME: undefined, CLAUDE_CONFIG_DIR: 42 as unknown as string, HOST_RUNTIME_HOME: undefined, NPM_CONFIG_PREFIX: '/npm', FNM_DIR: '/fnm' };
  const selected = selectAgentExecutorHostEnv({ env, hostEnvNames: ['HOST_RUNTIME_HOME'] });
  expect(selected).toEqual({ NPM_CONFIG_PREFIX: '/npm', FNM_DIR: '/fnm' });
  for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'HOST_RUNTIME_HOME']) expect(Object.keys(selected)).not.toContain(key);
});

it('F1: every documented config key is carried (first, middle and last of the list)', () => {
  const keys = ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'AGENT_RUNTIME_HOME', 'AGENT_RUNTIME_RESOURCE_ROOT', 'VP_HOME', 'NPM_CONFIG_PREFIX', 'npm_config_prefix', 'APPDATA', 'LOCALAPPDATA', 'MISE_DATA_DIR', 'FNM_DIR'];
  const env = Object.fromEntries(keys.map((k) => [k, `/v/${k}`]));
  expect(selectAgentExecutorHostEnv({ env, hostEnvNames: [] })).toEqual(env);
});

// The Vela executable override is the runtime's to name (it moved out of the daemon's literal list): the bound port
// supplies it with the rest of its host-configured names, so the launcher still carries it and nothing else.
it('carries the executable override key the bound runtime names, and only through hostEnvNames', () => {
  const env = { VELA_OPENCODE_BIN: '/opt/vela/opencode', UNRELATED_TOKEN: 'fixture-secret' };
  expect(agentRuntimeFixture().launch.hostEnvNames()).toContain('VELA_OPENCODE_BIN');
  expect(selectAgentExecutorHostEnv({ env, hostEnvNames: agentRuntimeFixture().launch.hostEnvNames() })).toEqual({ VELA_OPENCODE_BIN: '/opt/vela/opencode' });
  expect(selectAgentExecutorHostEnv({ env, hostEnvNames: [] })).toEqual({});
});
