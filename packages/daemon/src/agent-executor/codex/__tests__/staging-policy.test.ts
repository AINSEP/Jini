import { expect, it } from 'vitest';
import { getAgentDef } from '@jini-ai/agent-runtime';
import { buildCodexHomeConfigToml } from '../home-config.js';
import { prepareCodexHomeIfNeeded } from '../home-staging.js';

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
