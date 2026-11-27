/** The port binding closes over ONE runtime: its state, host env and definition policies. Real runtime owners, no mocks. */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createAgentRuntimeBindings } from '../runtime-port-bindings.js';
import { createNativeAgentRuntime } from '../native-runtime.js';
import { createAgentRuntimeState } from '../runtime-state.js';
import { getAgentDef } from '../registry.js';
import { discoveryContext, offlineDiscoveryDeps } from '../defs/__tests__/discovery-fakes.js';

const input = { prompt: 'question', imagePaths: [] };

function bound(env: Record<string, string> = {}, optional: Parameters<typeof createNativeAgentRuntime>[1] = {}) {
  const state = createAgentRuntimeState({});
  const runtime = createNativeAgentRuntime({ env }, { state, ...optional });
  return { state, runtime, port: createAgentRuntimeBindings({ runtime }) };
}

it('looks definitions up in the registry and answers null for an unknown id', () => {
  const { port } = bound();
  expect(port.defs.get({ id: 'claude' })?.id).toBe('claude');
  expect(port.defs.get({ id: 'no-such-cli' })).toBeNull();
});

it('reads capabilities from the bound state at call time, and undefined before a probe', () => {
  const { port, state } = bound();
  expect(port.defs.capabilities({ defId: 'claude' })).toBeUndefined();
  state.capabilities.set('claude', { addDir: false });
  expect(port.defs.capabilities({ defId: 'claude' })).toEqual({ addDir: false });
  expect(createAgentRuntimeBindings({ runtime: createNativeAgentRuntime({ env: {} }) }).defs.capabilities({ defId: 'claude' })).toBeUndefined();
});

it('binds the Codex plugin policy of its runtime onto a raw registry definition, without the caller passing it', () => {
  const raw = getAgentDef({ id: 'codex' })!;
  expect(raw.buildArgs(input)).not.toContain('--disable');
  const disabled = bound({ CODEX_DISABLE_PLUGINS: '1' }).port;
  const enabled = bound({ CODEX_DISABLE_PLUGINS: '1' }, { codex: { disablePlugins: false } }).port;
  const args = disabled.defs.bind({ def: raw }).buildArgs(input);
  expect(args.slice(args.indexOf('--disable'), args.indexOf('--disable') + 2)).toEqual(['--disable', 'plugins']);
  expect(enabled.defs.bind({ def: raw }).buildArgs(input)).not.toContain('--disable');
});

it('names the host env variables of the bound state', () => {
  const { port, state } = bound();
  // The state's own names, then the env keys the bound CLI strategies read (K01/K02: the daemon no longer lists them).
  expect(port.launch.hostEnvNames()).toEqual(['AGENT_RUNTIME_HOME', 'AGENT_RUNTIME_RESOURCE_ROOT', 'VELA_OPENCODE_BIN', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME']);
  state.executable.envNames.agentHomeEnvVar = 'HOST_HOME';
  expect(port.launch.hostEnvNames()).toEqual(['HOST_HOME', 'AGENT_RUNTIME_RESOURCE_ROOT', 'VELA_OPENCODE_BIN', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME']);
});

it('applies the launch env with the given path dirs, object arguments intact', () => {
  const { port } = bound({ PATH: '/host/bin' });
  const env = port.launch.applyEnv({ env: { PATH: '/usr/bin' }, launch: { childPathPrepend: ['/agent/bin'] } }, { nodeBinDir: '/node/bin', appendPathDirs: ['/tool/bin'] });
  expect(env.PATH?.split(':')).toEqual(['/node/bin', '/agent/bin', '/usr/bin', '/tool/bin']);
});

it('adapts the positional model identity helper to the object argument', () => {
  const { port } = bound();
  expect(port.models.identityKind({ id: 'opus' })).toBe('alias');
  expect(port.models.identityKind({ id: 'claude-opus-4-5-20251101' })).toBe('concrete');
});

it('plans a run and keeps the host facts inside the one required object', () => {
  const { port } = bound();
  const def = { name: 'Fixture', supportsNativeToolAccess: true, mcpIsolation: 'no-client' as const };
  expect(port.launch.planRun({ def, policy: {} }).verdict).toBe('RUN');
  expect(port.launch.planRun({ def, policy: {}, host: { installed: false } })).toEqual({ verdict: 'SETUP', reason: 'not_installed' });
});

it('feeds stream chunks to the parser and reports plain records', () => {
  const { port } = bound();
  const events: Record<string, unknown>[] = [];
  const handler = port.streams.jsonEvents({ kind: 'codex', onEvent: event => events.push(event) });
  handler.feed({ chunk: '{"type":"thread.started","thread_id":"t-1"}\n' });
  handler.flush();
  expect(events.length).toBeGreaterThan(0);
});

it('words a startup failure with the given notice and redacts exact secrets', () => {
  const { port } = bound();
  const message = port.failures.startupMessage({ stage: 'spawn', error: new Error('token sk-secret-1 rejected') }, { exactSecrets: ['sk-secret-1'], notice: 'Fix and resend.' });
  expect(message).toContain('Fix and resend.');
  expect(message).not.toContain('sk-secret-1');
});

it('binds the Claude executable grant and sandbox settings to the host input', () => {
  const { port } = bound();
  expect(port.filesystem.runtimePaths({ launchPath: process.execPath })).toEqual(
    [...new Set([resolve(process.execPath), realpathSync(process.execPath)])],
  );
  const settings = JSON.parse(port.filesystem.settings({ options: {
    filesystemRoot: '/workspace', settings: '{"variant":"fixture"}',
  } }, { platform: 'win32', homeDir: '/operator', tempDir: '/shared-temp', realpath: path => path }));
  expect(settings).toMatchObject({
    variant: 'fixture',
    autoMemoryEnabled: false,
    permissions: { blockReadsOutsideWorkingDirectories: true },
    sandbox: { enabled: false, allowUnsandboxedCommands: true },
  });
});

it('resolves the launch model with the clock owned by the bound host', async () => {
  const { port, state } = bound();
  state.discoveryDeps = { ...offlineDiscoveryDeps(), clock: { now: () => 123_456 } };
  const def = {
    id: 'fixture', name: 'Fixture', bin: 'fixture', versionArgs: ['--version'],
    streamFormat: 'text', buildArgs: () => [], fallbackModels: [{ id: 'vendor/concrete', label: 'Concrete model' }],
  };
  const result = await port.models.resolveForLaunch({ def, context: discoveryContext });
  expect(result.model).toBe('vendor/concrete');
  expect(result.resolution).toMatchObject({
    status: 'resolved', id: 'vendor/concrete', source: 'offline-fallback', resolvedAt: '1970-01-01T00:02:03.456Z',
  });
});
