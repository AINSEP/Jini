import { expect, it, vi } from 'vitest';
import { getAgentDef } from '@jini-ai/agent-runtime';
import { buildCodexHomeConfigToml, buildMcpJsonServerEntry, prepareCodexHomeIfNeeded, resolveMcpBridgeForRun, writeMcpJsonIfNeeded } from '../mcp-bridge.js';

it('locked Claude staging never imports project MCP servers, even with an opt-in present elsewhere', async () => {
  let reads = 0; let written = '';
  const serverEntry = { command: 'bridge', args: [], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site' } };
  await writeMcpJsonIfNeeded({ input: { runId: 'run', cwd: '/site', nativeToolAccess: false,
    def: getAgentDef({ id: 'claude' })!, mcpBridge: { kind: 'claude-mcp-json', mcpJsonPath: '/site/.run.json', serverEntry },
  }, deps: { mcpJsonInjection: { command: 'bridge', daemonUrl: 'http://site',
      readFile: async () => { reads++; return '{"mcpServers":{"chrome":{"command":"chrome"}}}'; },
      writeFile: async ({ content }) => { written = content; },
    }, releaseStagedResources: async () => {}, failBeforeSpawn: async () => { throw new Error('staging failed'); } } });
  expect(reads).toBe(0);
  expect(Object.keys(JSON.parse(written).mcpServers)).toEqual(['jini']);
});

it('keeps personal MCP and CLI settings independently selectable in Codex staging', () => {
  const existingRaw = 'model = "personal-model"\n[mcp_servers.chrome]\ncommand = "chrome"\n[features]\nmulti_agent = true\n';
  const entry = { command: 'host-bridge', args: [], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site' } };
  const noMcp = buildCodexHomeConfigToml({ existingRaw, entry, inheritUserMcp: false });
  expect(noMcp).toContain('personal-model');
  expect(noMcp).not.toContain('chrome');
  expect(noMcp).toContain('host-bridge');
  const noSettings = buildCodexHomeConfigToml({ existingRaw, entry, inheritUserSettings: false });
  expect(noSettings).not.toContain('personal-model');
  expect(noSettings).not.toContain('multi_agent');
  expect(noSettings).toContain('chrome');
  expect(noSettings).toContain('host-bridge');
});

it('refuses an unrewritable inline MCP config instead of ignoring an OFF switch', () => {
  expect(() => buildCodexHomeConfigToml({ existingRaw: 'mcp_servers.chrome.command = "chrome"',
    entry: { command: 'host-bridge', args: [], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site' } }, inheritUserMcp: false })).toThrow('Cannot turn off personal MCP servers');
});

it('refuses to ignore a personal-MCP restriction when Codex home staging is unavailable', async () => {
  await expect(prepareCodexHomeIfNeeded({ input: { runId: 'run', def: getAgentDef({ id: 'codex' })!,
    mcpBridge: null, nativeToolAccess: true, nativeCapabilities: { userMcp: false },
  }, deps: { hostEnv: {}, mcpJsonInjection: undefined, releaseStagedResources: async () => {},
    failBeforeSpawn: async error => { throw error; },
  } })).rejects.toMatchObject({ code: 'NATIVE_TOOL_POLICY_UNSUPPORTED' });
});

const bridgeEntry = { command: 'host-bridge', args: [], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site' } };

it('drops a hand-written jini table and its subtables whatever their spelling', () => {
  const existingRaw = ['model = "m"', '  [ "mcp_servers" . \'jini\' ]  # stale', 'command = "old"', "['mcp_servers'.jini.env]", 'TOKEN = "old"', '[sandbox]', 'policy = "p"'].join('\n');
  expect(buildCodexHomeConfigToml({ existingRaw, entry: bridgeEntry }).split('\n').slice(0, 3)).toEqual(['model = "m"', '[sandbox]', 'policy = "p"']);
});

it('keeps a table whose name only starts like the jini table', () => {
  const existingRaw = '[mcp_servers.jini2]\ncommand = "other"';
  expect(buildCodexHomeConfigToml({ existingRaw, entry: bridgeEntry })).toContain('[mcp_servers.jini2]\ncommand = "other"');
});

it('drops the bare [mcp_servers] table when personal MCP is off', () => {
  const result = buildCodexHomeConfigToml({ existingRaw: '[mcp_servers]\nx = 1\n[ui]\ntheme = "dark"', entry: bridgeEntry, inheritUserMcp: false });
  expect(result.startsWith('[ui]\ntheme = "dark"\n\n')).toBe(true);
  expect(result).not.toContain('x = 1');
});

it('keeps an inline root MCP declaration untouched while personal MCP stays on', () => {
  expect(buildCodexHomeConfigToml({ existingRaw: 'mcp_servers = { chrome = { command = "chrome" } }', entry: bridgeEntry }))
    .toContain('mcp_servers = { chrome = { command = "chrome" } }');
});

it('names the inline shape and the fix when personal MCP cannot be turned off', () => {
  expect(() => buildCodexHomeConfigToml({ existingRaw: "'mcp_servers' = { chrome = { command = \"chrome\" } }", entry: bridgeEntry, inheritUserMcp: false }))
    .toThrow(new Error('Cannot turn off personal MCP servers: the Codex config.toml declares mcp_servers inline (a dotted key or `mcp_servers = {...}`), which cannot be removed safely; move each server into its own [mcp_servers.<name>] table.'));
});

const codexDef = getAgentDef({ id: 'codex' })!;
const refuse = async (error: { readonly code: string; readonly message: string }): Promise<never> => { throw error; };

it('refuses to ignore a personal-settings restriction when Codex home staging is unavailable', async () => {
  let released = 0;
  await expect(prepareCodexHomeIfNeeded({ input: { runId: 'run', def: codexDef, mcpBridge: null, nativeCapabilities: { userSettings: false } },
    deps: { hostEnv: {}, mcpJsonInjection: undefined, releaseStagedResources: async () => { released++; }, failBeforeSpawn: refuse } }))
    .rejects.toEqual({ runId: 'run', code: 'NATIVE_TOOL_POLICY_UNSUPPORTED', message: 'AgentExecutor: disabling personal Codex configuration requires run-scoped home staging.' });
  expect(released).toBe(1);
});

it('stages nothing for a Codex run without restrictions when the host has no codex-toml bridge', async () => {
  expect(await prepareCodexHomeIfNeeded({ input: { runId: 'run', def: codexDef, mcpBridge: null, nativeCapabilities: { userMcp: true, userSettings: true } },
    deps: { hostEnv: {}, mcpJsonInjection: undefined, releaseStagedResources: async () => {}, failBeforeSpawn: refuse } })).toBeNull();
});

it('stages nothing for a non-Codex agent even with personal MCP off', async () => {
  expect(await prepareCodexHomeIfNeeded({ input: { runId: 'run', def: getAgentDef({ id: 'claude' })!, mcpBridge: null, nativeCapabilities: { userMcp: false } },
    deps: { hostEnv: {}, mcpJsonInjection: undefined, releaseStagedResources: async () => {}, failBeforeSpawn: refuse } })).toBeNull();
});

async function stagedConfig(input: { readonly nativeToolAccess?: boolean; readonly nativeCapabilities?: { readonly userMcp?: boolean; readonly userSettings?: boolean } }): Promise<string> {
  const written = new Map<string, string>();
  await prepareCodexHomeIfNeeded({ input: { runId: 'run', def: codexDef, mcpBridge: { kind: 'codex-toml', serverEntry: bridgeEntry }, ...input },
    deps: { hostEnv: { CODEX_HOME: '/home/codex' }, releaseStagedResources: async () => {}, failBeforeSpawn: refuse, mcpJsonInjection: {
      command: 'host-bridge', daemonUrl: 'http://site', linkSessionStore: async () => {}, removeDir: async () => {},
      mkdtemp: async ({ prefix }) => `/tmp/${prefix}x`,
      readFile: async ({ path }) => { if (path === '/home/codex/config.toml') return 'model = "personal"\n[mcp_servers.chrome]\ncommand = "chrome"\n'; throw new Error(`ENOENT ${path}`); },
      writeFile: async ({ path, content }) => { written.set(path, content); },
    } } });
  return [...written.entries()].find(([path]) => path.endsWith('config.toml'))?.[1] ?? '';
}

it('copies personal settings and MCP servers into the staged Codex home by default', async () => {
  const config = await stagedConfig({});
  expect(config).toContain('model = "personal"');
  expect(config).toContain('[mcp_servers.chrome]');
});

it('keeps neither personal settings nor MCP servers when native tool access is off', async () => {
  const config = await stagedConfig({ nativeToolAccess: false });
  expect(config).not.toContain('personal');
  expect(config).not.toContain('chrome');
  expect(config).toContain('host-bridge');
});

it('drops only personal MCP servers when userMcp is off', async () => {
  const config = await stagedConfig({ nativeCapabilities: { userMcp: false } });
  expect(config).toContain('model = "personal"');
  expect(config).not.toContain('chrome');
});

it('keeps startup IDs independent of diagnostics and rejects forged reserved bridge environment', () => {
  const startupToolIds = vi.fn(({ runId }: { runId: string }) => [`${runId}_visible`]);
  const options = { command: 'bridge', args: ['serve'], daemonUrl: 'http://site', startupToolIds,
    diagnosticToolIds: () => ['diagnostic_only'],
    env: { ELECTRON_RUN_AS_NODE: '1', JINI_STARTUP_TOOL_IDS: '["forged"]', JINI_DIAGNOSTIC_TOOL_IDS: '["forged"]', JINI_RUN_ID: 'forged', JINI_DAEMON_TOKEN: 'forged' },
  };
  const first = buildMcpJsonServerEntry({ runId: 'first', options }, { credential: 'first-token' });
  const second = buildMcpJsonServerEntry({ runId: 'second', options }, { credential: 'second-token' });
  expect(first.env).toEqual({ ELECTRON_RUN_AS_NODE: '1', JINI_RUN_ID: 'first', JINI_DAEMON_URL: 'http://site',
    JINI_STARTUP_TOOL_IDS: '["first_visible"]', JINI_DIAGNOSTIC_TOOL_IDS: '["diagnostic_only"]', JINI_DAEMON_TOKEN: 'first-token' });
  expect(second.env.JINI_STARTUP_TOOL_IDS).toBe('["second_visible"]');
  expect(second.env.JINI_DAEMON_TOKEN).toBe('second-token');
  expect(first.args).not.toContain('first-token');
  expect(startupToolIds.mock.calls).toEqual([[{ runId: 'first' }], [{ runId: 'second' }]]);
});

it('omits startup publication metadata when only diagnostics were supplied', () => {
  const entry = buildMcpJsonServerEntry({ runId: 'run', options: { command: 'bridge', daemonUrl: 'http://site', diagnosticToolIds: () => ['diagnostic_only'],
    env: { JINI_STARTUP_TOOL_IDS: '["forged"]', JINI_DAEMON_TOKEN: 'forged' },
  } });
  expect(entry.env).toEqual({ JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site', JINI_DIAGNOSTIC_TOOL_IDS: '["diagnostic_only"]' });
});

// Release acceptance pins, recorded 2026-10-20; these unit tests prove staging only.
// Live typed invocation/refresh/approval on all four is NOT VERIFIED (cloud).
// Claude: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
// Codex: https://github.com/openai/codex/releases/tag/rust-v0.163.0
const cliReleasePins = [
  { agent: 'claude', version: '2.1.305' },
  { agent: 'claude', version: '2.1.304' },
  { agent: 'codex', version: '0.163.0' },
  { agent: 'codex', version: '0.162.1' },
] as const;

it.each(cliReleasePins)('stages startup IDs and the run credential using $agent $version delivery (not a live CLI test)', async ({ agent }) => {
  const written = new Map<string, string>();
  const def = getAgentDef({ id: agent })!;
  const options = { command: 'bridge', args: ['serve'], daemonUrl: 'http://site',
    startupToolIds: ({ runId }: { runId: string }) => [`${runId}_visible`], diagnosticToolIds: () => ['diagnostic_only'],
    credential: async ({ runId }: { runId: string }) => `${runId}-credential`,
    readFile: async () => { throw new Error('ENOENT'); }, writeFile: async ({ path, content }: { path: string; content: string }) => { written.set(path, content); },
    mkdtemp: async () => '/tmp/fake-m2-home', removeDir: async () => {}, linkSessionStore: async () => {},
  };
  const delivery = await resolveMcpBridgeForRun({ input: { runId: 'run', cwd: '/site', def },
    deps: { mcpJsonInjection: options, cleanupStagedFiles: async () => {}, failBeforeSpawn: refuse } });
  expect(delivery?.kind).toBe(agent === 'claude' ? 'claude-mcp-json' : 'codex-toml');
  if (agent === 'claude') {
    await writeMcpJsonIfNeeded({ input: { runId: 'run', cwd: '/site', def, mcpBridge: delivery },
      deps: { mcpJsonInjection: options, releaseStagedResources: async () => {}, failBeforeSpawn: refuse } });
    const config = JSON.parse([...written.values()][0]!) as { mcpServers: { jini: { env: Record<string, string> } } };
    expect(config.mcpServers.jini.env).toEqual({ JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site', JINI_DAEMON_TOKEN: 'run-credential',
      JINI_STARTUP_TOOL_IDS: '["run_visible"]', JINI_DIAGNOSTIC_TOOL_IDS: '["diagnostic_only"]' });
  } else {
    const home = await prepareCodexHomeIfNeeded({ input: { runId: 'run', def, mcpBridge: delivery },
      deps: { hostEnv: {}, mcpJsonInjection: options, releaseStagedResources: async () => {}, failBeforeSpawn: refuse } });
    const config = written.get('/tmp/fake-m2-home/config.toml')!;
    expect(config).toContain('JINI_STARTUP_TOOL_IDS = "[\\"run_visible\\"]"');
    expect(config).toContain('JINI_DIAGNOSTIC_TOOL_IDS = "[\\"diagnostic_only\\"]"');
    expect(config).toContain('JINI_DAEMON_TOKEN = "run-credential"');
    expect(config).toContain('tool_timeout_sec = 400');
    expect(home?.path).toBe('/tmp/fake-m2-home');
    await home?.cleanup();
  }
});

it('cleans up and fails before spawn if the startup ID resolver rejects', async () => {
  const cleanup = vi.fn(async () => {});
  await expect(resolveMcpBridgeForRun({ input: { runId: 'run', cwd: '/site', def: getAgentDef({ id: 'claude' })! },
    deps: { cleanupStagedFiles: cleanup, failBeforeSpawn: refuse, mcpJsonInjection: { command: 'bridge', daemonUrl: 'http://site',
      startupToolIds: () => { throw new Error('visibility unavailable'); },
    } },
  })).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
  expect(cleanup).toHaveBeenCalledTimes(1);
});
