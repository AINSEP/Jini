import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { getAgentDef } from '@jini-ai/agent-runtime';
import { expect, it } from 'vitest';
import { prepareCodexHomeIfNeeded } from '../home-staging.js';

it.each(['stdio', 'http'] as const)('host-owned %s bridge staging keeps locked native capabilities and cleans up', async transport => {
  let content = '';
  let removed = false;
  const input = {
    runId: 'locked', def: getAgentDef({ id: 'codex' })!, nativeToolAccess: false,
    nativeCapabilities: { userMcp: false, userSettings: false },
    mcpBridge: transport === 'stdio' ? { kind: 'codex-toml' as const, serverEntry: { command: 'node', args: ['bridge'], env: { JINI_RUN_ID: 'locked', JINI_DAEMON_URL: 'http://daemon' } } } : null,
    ...(transport === 'http' ? { httpEndpoint: { url: 'http://127.0.0.1:1234/mcp', token: 'fixture', close: async () => {} } } : {}),
  };
  const staged = await prepareCodexHomeIfNeeded({ input, deps: {
    hostEnv: {}, releaseStagedResources: async () => {}, failBeforeSpawn: async error => { throw error; },
    mcpJsonInjection: {
      command: 'node', daemonUrl: 'http://daemon', toolApprovalOwner: 'host',
      mkdtemp: async () => '/fixture-locked-home', readFile: async () => { throw new Error('locked runs must not read personal config'); },
      writeFile: async value => { content = value.content; }, linkSessionStore: async (_required, optional) => { expect(optional?.inheritUserConfig).toBe(false); },
      removeDir: async () => { removed = true; },
    },
  } });
  expect(parse(content).mcp_servers).toMatchObject({ jini: { default_tools_approval_mode: 'approve' } });
  expect(Object.keys(parse(content).mcp_servers as object)).toEqual(['jini']);
  expect(input.nativeToolAccess).toBe(false);
  expect(input.nativeCapabilities).toEqual({ userMcp: false, userSettings: false });
  await staged!.cleanup();
  expect(removed).toBe(true);
});

it('HTTP configuration preserves MCP isolation and native state links', async () => {
  const source = await mkdtemp(join(tmpdir(), 'codex-source-'));
  await mkdir(join(source, 'sessions'));
  await writeFile(join(source, 'sessions', 'native.jsonl'), 'native session');
  await writeFile(join(source, 'auth.json'), 'old login');
  await writeFile(join(source, 'config.toml'), 'model = "personal"\n[mcp_servers.chrome]\ncommand = "chrome"\n[projects."/personal"]\ntrust_level = "trusted"\n');
  const staged = await prepareCodexHomeIfNeeded({ input: { runId: 'http', def: getAgentDef({ id: 'codex' })!, mcpBridge: null,
    nativeCapabilities: { userMcp: false }, httpEndpoint: { url: 'http://127.0.0.1:1234/mcp', token: 'endpoint', close: async () => {} },
  }, deps: { hostEnv: { CODEX_HOME: source }, mcpJsonInjection: { command: 'node', daemonUrl: 'http://daemon.invalid' },
    releaseStagedResources: async () => {}, failBeforeSpawn: async error => { throw error; },
  } });
  try {
    expect(staged).not.toBeNull();
    const config = parse(await readFile(join(staged!.path, 'config.toml'), 'utf8'));
    expect(config.projects).toBeUndefined();
    expect(config.model).toBe('personal');
    expect(config.mcp_servers).toEqual({ jini: { url: 'http://127.0.0.1:1234/mcp', tool_timeout_sec: 400, http_headers: { Authorization: 'Bearer endpoint' } } });
    expect(await readFile(join(staged!.path, 'sessions', 'native.jsonl'), 'utf8')).toBe('native session');
    await writeFile(join(source, 'auth.json'), 'rotated login');
    expect(await readFile(join(staged!.path, 'auth.json'), 'utf8')).toBe('rotated login');
    await staged!.cleanup();
    await expect(access(staged!.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(source, 'sessions', 'native.jsonl'), 'utf8')).toBe('native session');
    expect(await readFile(join(source, 'auth.json'), 'utf8')).toBe('rotated login');
  } finally { await staged?.cleanup(); await rm(source, { recursive: true, force: true }); }
});
