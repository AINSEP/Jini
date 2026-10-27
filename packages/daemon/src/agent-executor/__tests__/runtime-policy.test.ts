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
import { parse } from 'smol-toml';

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
  { ownRuntimeState = true, codexMcpList }: { ownRuntimeState?: boolean; codexMcpList?: (env: NodeJS.ProcessEnv | undefined) => string } = {},
) {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const child = new FakeChild();
  const calls: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined; cwd: string | undefined }[] = [];
  const def: RuntimeAgentDef = { ...getAgentDef({ id: agentId })!, ...fixtureModelDiscovery };
  const executor = createAgentExecutor({ lifecycle }, {
    ...policies, hostEnv, ...(ownRuntimeState ? { runtimeState: createAgentRuntimeState({}) } : {}),
    getAgentDef: () => def,
    resolveAgentLaunch: () => ({ selectedPath: '/fake/cli', pathResolvedPath: '/fake/cli',
      configuredOverridePath: null, launchPath: '/fake/cli', launchKind: 'selected', childPathPrepend: [], diagnostic: null }),
    applyAgentLaunchEnv: ({ env }) => env, ensureAgentCapabilities: async () => {},
    spawn: ((command: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv; cwd?: string }) => {
      calls.push({ command, args, env: options.env, cwd: options.cwd });
      if (args[0] === 'mcp' && codexMcpList) {
        const list = new FakeChild();
        setImmediate(() => { list.stdout.end(codexMcpList(options.env)); setImmediate(() => list.emit('close', 0, null)); });
        return list as unknown as ChildProcess;
      }
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

/** Staged files by path, written by {@link fakeBridgeStaging}. */
const stagedFiles = new Map<string, string>();
/** The host's MCP bridge staging with every effect faked: Codex can only turn personal MCP off by
 *  staging a run-scoped CODEX_HOME, and a host always delivers its bridge that way. */
const fakeBridgeStaging: McpJsonInjectionOptions = {
  command: 'host-bridge', daemonUrl: 'http://site', linkSessionStore: async () => {}, removeDir: async () => {},
  mkdtemp: async ({ prefix }) => `/fake-tmp/${prefix}x`, writeFile: async ({ path, content }) => { stagedFiles.set(path, content); },
  readFile: async ({ path }) => { throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' }); },
};

/** A fake `codex mcp list --json`: like the real binary, it reads the servers from the `CODEX_HOME` in its own env. */
function listStagedServers(env: NodeJS.ProcessEnv | undefined): string {
  const config = parse(stagedFiles.get(`${env?.CODEX_HOME}/config.toml`) ?? '') as { mcp_servers?: Record<string, Record<string, unknown>> };
  return JSON.stringify(Object.entries(config.mcp_servers ?? {}).map(([name, server]) => ({ name, enabled: server.enabled !== false,
    transport: { type: 'stdio', command: server.command, args: server.args, env: server.env ?? null, env_vars: null, cwd: null } })));
}

it.each(['claude', 'codex'] as const)('still runs %s with personal MCP OFF', async agentId => {
  const policies = agentId === 'codex' ? { mcpJsonInjection: fakeBridgeStaging } : {};
  const run = await startFixture({ agentId, hostEnv: {} }, policies, { ...parityRun, nativeCapabilities: hostDefaultCapabilities }, { codexMcpList: listStagedServers });
  try { expect(run.calls).toHaveLength(agentId === 'codex' ? 2 : 1); } finally { run.child.emit('close', 0, null); }
});

// The preflight must load config exactly as the exec it guards: same binary, staged env, config cwd
// and loader flags. Any drift (the host env instead of the staged one, a dropped `-c`) lets the list
// vouch for a different config than the run loads.
it('asks Codex for its MCP servers with the exec run\'s own binary, env, cwd and loader flags', async () => {
  const run = await startFixture({ agentId: 'codex', hostEnv: { PATH: '/fake/bin' } }, { mcpJsonInjection: fakeBridgeStaging, codexDisablePlugins: true },
    { ...parityRun, nativeCapabilities: hostDefaultCapabilities }, { codexMcpList: listStagedServers });
  try {
    const [list, exec] = run.calls;
    expect(list!.args.slice(-2)).toEqual(['list', '--json']);
    expect(exec!.args[0]).toBe('exec');
    expect(list!.command).toBe(exec!.command);
    expect(list!.env).toEqual(exec!.env);
    expect(list!.env?.CODEX_HOME).toMatch(/^\/fake-tmp\/jini-codex-home-/);
    const execCwd = exec!.args.includes('-C') ? exec!.args[exec!.args.indexOf('-C') + 1] : exec!.cwd;
    expect(list!.cwd).toBe(execCwd);
    const loaderFlags = (args: readonly string[]) => args.flatMap((token, i) => (['-c', '--enable', '--disable'].includes(token) ? [token, args[i + 1]] : []));
    expect(loaderFlags(exec!.args)).toContain('features.apps=false');
    expect(loaderFlags(exec!.args)).toContain('--disable');
    expect(list!.args).toEqual(['mcp', ...loaderFlags(exec!.args), 'list', '--json']);
  } finally { run.child.emit('close', 0, null); }
});

it('refuses Codex before exec when the binary lists a server another config turns on', async () => {
  const withExtra = (env: NodeJS.ProcessEnv | undefined) => JSON.stringify([...JSON.parse(listStagedServers(env)) as unknown[],
    { name: 'corp_srv', enabled: true, transport: { type: 'stdio', command: 'corp', args: [], env: { TOKEN: 'corp-secret' } } }]);
  const attempt = startFixture({ agentId: 'codex', hostEnv: {} }, { mcpJsonInjection: fakeBridgeStaging },
    { ...parityRun, nativeCapabilities: hostDefaultCapabilities }, { codexMcpList: withExtra });
  await expect(attempt).rejects.toMatchObject({ code: 'NATIVE_TOOL_POLICY_UNSUPPORTED',
    message: "Codex can't run with 'Your MCP servers' off: another Codex config turns on the MCP server \"corp_srv\". Turn it on in the assistant settings, or choose Claude." });
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
