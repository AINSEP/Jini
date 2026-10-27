import { expect, it, vi } from 'vitest';
import { getAgentDef } from '@jini-ai/agent-runtime';
import { buildMcpJsonServerEntry, resolveMcpBridgeForRun, writeMcpJsonIfNeeded } from '../mcp-bridge.js';
import { prepareCodexHomeIfNeeded } from '../codex/home-staging.js';

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

const refuse = async (error: { readonly code: string; readonly message: string }): Promise<never> => { throw error; };

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
