import type { spawn as nodeSpawn } from 'node:child_process';
import { fixtureModelDiscovery } from './model-discovery-fixture.js';
import { createAgentExecutor } from '../index.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createInMemoryEventLog } from '../../event-log.js';
import type { RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { expect, it } from 'vitest';
import { resolveRunEnv, selectAgentExecutorHostEnv, resolveSystemPromptOverlayDelivery } from '../launch.js';
import { configureExecutableResolutionEnv, createAgentRuntimeState, defaultRuntimeState } from '@jini-ai/agent-runtime';

it('preserves configured default resolution paths without passing a runtime state', () => {
  const previous = { ...defaultRuntimeState.executable.envNames };
  try {
    configureExecutableResolutionEnv({ overrides: { agentHomeEnvVar: 'HOST_RUNTIME_HOME', resourceRootEnvVar: 'HOST_RESOURCE_ROOT' } });
    const selected = selectAgentExecutorHostEnv({ env: {
      HOST_RUNTIME_HOME: '/host/runtime', HOST_RESOURCE_ROOT: '/host/resources', UNRELATED_TOKEN: 'fixture-secret',
    } });
    expect(selected).toEqual({ HOST_RUNTIME_HOME: '/host/runtime', HOST_RESOURCE_ROOT: '/host/resources' });
    expect(resolveRunEnv({ input: {}, hostEnv: selected })).toEqual({});
  } finally {
    configureExecutableResolutionEnv({ overrides: previous });
  }
});

// hwb #15: only known source-config keys accompany the existing baseline spawn environment.
it('snapshots an explicit host allowlist and keeps configuration paths out of the child environment', () => {
  const env = { PATH: '/bin', USER: 'operator', HOME: '/home/operator', CODEX_HOME: '/host/codex', CLAUDE_CONFIG_DIR: '/host/claude', UNRELATED_TOKEN: 'fixture-secret' };
  const state = createAgentRuntimeState({});
  state.executable.envNames.agentHomeEnvVar = 'HOST_RUNTIME_HOME';
  expect(selectAgentExecutorHostEnv({ env: { HOST_RUNTIME_HOME: '/host/runtime', UNRELATED_TOKEN: 'fixture-secret' } }, { runtimeState: state })).toEqual({ HOST_RUNTIME_HOME: '/host/runtime' });
  const selected = selectAgentExecutorHostEnv({ env });
  expect(selected).toEqual({ PATH: '/bin', USER: 'operator', HOME: '/home/operator', CODEX_HOME: '/host/codex', CLAUDE_CONFIG_DIR: '/host/claude' });
  env.CODEX_HOME = '/changed';
  expect(selected.CODEX_HOME).toBe('/host/codex');
  expect(resolveRunEnv({ input: { credentialEnv: { OPENAI_API_KEY: 'delegated-fixture' } }, hostEnv: selected })).toEqual({ PATH: '/bin', USER: 'operator', HOME: '/home/operator', OPENAI_API_KEY: 'delegated-fixture' });
});

it('uses the injected host capability state for overlay flags', () => {
  const a = createAgentRuntimeState({}); const b = createAgentRuntimeState({});
  a.capabilities.set('claude', { appendSystemPrompt: false });
  b.capabilities.set('claude', { appendSystemPrompt: true });
  const input = { defId: 'claude', systemPromptDelivery: { strategy: 'append-flag' as const, flag: '--append-system-prompt', capabilityKey: 'appendSystemPrompt' }, resumesSessionViaCli: undefined, resumesSessionViaAcpLoad: undefined, overlay: 'host overlay', prompt: 'question', resumeSessionId: undefined };
  expect(resolveSystemPromptOverlayDelivery(input, { state: a }).extraArgs).toEqual([]);
  expect(resolveSystemPromptOverlayDelivery(input, { state: b }).extraArgs).toEqual(['--append-system-prompt', 'host overlay']);
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
  const executor = createAgentExecutor({ lifecycle }, {
    hostEnv, runtimeState: state, getAgentDef: () => def,
    resolveAgentLaunch: () => ({ selectedPath: '/fake/host-agent', pathResolvedPath: '/fake/host-agent', configuredOverridePath: null, launchPath: '/fake/host-agent', launchKind: 'selected', childPathPrepend: [], diagnostic: null }),
    applyAgentLaunchEnv: ({ env }) => env, ensureAgentCapabilities: async () => {},
    spawn: ((_command: string, args: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => { calls.push({ args, env: options?.env }); throw new Error('stop after capturing spawn'); }) as unknown as typeof nodeSpawn,
  });
  hostEnv.HOME = '/changed';
  const { run } = await lifecycle.start({ contextRef: 'host-port-test' });
  await executor.run({ runId: run.id, agentId: def.id, prompt: 'question', cwd: '/work' }).catch(() => undefined);
  expect(calls).toEqual([{ args: ['--host-partials'], env: { PATH: '/host/bin', HOME: '/host/home' } }]);
});

// F1 fix wave (Stryker L8 §4 launch.ts:193-208 `typeof env[key]==='string'` → true survived):
// a present-but-non-string allowlisted key must not leak into the snapshot as a key at all.
it('F1: allowlisted and host-configured keys with non-string values are dropped, not copied as undefined', () => {
  const state = createAgentRuntimeState({});
  state.executable.envNames.agentHomeEnvVar = 'HOST_RUNTIME_HOME';
  const env = { CODEX_HOME: undefined, CLAUDE_CONFIG_DIR: 42 as unknown as string, HOST_RUNTIME_HOME: undefined, NPM_CONFIG_PREFIX: '/npm', FNM_DIR: '/fnm' };
  const selected = selectAgentExecutorHostEnv({ env }, { runtimeState: state });
  expect(selected).toEqual({ NPM_CONFIG_PREFIX: '/npm', FNM_DIR: '/fnm' });
  for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'HOST_RUNTIME_HOME']) expect(Object.keys(selected)).not.toContain(key);
});

it('F1: every documented config key is carried (first, middle and last of the list)', () => {
  const keys = ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'VELA_OPENCODE_BIN', 'AGENT_RUNTIME_HOME', 'AGENT_RUNTIME_RESOURCE_ROOT', 'VP_HOME', 'NPM_CONFIG_PREFIX', 'npm_config_prefix', 'APPDATA', 'LOCALAPPDATA', 'MISE_DATA_DIR', 'FNM_DIR'];
  const env = Object.fromEntries(keys.map((k) => [k, `/v/${k}`]));
  const state = createAgentRuntimeState({});
  expect(selectAgentExecutorHostEnv({ env }, { runtimeState: state })).toEqual(env);
});
