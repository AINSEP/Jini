/** Real executor/definition/session wiring with fake child processes; no subprocess or module mocks. */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { createAgentRuntimeState, getAgentDef, type RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { createAgentExecutor } from '../index.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createInMemoryEventLog } from '../../event-log.js';
import { fixtureModelDiscovery } from './model-discovery-fixture.js';

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  signals: string[] = [];
  kill(signal: string) { this.killed = true; this.signals.push(signal); return true; }
}
afterEach(() => vi.useRealTimers());

/** Run through real launch composition and native protocol attachment with only OS effects replaced. */
async function startFixture(
  { agentId, hostEnv }: { agentId: 'codex' | 'pi' | 'claude'; hostEnv: NodeJS.ProcessEnv },
  policies: { codexDisablePlugins?: boolean; piGracefulShutdownMs?: number } = {},
  runPolicy: { nativeToolAccess?: boolean; nativeCapabilities?: Partial<import('@jini-ai/agent-runtime').NativeCapabilities>; cliParity?: boolean; permissionMode?: 'bypass' | 'restricted' } = {},
  { ownRuntimeState = true }: { ownRuntimeState?: boolean } = {},
) {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const child = new FakeChild();
  const calls: { args: readonly string[]; env: NodeJS.ProcessEnv | undefined }[] = [];
  const def: RuntimeAgentDef = { ...getAgentDef({ id: agentId })!, ...fixtureModelDiscovery };
  const executor = createAgentExecutor({ lifecycle }, {
    ...policies, hostEnv, ...(ownRuntimeState ? { runtimeState: createAgentRuntimeState({}) } : {}),
    getAgentDef: () => def,
    resolveAgentLaunch: () => ({ selectedPath: '/fake/cli', pathResolvedPath: '/fake/cli',
      configuredOverridePath: null, launchPath: '/fake/cli', launchKind: 'selected', childPathPrepend: [], diagnostic: null }),
    applyAgentLaunchEnv: ({ env }) => env, ensureAgentCapabilities: async () => {},
    spawn: ((_command: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
      calls.push({ args, env: options.env });
      queueMicrotask(() => child.emit('spawn'));
      return child as unknown as ChildProcess;
    }) as typeof nodeSpawn,
  });
  const { run } = await lifecycle.start({ contextRef: 'host-policy' });
  await executor.run({ runId: run.id, agentId, prompt: 'question', cwd: '/missing-fixture-workspace' }, runPolicy);
  return { child, calls };
}

it('carries the native-tool grant through real executor composition to Codex create argv', async () => {
  const granted = await startFixture({ agentId: 'codex', hostEnv: { PATH: '/fake/bin' } }, {}, { nativeToolAccess: true });
  const locked = await startFixture({ agentId: 'codex', hostEnv: { PATH: '/fake/bin' } }, {}, { nativeToolAccess: false });
  try {
    expect(granted.calls[0]!.args).not.toContain('features.shell_tool=false');
    expect(locked.calls[0]!.args).toContain('features.shell_tool=false');
    expect(locked.calls[0]!.args).toContain('sandbox_mode="read-only"');
  } finally { granted.child.emit('close', 0, null); locked.child.emit('close', 0, null); }
});

it.each([true, false])('fails before spawn when an adapter cannot enforce/audit nativeToolAccess=%s', async nativeToolAccess => {
  await expect(startFixture({ agentId: 'pi', hostEnv: {} }, {}, { nativeToolAccess })).rejects.toMatchObject({ code: 'NATIVE_TOOL_POLICY_UNSUPPORTED' });
});

it('threads individual permissions through the real executor to CLI argv', async () => {
  const baseline = await startFixture({ agentId: 'claude', hostEnv: {} }, {}, { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass' });
  const restricted = await startFixture({ agentId: 'claude', hostEnv: {} }, {}, { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass',
    nativeCapabilities: { shell: false, subagents: false, userMcp: false } });
  try {
    for (const flag of ['Bash', 'Agent', '--strict-mcp-config']) {
      expect(baseline.calls[0]!.args).not.toContain(flag);
      expect(restricted.calls[0]!.args).toContain(flag);
    }
  } finally { baseline.child.emit('close', 0, null); restricted.child.emit('close', 0, null); }
});

it('refuses to ignore individual restrictions on an unsupported CLI even in parity mode', async () => {
  await expect(startFixture({ agentId: 'pi', hostEnv: {} }, {}, { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass',
    nativeCapabilities: { shell: false } })).rejects.toMatchObject({ code: 'NATIVE_TOOL_POLICY_UNSUPPORTED' });
});

it('passes explicit plugin policy through the executor instead of consulting ambient env in buildArgs', async () => {
  const hostEnv = { PATH: '/fake/bin', CODEX_DISABLE_PLUGINS: '1' };
  const baseline = await startFixture({ agentId: 'codex', hostEnv });
  const treatment = await startFixture({ agentId: 'codex', hostEnv }, { codexDisablePlugins: false });
  try {
    const args = baseline.calls[0]!.args;
    const i = args.indexOf('--disable');
    expect(args.slice(i, i + 2)).toEqual(['--disable', 'plugins']);
    expect(treatment.calls[0]!.args).toEqual([...args.slice(0, i), ...args.slice(i + 2)]);
    expect(baseline.calls[0]!.env).toEqual({ PATH: '/fake/bin' });
  } finally {
    baseline.child.emit('close', 0, null); treatment.child.emit('close', 0, null);
  }
});

it('binds the plugin policy against the process default runtime state when the host owns none', async () => {
  const hostEnv = { PATH: '/fake/bin' };
  const disabled = await startFixture({ agentId: 'codex', hostEnv }, { codexDisablePlugins: true }, {}, { ownRuntimeState: false });
  const enabled = await startFixture({ agentId: 'codex', hostEnv }, { codexDisablePlugins: false }, {}, { ownRuntimeState: false });
  try {
    const args = disabled.calls[0]!.args;
    const i = args.indexOf('--disable');
    expect(args.slice(i, i + 2)).toEqual(['--disable', 'plugins']);
    expect(enabled.calls[0]!.args).toEqual([...args.slice(0, i), ...args.slice(i + 2)]);
  } finally {
    disabled.child.emit('close', 0, null); enabled.child.emit('close', 0, null);
  }
});

it('carries host shutdown timing into the native pi session and keeps two executors independent', async () => {
  vi.useFakeTimers();
  const hostEnv = { PATH: '/fake/bin', PI_GRACEFUL_SHUTDOWN_MS: '100' };
  const baseline = await startFixture({ agentId: 'pi', hostEnv });
  const treatment = await startFixture({ agentId: 'pi', hostEnv }, { piGracefulShutdownMs: 700 });
  try {
    baseline.child.stdout.emit('data', '{"type":"agent_end"}\n');
    treatment.child.stdout.emit('data', '{"type":"agent_end"}\n');
    vi.advanceTimersByTime(99);
    expect(baseline.child.signals).toEqual([]); expect(treatment.child.signals).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(baseline.child.signals).toEqual(['SIGTERM']); expect(treatment.child.signals).toEqual([]);
    vi.advanceTimersByTime(600);
    expect(treatment.child.signals).toEqual(['SIGTERM']);
    expect(treatment.calls[0]!.env).toEqual({ PATH: '/fake/bin' });
  } finally {
    baseline.child.emit('close', 0, null); treatment.child.emit('close', 0, null);
  }
});

it('Claude parity removes only the eager MCP-loading default while keeping the background wait policy', async () => {
  const granted = await startFixture({ agentId: 'claude', hostEnv: { PATH: '/fake/bin' } }, {}, { cliParity: true, nativeToolAccess: true, permissionMode: 'bypass' });
  const locked = await startFixture({ agentId: 'claude', hostEnv: { PATH: '/fake/bin' } }, {}, { nativeToolAccess: false, permissionMode: 'restricted' });
  try {
    expect(granted.calls[0]!.env?.ENABLE_TOOL_SEARCH).toBeUndefined();
    expect(granted.calls[0]!.env?.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS).toBe('0');
    expect(locked.calls[0]!.env?.ENABLE_TOOL_SEARCH).toBe('false');
  } finally { granted.child.emit('close', 0, null); locked.child.emit('close', 0, null); }
});
