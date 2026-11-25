import { expect, it } from 'vitest';
import { getAgentDef } from '@jini-ai/agent-runtime';
import { prepareBoundRunHome } from './runtime-fixture.js';
import { JINI_MCP_SERVER_KEY } from '../mcp-json-file.js';

it('refuses to ignore a personal-MCP restriction when Codex home staging is unavailable', async () => {
  await expect(prepareBoundRunHome({ input: { runId: 'run', def: getAgentDef({ id: 'codex' })!,
    mcpBridge: null, nativeToolAccess: true, nativeCapabilities: { userMcp: false },
  }, deps: { hostEnv: {}, mcpJsonInjection: undefined, releaseStagedResources: async () => {},
    failBeforeSpawn: async error => { throw error; },
  } })).rejects.toMatchObject({ code: 'NATIVE_TOOL_POLICY_UNSUPPORTED' });
});

const bridgeEntry = { command: 'host-bridge', args: [], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site' } };

const codexDef = getAgentDef({ id: 'codex' })!;
const refuse = async (error: { readonly code: string; readonly message: string }): Promise<never> => { throw error; };

it('refuses to ignore a personal-settings restriction when Codex home staging is unavailable', async () => {
  let released = 0;
  await expect(prepareBoundRunHome({ input: { runId: 'run', def: codexDef, mcpBridge: null, nativeCapabilities: { userSettings: false } },
    deps: { hostEnv: {}, mcpJsonInjection: undefined, releaseStagedResources: async () => { released++; }, failBeforeSpawn: refuse } }))
    .rejects.toEqual({ runId: 'run', code: 'NATIVE_TOOL_POLICY_UNSUPPORTED', message: 'AgentExecutor: disabling personal Codex configuration requires run-scoped home staging.' });
  expect(released).toBe(1);
});

it('stages nothing for a Codex run without restrictions when the host has no codex-toml bridge', async () => {
  expect(await prepareBoundRunHome({ input: { runId: 'run', def: codexDef, mcpBridge: null, nativeCapabilities: { userMcp: true, userSettings: true } },
    deps: { hostEnv: {}, mcpJsonInjection: undefined, releaseStagedResources: async () => {}, failBeforeSpawn: refuse } })).toBeNull();
});

it('stages nothing for a non-Codex agent even with personal MCP off', async () => {
  expect(await prepareBoundRunHome({ input: { runId: 'run', def: getAgentDef({ id: 'claude' })!, mcpBridge: null, nativeCapabilities: { userMcp: false } },
    deps: { hostEnv: {}, mcpJsonInjection: undefined, releaseStagedResources: async () => {}, failBeforeSpawn: refuse } })).toBeNull();
});

async function stagedConfig(input: { readonly nativeToolAccess?: boolean; readonly nativeCapabilities?: { readonly userMcp?: boolean; readonly userSettings?: boolean } }): Promise<string> {
  const written = new Map<string, string>();
  await prepareBoundRunHome({ input: { runId: 'run', def: codexDef, mcpBridge: { kind: 'codex-toml', serverEntry: bridgeEntry }, ...input },
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


// The slot (agent-runtime) names the bridge table from its own copy of the key; the host's `JINI_MCP_SERVER_KEY` is the name
// every other delivery uses, so a drift would stage a config the CLI never finds the bridge in.
it('stages the bridge under the same server key the host uses for every other delivery', async () => {
  const config = await stagedConfig({});
  expect(config).toContain(`[mcp_servers.${JINI_MCP_SERVER_KEY}]\n`);
  expect(config).toContain(`[mcp_servers.${JINI_MCP_SERVER_KEY}.env]\n`);
});

// Sheet rule: a refused start acquires no resources. The refusal is decided from the real config alone, so nothing
// (no scratch dir, no auth.json link, no write) may exist at all, rather than be created and removed afterwards.
it('an isolation refusal acquires no scratch home and links no auth.json', async () => {
  const calls: string[] = [];
  await expect(prepareBoundRunHome({ input: { runId: 'run', def: codexDef, mcpBridge: { kind: 'codex-toml', serverEntry: bridgeEntry }, nativeCapabilities: { userMcp: false } },
    deps: { hostEnv: { CODEX_HOME: '/home/codex' }, releaseStagedResources: async () => {}, failBeforeSpawn: refuse, mcpJsonInjection: {
      command: 'host-bridge', daemonUrl: 'http://site',
      mkdtemp: async ({ prefix }) => { calls.push('mkdtemp'); return `/tmp/${prefix}x`; },
      removeDir: async () => { calls.push('removeDir'); },
      linkSessionStore: async () => { calls.push('link'); },
      readFile: async () => 'model = = not toml [',
      writeFile: async () => { calls.push('write'); },
    } } })).rejects.toMatchObject({ code: 'NATIVE_TOOL_POLICY_UNSUPPORTED' });
  expect(calls).toEqual([]);
});
