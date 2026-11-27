/** The port binding closes over ONE runtime: its state, host env and definition policies. Real runtime owners, no mocks. */
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
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

describe('forwarders bound to the one runtime', () => {
  const made: string[] = [];
  function scratch(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'port-bindings-')));
    made.push(dir);
    return dir;
  }
  function script(dir: string, name: string, stdout: string): string {
    const file = join(dir, name);
    writeFileSync(file, `#!/bin/sh\necho '${stdout}'\n`);
    chmodSync(file, 0o755);
    return file;
  }
  afterEach(() => {
    vi.useRealTimers();
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const fixtureDef = (extra: Record<string, unknown> = {}) => ({
    id: 'fixture-cli', name: 'Fixture', bin: 'fixture-cli', versionArgs: ['--version'], streamFormat: 'text', buildArgs: () => [], fallbackModels: [], ...extra,
  });

  it('probes CLI capabilities into the bound state, not the default one', async () => {
    const { port, state } = bound();
    const launchPath = script(scratch(), 'fixture-cli', 'usage: --add-dir <dir>');
    const def = fixtureDef({ helpArgs: ['--help'], capabilityFlags: { '--add-dir': 'addDir', '--no-such-flag': 'other' } });
    await port.defs.ensureCapabilities({ def, launchPath, env: process.env });
    expect(state.capabilities.get('fixture-cli')).toEqual({ addDir: true, other: false });
  });

  it('resolves a launch against the host env PATH of the runtime', () => {
    const bin = scratch();
    script(bin, 'fixture-cli', '');
    const { port } = bound({ PATH: bin });
    const launch = port.launch.resolve({ def: fixtureDef() });
    expect(launch.launchPath).toBe(join(bin, 'fixture-cli'));
    expect(launch.childPathPrepend).toEqual([bin]);
    expect(bound({ PATH: scratch() }).port.launch.resolve({ def: fixtureDef() }).launchPath).toBeNull();
  });

  it('scopes toolchain dirs to the host agent home, and lets a call override the env', () => {
    const { port } = bound({ AGENT_RUNTIME_HOME: '/host-home' });
    const hostDirs = port.launch.toolchainBinDirs({});
    expect(hostDirs.length).toBeGreaterThan(0);
    expect(hostDirs.every(dir => dir.startsWith('/host-home/'))).toBe(true);
    const callDirs = port.launch.toolchainBinDirs({}, { env: { AGENT_RUNTIME_HOME: '/call-home' } });
    expect(callDirs.every(dir => dir.startsWith('/call-home/'))).toBe(true);
    // applyEnv appends the host-scoped toolchain dirs when the caller names none.
    const path = port.launch.applyEnv({ env: { PATH: '/usr/bin' }, launch: { childPathPrepend: [] } }, { nodeBinDir: '/node/bin' }).PATH;
    expect(path?.split(':')).toEqual(['/node/bin', '/usr/bin', ...hostDirs]);
  });

  it('returns the policy it is given for a native tool policy', () => {
    const policy = { nativeToolAccess: false, permissionMode: 'restricted' as const };
    expect(bound().port.launch.resolveNativeToolPolicy({ def: { name: 'Fixture' }, policy })).toBe(policy);
  });

  it('measures the prompt argv budget for the given platform', () => {
    const { port } = bound();
    const def = fixtureDef({ maxPromptArgBytes: 10 });
    // win32 keeps the definition's own limit; POSIX raises it to the shared argv budget.
    expect(port.launch.promptArgvBudget({ def, composed: 'x'.repeat(50) }, { platform: 'win32' })).toMatchObject({ code: 'AGENT_PROMPT_TOO_LARGE', bytes: 50, limit: 10 });
    expect(port.launch.promptArgvBudget({ def, composed: 'x'.repeat(50) }, { platform: 'linux' })).toBeNull();
  });

  it('refuses a Windows command line too long for a cmd shim or a direct exe', () => {
    const { port } = bound();
    const def = fixtureDef({ maxPromptArgBytes: 10 });
    const args = ['x'.repeat(40_000)];
    expect(port.launch.windowsCmdShimBudget({ def, resolvedBin: 'C:\\tools\\agent.cmd', args })).toMatchObject({ code: 'AGENT_PROMPT_TOO_LARGE' });
    expect(port.launch.windowsCmdShimBudget({ def, resolvedBin: 'C:\\tools\\agent.cmd', args: ['ok'] })).toBeNull();
    expect(port.launch.windowsDirectExeBudget({ def, resolvedBin: 'C:\\tools\\agent.exe', args })).toMatchObject({ code: 'AGENT_PROMPT_TOO_LARGE' });
    expect(port.launch.windowsDirectExeBudget({ def, resolvedBin: 'C:\\tools\\agent.exe', args: ['ok'] })).toBeNull();
  });

  it('writes the prompt file and prepares the log file only for definitions that ask for them', async () => {
    const { port } = bound();
    const prompt = await port.launch.preparePromptFile({ def: fixtureDef({ promptViaFile: true }), prompt: 'the prompt', label: 'run 1' });
    expect(readFileSync(prompt!.path, 'utf8')).toBe('the prompt');
    await prompt!.cleanup();
    expect(existsSync(dirname(prompt!.path))).toBe(false);
    expect(await port.launch.preparePromptFile({ def: fixtureDef(), prompt: 'p', label: 'run' })).toBeNull();
    const log = await port.launch.prepareLogFile({ def: fixtureDef({ needsAgentLogFile: true }), label: 'run 1' });
    expect(log!.path.endsWith('agent.log')).toBe(true);
    expect(existsSync(dirname(log!.path))).toBe(true);
    await log!.cleanup();
    expect(existsSync(dirname(log!.path))).toBe(false);
    expect(await port.launch.prepareLogFile({ def: fixtureDef(), label: 'run' })).toBeNull();
  });

  it('validates the launch root and the read-only dirs with the given home', () => {
    const { port } = bound();
    const site = scratch();
    expect(port.filesystem.validateLaunch({ filesystemRoot: site, cwd: site })).toBe(site);
    expect(() => port.filesystem.validateLaunch({ filesystemRoot: 'relative', cwd: site })).toThrow('filesystemRoot must be an absolute directory');
    expect(() => port.filesystem.validateLaunch({ filesystemRoot: site, cwd: scratch() })).toThrow('Working directory must equal filesystemRoot');
    const readOnly = scratch();
    expect(port.filesystem.validateReadOnlyExtraDirs({ filesystemRoot: site, dirs: [readOnly] }, { homeDir: scratch() })).toEqual([readOnly]);
    const home = join(readOnly, 'home');
    mkdirSync(home);
    expect(() => port.filesystem.validateReadOnlyExtraDirs({ filesystemRoot: site, dirs: [readOnly] }, { homeDir: home }))
      .toThrow('Read-only directory must not contain home or the site, nor lie inside the site');
  });

  it('caches the Claude support probe per binding, and a fresh probe reads the CLI again', async () => {
    const { port } = bound();
    const dir = scratch();
    const pinned = new Date(1_700_000_000_000);
    const launchPath = script(dir, 'claude', '2.1.300 (Claude Code)');
    utimesSync(launchPath, pinned, pinned);
    const env = process.env;
    expect(await port.filesystem.assertSupport({ agentId: 'codex', launchPath, env })).toBe(false);
    expect(await port.filesystem.assertSupport({ agentId: 'claude', launchPath, env })).toBe(true);
    script(dir, 'claude', '2.0.0 (Claude Code)');
    utimesSync(launchPath, pinned, pinned);
    expect(await port.filesystem.assertSupport({ agentId: 'claude', launchPath, env })).toBe(true);
    expect(await port.filesystem.createSupportProbe()({ agentId: 'claude', launchPath, env })).toBe(false);
  });

  it('selects strategies from what a definition declares', () => {
    const { port } = bound();
    expect(Object.keys(port.strategies.for({ def: fixtureDef() }))).toEqual(['filesystem']);
    expect(port.strategies.for({ def: port.defs.get({ id: 'claude' })! })).toHaveProperty('configDir');
  });

  it('parses Claude and Qoder streams into plain records', () => {
    const { port } = bound();
    const claude: Record<string, unknown>[] = [];
    const handler = port.streams.claude({ onEvent: event => claude.push(event) });
    handler.feed({ chunk: `${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'opus' })}\n` });
    expect(claude.length).toBeGreaterThan(0);
    const qoder: Record<string, unknown>[] = [];
    const qoderHandler = port.streams.qoder({ onEvent: event => qoder.push(event) });
    qoderHandler.feed({ chunk: 'not json\n' });
    expect(qoder).toEqual([{ type: 'raw', line: 'not json' }]);
  });
});

class FakeStdin extends EventEmitter {
  writes: string[] = [];
  write(chunk: string) { this.writes.push(chunk); return true; }
  end() { return this; }
}
class FakeChild extends EventEmitter {
  stdin = new FakeStdin();
  stdout = new EventEmitter();
  stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  killed = false;
  kill() { this.killed = true; return true; }
}
const asChild = (child: FakeChild) => child as unknown as ChildProcess;

describe('sessions bound to the runtime', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('opens an ACP session by sending initialize to the child', () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    bound().port.sessions.attachAcp({ child: asChild(child), prompt: 'hi', send: () => {} }, { clientName: 'fixture-client' });
    const first = JSON.parse(child.stdin.writes[0]!);
    expect(first).toMatchObject({ id: 1, method: 'initialize', params: { clientInfo: { name: 'fixture-client' } } });
  });

  it('applies the runtime Pi shutdown grace after agent_end', () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    bound({}, { pi: { gracefulShutdownMs: 100 } }).port.sessions.attachPiRpc({ child: asChild(child), prompt: 'hi', send: () => {} });
    child.stdout.emit('data', `${JSON.stringify({ type: 'agent_end' })}\n`);
    vi.advanceTimersByTime(99);
    expect(child.killed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(child.killed).toBe(true);
  });

  it('leaves the session default grace when the runtime sets none', () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    bound({}, { pi: {} }).port.sessions.attachPiRpc({ child: asChild(child), prompt: 'hi', send: () => {} });
    child.stdout.emit('data', `${JSON.stringify({ type: 'agent_end' })}\n`);
    vi.advanceTimersByTime(4999);
    expect(child.killed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(child.killed).toBe(true);
  });
});
