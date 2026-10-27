/**
 * "Your MCP servers" OFF on Codex: before the run, Jini asks the Codex binary itself
 * (`codex mcp list --json`, the same config loader `codex exec` uses) which MCP servers this exact
 * run would load, and refuses unless the only enabled one is the Jini bridge. Every source (system,
 * MDM, cloud bundle, trusted project, plugin) is covered because the binary resolves them, not Jini.
 * A fake `codex` child answers the list; no real binary runs.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { getAgentDef, type NativeCapabilities } from '@jini-ai/agent-runtime';
import { createCommandInvocation } from '@jini-ai/platform/command';
import { buildCodexMcpListArgs, preflightCodexMcpIsolationIfNeeded } from '../mcp-preflight.js';

const SECRET = 'run-bearer-SECRET-123';
const bridgeEntry = { command: 'host-bridge', args: ['serve'], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site', JINI_DAEMON_TOKEN: SECRET } };
const codexDef = getAgentDef({ id: 'codex' })!;
const execArgs = codexDef.buildArgs({ prompt: '', imagePaths: [] }, { options: { nativeToolAccess: true, nativeCapabilities: { userMcp: false } }, runtimeContext: { cwd: '/site/sub' } });

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killedWith: string | undefined;
  kill(signal: string) { this.killedWith = signal; return true; }
}

type Answer = { readonly stdout?: string; readonly code?: number | null; readonly hang?: boolean; readonly spawnError?: boolean };
type SpawnCall = { readonly command: string; readonly args: readonly string[]; readonly options: { cwd?: string; env?: NodeJS.ProcessEnv } };

/** A fake `spawn` whose child prints `stdout` (plus a stderr line carrying a secret) and exits with `code`. */
function fakeSpawn(answer: Answer): { spawn: typeof nodeSpawn; calls: SpawnCall[]; children: FakeChild[] } {
  const calls: SpawnCall[] = [];
  const children: FakeChild[] = [];
  const spawn = ((command: string, args: readonly string[], options: SpawnCall['options']) => {
    calls.push({ command, args, options });
    const child = new FakeChild();
    children.push(child);
    setImmediate(() => {
      if (answer.spawnError) { child.emit('error', new Error(`spawn ENOENT ${SECRET}`)); return; }
      if (answer.hang) return;
      child.stderr.end(`warning: token ${SECRET}\n`);
      child.stdout.end(answer.stdout ?? '');
      setImmediate(() => child.emit('close', answer.code === undefined ? 0 : answer.code, null));
    });
    return child as unknown as ChildProcess;
  }) as unknown as typeof nodeSpawn;
  return { spawn, calls, children };
}

const bridge = { name: 'jini', enabled: true, disabled_reason: null, auth_status: 'unsupported',
  transport: { type: 'stdio', command: 'host-bridge', args: ['serve'], env: { ...bridgeEntry.env }, env_vars: [], cwd: null } };
const server = (name: string, enabled: boolean) => ({ name, enabled, disabled_reason: null, auth_status: 'unsupported',
  transport: { type: 'stdio', command: `${name}-mcp`, args: [], env: { API_KEY: SECRET }, env_vars: [], cwd: null } });
const list = (...entries: unknown[]) => JSON.stringify(entries, null, 2);

type Refusal = { readonly code: string; readonly message: string };

async function preflight(answer: Answer, overrides: {
  readonly args?: readonly string[]; readonly nativeCapabilities?: Partial<NativeCapabilities>; readonly nativeToolAccess?: boolean; readonly def?: typeof codexDef;
} = {}): Promise<{ refusal: Refusal | null; calls: SpawnCall[]; children: FakeChild[]; released: number }> {
  const { spawn, calls, children } = fakeSpawn(answer);
  let released = 0;
  let refusal: Refusal | null = null;
  try {
    await preflightCodexMcpIsolationIfNeeded({
      input: { runId: 'run', def: overrides.def ?? codexDef, nativeToolAccess: overrides.nativeToolAccess ?? true,
        nativeCapabilities: overrides.nativeCapabilities ?? { userMcp: false },
        mcpBridge: { kind: 'codex-toml', serverEntry: bridgeEntry }, stagedHome: { path: '/tmp/home', cleanup: async () => {} },
        launchPath: '/bin/codex', args: overrides.args ?? execArgs, env: { CODEX_HOME: '/tmp/home', PATH: '/bin' }, cwd: '/site' },
      deps: { createCommandInvocation, spawn, releaseStagedResources: async () => { released += 1; },
        failBeforeSpawn: async (error) => { throw error; } },
    }, { timeoutMs: 50 });
  } catch (error) {
    refusal = error as Refusal;
  }
  return { refusal, calls, children, released };
}

function expectRefusal(refusal: Refusal | null, reason: string): void {
  expect(refusal?.code).toBe('NATIVE_TOOL_POLICY_UNSUPPORTED');
  expect(refusal?.message).toMatch(/^Codex can't run with 'Your MCP servers' off: /);
  expect(refusal?.message).toContain(reason);
  expect(refusal?.message).toMatch(/Turn it on in the assistant settings, or choose Claude\.$/);
  // `mcp list --json` prints stdio env and http headers unredacted; a refusal names servers only.
  expect(refusal?.message).not.toContain(SECRET);
}

describe('Codex MCP preflight: the binary decides which servers this run loads', () => {
  it('runs when the only enabled server is the bridge', async () => {
    const result = await preflight({ stdout: list(bridge) });
    expect(result.refusal).toBeNull();
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]!.args.slice(-2)).toEqual(['list', '--json']);
    expect(result.calls[0]!.args[0]).toBe('mcp');
  });

  it('runs when other servers are listed but disabled', async () => {
    expect((await preflight({ stdout: list(server('system_srv', false), bridge, server('project_srv', false)) })).refusal).toBeNull();
  });

  it.each(['system_srv', 'cloud_managed', 'project_srv', 'gmail@openai-curated'])('refuses an extra enabled server from any source (%s), naming it', async (name) => {
    const result = await preflight({ stdout: list(bridge, server(name, true)) });
    expectRefusal(result.refusal, `"${name}"`);
    expect(result.released).toBe(1);
  });

  it('names every extra enabled server', async () => {
    const result = await preflight({ stdout: list(server('a_srv', true), bridge, server('b_srv', true)) });
    expectRefusal(result.refusal, '"a_srv", "b_srv"');
  });

  it.each([
    ['the bridge missing', list(server('other', false)), `"jini"`],
    ['the bridge disabled', list({ ...bridge, enabled: false }), `"jini"`],
    ['the bridge command replaced by a higher layer', list({ ...bridge, transport: { ...bridge.transport, command: 'evil' } }), `"jini"`],
    ['the bridge args changed', list({ ...bridge, transport: { ...bridge.transport, args: ['serve', '--x'] } }), `"jini"`],
    ['an env var added to the bridge', list({ ...bridge, transport: { ...bridge.transport, env: { ...bridge.transport.env, NODE_OPTIONS: '--require evil' } } }), `"jini"`],
    ['host env forwarded to the bridge', list({ ...bridge, transport: { ...bridge.transport, env_vars: ['AWS_SECRET'] } }), `"jini"`],
    ['the bridge turned into an HTTP server', list({ ...bridge, transport: { type: 'streamable_http', url: 'https://evil.example' } }), `"jini"`],
  ])('refuses %s', async (_name, stdout, reason) => {
    expectRefusal((await preflight({ stdout })).refusal, reason);
  });

  it.each([
    ['a non-zero exit', { stdout: list(bridge), code: 1 }, "couldn't list"],
    ['a signal exit', { stdout: list(bridge), code: null }, "couldn't list"],
    ['output that is not JSON', { stdout: `not json ${SECRET}` }, "can't be read"],
    ['a JSON object instead of a list', { stdout: JSON.stringify({ servers: [] }) }, "can't be read"],
    ['an entry without a boolean enabled', { stdout: list({ name: 'x', enabled: 'yes' }, bridge) }, "can't be read"],
    ['an entry without a name', { stdout: list({ enabled: true }, bridge) }, "can't be read"],
    ['a spawn error', { spawnError: true }, "couldn't list"],
  ])('refuses on %s', async (_name, answer, reason) => {
    expectRefusal((await preflight(answer)).refusal, reason);
  });

  it('refuses and kills the list when it does not finish in time', async () => {
    const result = await preflight({ hang: true });
    expectRefusal(result.refusal, "didn't list");
    expect(result.children[0]!.killedWith).toBe('SIGKILL');
  });

  it('does not ask when personal MCP is on, or for another CLI', async () => {
    expect((await preflight({ stdout: 'never read' }, { nativeCapabilities: { userMcp: true } })).calls).toHaveLength(0);
    expect((await preflight({ stdout: 'never read' }, { def: getAgentDef({ id: 'claude' })! })).calls).toHaveLength(0);
  });

  it('asks when native tools are locked (personal MCP is off then too)', async () => {
    const locked = codexDef.buildArgs({ prompt: '', imagePaths: [] }, { options: { nativeToolAccess: false } });
    const result = await preflight({ stdout: list(bridge) }, { nativeToolAccess: false, nativeCapabilities: {}, args: locked });
    expect(result.calls).toHaveLength(1);
    expect(result.refusal).toBeNull();
  });
});

describe('Codex MCP preflight argv: same loader inputs as the exec it guards', () => {
  const configTokens = (args: readonly string[]): string[] => args.flatMap((token, i) =>
    ['-c', '--enable', '--disable'].includes(token) ? [token, args[i + 1]!] : []);

  it.each([
    ['create', codexDef.buildArgs({ prompt: '', imagePaths: ['/a.png'] }, { options: { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass', codexDisablePlugins: true, model: 'gpt-x', reasoning: 'high', nativeCapabilities: { userMcp: false, shell: false } }, extraAllowedDirs: ['/extra'], runtimeContext: { cwd: '/site/sub' } })],
    ['resume', codexDef.buildArgs({ prompt: '', imagePaths: [] }, { options: { nativeToolAccess: true, codexDisablePlugins: true, nativeCapabilities: { userMcp: false } }, runtimeContext: { resumeSessionId: 'thread-1' } })],
  ])('copies every -c/--enable/--disable of the %s turn, in order, and nothing exec-only', (_turn, args) => {
    const built = buildCodexMcpListArgs({ execArgs: args, cwd: '/site' });
    expect(built.args).toEqual(['mcp', ...configTokens(args), 'list', '--json']);
    expect(built.args).toContain('features.apps=false');
    expect(built.args).toContain('--disable');
  });

  it('lists in the directory exec loads config from: -C when given, else the spawn cwd', () => {
    expect(buildCodexMcpListArgs({ execArgs, cwd: '/site' }).cwd).toBe('/site/sub');
    const resume = codexDef.buildArgs({ prompt: '', imagePaths: [] }, { options: { nativeCapabilities: { userMcp: false } }, runtimeContext: { resumeSessionId: 't' } });
    expect(buildCodexMcpListArgs({ execArgs: resume, cwd: '/site' }).cwd).toBe('/site');
  });

  it.each([
    ['an unknown loader flag', [...execArgs.slice(0, 1), '--profile', 'work', ...execArgs.slice(1)], '"--profile"'],
    ['an --ignore-user-config flag', [...execArgs, '--ignore-user-config'], '"--ignore-user-config"'],
    ['a --config=inline spelling', [...execArgs, '--config=features.apps=true'], "can't be checked"],
    ['a stray positional', [...execArgs, 'stray'], "can't be checked"],
    ['a subcommand other than exec', ['review', ...execArgs.slice(1)], "can't be checked"],
  ])('refuses a run whose exec argv has %s (fails closed on drift)', async (_name, args, reason) => {
    const result = await preflight({ stdout: list(bridge) }, { args });
    expectRefusal(result.refusal, reason);
    expect(result.calls).toHaveLength(0);
  });

  // `codex_apps` is a runtime-only server `mcp list` never shows (codex-rs ext/mcp/src/lib.rs), so
  // the list can only vouch for a run that turns the `apps` feature off.
  it('refuses a run that does not turn ChatGPT apps off', async () => {
    const args = execArgs.map(token => (token === 'features.apps=false' ? 'features.apps=true' : token));
    expectRefusal((await preflight({ stdout: list(bridge) }, { args })).refusal, 'ChatGPT apps');
  });

  it('spawns with exactly the run env and the same invocation builder exec uses', async () => {
    const result = await preflight({ stdout: list(bridge) });
    const expected = createCommandInvocation({ command: '/bin/codex', args: buildCodexMcpListArgs({ execArgs, cwd: '/site' }).args, env: { CODEX_HOME: '/tmp/home', PATH: '/bin' } });
    expect(result.calls[0]!.command).toBe(expected.command);
    expect(result.calls[0]!.args).toEqual(expected.args);
    expect(result.calls[0]!.options.env).toEqual({ CODEX_HOME: '/tmp/home', PATH: '/bin' });
    expect(result.calls[0]!.options.cwd).toBe('/site/sub');
  });
});
