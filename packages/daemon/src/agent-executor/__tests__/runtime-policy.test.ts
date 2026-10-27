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
import type { McpJsonInjectionOptions } from '../index.js';

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
  { agentId, hostEnv }: { agentId: 'codex' | 'pi' | 'claude' | 'antigravity' | 'opencode'; hostEnv: NodeJS.ProcessEnv },
  policies: { codexDisablePlugins?: boolean; piGracefulShutdownMs?: number; mcpJsonInjection?: McpJsonInjectionOptions } = {},
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

// Owner 2026-10-26: admin chat on Gemini (antigravity) failed every run with "This CLI has no
// native-tool policy and audit adapter", because the host's default has personal MCP OFF and agy
// cannot keep it off. Interim decision B (2026-10-27): keep refusing, but say which CLI and which
// switch, and what to do.
const hostDefaultCapabilities = { shell: true, fileWrite: true, userMcp: false, subagents: true,
  userSettings: true, web: true, workflows: true, loginEnvironment: true };
const parityRun = { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass' } as const;

it.each([
  ['antigravity', "Antigravity can't run with 'Your MCP servers' off. Turn it on in the assistant settings, or choose Claude or Codex."],
  ['opencode', "OpenCode can't run with 'Your MCP servers' off. Turn it on in the assistant settings, or choose Claude or Codex."],
] as const)('refuses %s with personal MCP OFF, naming the CLI and the switch', async (agentId, message) => {
  await expect(startFixture({ agentId, hostEnv: {} }, {}, { ...parityRun, nativeCapabilities: hostDefaultCapabilities }))
    .rejects.toMatchObject({ code: 'NATIVE_TOOL_POLICY_UNSUPPORTED', message });
});

it('names every OFF switch, and the Full CLI switch when no single switch is the cause', async () => {
  await expect(startFixture({ agentId: 'antigravity', hostEnv: {} }, {}, { ...parityRun,
    nativeCapabilities: { ...hostDefaultCapabilities, shell: false } })).rejects.toMatchObject({ code: 'NATIVE_TOOL_POLICY_UNSUPPORTED',
    message: "Antigravity can't run with 'Bash/shell' and 'Your MCP servers' off. Turn them on in the assistant settings, or choose Claude or Codex." });
  await expect(startFixture({ agentId: 'antigravity', hostEnv: {} }, {}, { nativeToolAccess: true })).rejects.toMatchObject({
    code: 'NATIVE_TOOL_POLICY_UNSUPPORTED',
    message: "Antigravity can't run with this chat's CLI tool limits. Turn on 'Full CLI access' in the assistant settings, or choose Claude or Codex." });
});

/** The host's MCP bridge staging with every effect faked: Codex can only turn personal MCP off by
 *  staging a run-scoped CODEX_HOME, and a host always delivers its bridge that way. */
const fakeBridgeStaging: McpJsonInjectionOptions = {
  command: 'host-bridge', daemonUrl: 'http://site', linkSessionStore: async () => {}, removeDir: async () => {},
  mkdtemp: async ({ prefix }) => `/fake-tmp/${prefix}x`, writeFile: async () => {},
  readFile: async ({ path }) => { throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' }); },
};

it.each(['claude', 'codex'] as const)('still runs %s with personal MCP OFF', async agentId => {
  const policies = agentId === 'codex' ? { mcpJsonInjection: fakeBridgeStaging } : {};
  const run = await startFixture({ agentId, hostEnv: {} }, policies, { ...parityRun, nativeCapabilities: hostDefaultCapabilities });
  try { expect(run.calls).toHaveLength(1); } finally { run.child.emit('close', 0, null); }
});

// Option N (2026-10-27): no `codex mcp list` preflight. Listing configured servers can't vouch for
// servers Codex adds at runtime, and a second process can drift from the exec it guards.
it('runs Codex with personal MCP OFF as a single exec on the staged home', async () => {
  const run = await startFixture({ agentId: 'codex', hostEnv: {} }, { mcpJsonInjection: fakeBridgeStaging },
    { ...parityRun, nativeCapabilities: hostDefaultCapabilities });
  try {
    expect(run.calls.map(call => call.args[0])).toEqual(['exec']);
    expect(run.calls[0]!.env?.CODEX_HOME).toMatch(/^\/fake-tmp\/jini-codex-home-/);
  } finally { run.child.emit('close', 0, null); }
});

it('runs antigravity in parity once personal MCP is ON', async () => {
  const run = await startFixture({ agentId: 'antigravity', hostEnv: {} }, {}, { ...parityRun,
    nativeCapabilities: { ...hostDefaultCapabilities, userMcp: true } });
  try {
    expect(run.calls[0]!.args).toContain('--dangerously-skip-permissions');
    expect(run.calls[0]!.args.at(-2)).toBe('-p');
  } finally { run.child.emit('close', 0, null); }
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
