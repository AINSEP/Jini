import { expect, it } from 'vitest';
import { getAgentDef } from '@jini-ai/agent-runtime';
import { buildCodexHomeConfigToml, prepareCodexHomeIfNeeded, writeMcpJsonIfNeeded } from '../mcp-bridge.js';

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
    entry: { command: 'host-bridge', args: [], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site' } }, inheritUserMcp: false })).toThrow('Cannot isolate inline MCP');
});

it('refuses to ignore a personal-MCP restriction when Codex home staging is unavailable', async () => {
  await expect(prepareCodexHomeIfNeeded({ input: { runId: 'run', def: getAgentDef({ id: 'codex' })!,
    mcpBridge: null, nativeToolAccess: true, nativeCapabilities: { userMcp: false },
  }, deps: { hostEnv: {}, mcpJsonInjection: undefined, releaseStagedResources: async () => {},
    failBeforeSpawn: async error => { throw error; },
  } })).rejects.toMatchObject({ code: 'NATIVE_TOOL_POLICY_UNSUPPORTED' });
});
