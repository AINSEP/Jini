import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getAgentDef, type attachAcpSession } from '@jini-ai/agent-runtime';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { runAcpDispatch } from '../events.js';
import {
  defaultRemoveMcpJsonFile,
  prepareClaudeConfigDirIfNeeded,
  unavailableJiniBridgeStatus,
  writeMcpJsonIfNeeded,
} from '../mcp-bridge.js';
import { prepareCodexHomeIfNeeded } from '../codex/home-staging.js';

/**
 * @file Staging the per-run MCP/config files on the real filesystem defaults (no seams injected),
 * the refusal paths a host's own seams can trigger, and the ACP attach options a direct
 * `runAcpDispatch` caller controls. Credentials in fixtures are built at runtime.
 */

const scratch = mkdtempSync(join(tmpdir(), 'jini-mcp-staging-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const refuse = async ({ message }: { message: string }): Promise<never> => { throw new Error(message); };
const serverEntry = { command: 'host-bridge', args: [], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site' } };
/** A credential-shaped fixture, assembled at runtime so no secret-like literal sits in the source. */
const fixtureCredential = () => JSON.stringify({ token: ['fixture', 'login', String(process.pid)].join('-') });

it('reports nothing to judge for an event that is not the init status, or carries no MCP server list', () => {
  expect(unavailableJiniBridgeStatus({ rawEvent: null })).toBeUndefined();
  expect(unavailableJiniBridgeStatus({ rawEvent: { type: 'text_delta', delta: 'hi' } })).toBeUndefined();
  expect(unavailableJiniBridgeStatus({ rawEvent: { type: 'status', label: 'ready', mcpServers: [] } })).toBeUndefined();
  expect(unavailableJiniBridgeStatus({ rawEvent: { type: 'status', label: 'initializing' } })).toBeUndefined();
  expect(unavailableJiniBridgeStatus({ rawEvent: { type: 'status', label: 'initializing', mcpServers: 'jini' } })).toBeUndefined();
});

describe('writeMcpJsonIfNeeded', () => {
  const def = getAgentDef({ id: 'claude' })!;
  const delivery = { kind: 'claude-mcp-json' as const, mcpJsonPath: '/site/.jini-run.mcp.json', serverEntry };

  it('leaves the project .mcp.json out when the run turns personal MCP off', async () => {
    let reads = 0;
    let written = '';
    await writeMcpJsonIfNeeded({ input: { runId: 'run', cwd: '/site', nativeToolAccess: true, nativeCapabilities: { userMcp: false }, def, mcpBridge: delivery },
      deps: { mcpJsonInjection: { command: 'host-bridge', daemonUrl: 'http://site',
        readFile: async () => { reads += 1; return '{"mcpServers":{"chrome":{"command":"chrome"}}}'; },
        writeFile: async ({ content }) => { written = content; },
      }, releaseStagedResources: async () => {}, failBeforeSpawn: refuse } });
    expect(reads).toBe(0);
    expect(Object.keys((JSON.parse(written) as { mcpServers: object }).mcpServers)).toEqual(['jini']);
  });

  it('releases staged resources and fails before spawn when the config cannot be written', async () => {
    const releaseStagedResources = vi.fn(async () => {});
    await expect(writeMcpJsonIfNeeded({ input: { runId: 'run', cwd: '/site', def, mcpBridge: delivery },
      deps: { mcpJsonInjection: { command: 'host-bridge', daemonUrl: 'http://site',
        readFile: async () => { throw new Error('ENOENT'); },
        writeFile: async () => { throw new Error('EROFS: read-only file system'); },
      }, releaseStagedResources, failBeforeSpawn: refuse } }))
      .rejects.toThrow('AgentExecutor: could not write .mcp.json for agent "claude": EROFS: read-only file system');
    expect(releaseStagedResources).toHaveBeenCalledTimes(1);
  });
});

it('defaultRemoveMcpJsonFile deletes the run config and tolerates one already gone', async () => {
  const file = join(scratch, 'run.mcp.json');
  writeFileSync(file, '{}');
  await defaultRemoveMcpJsonFile({ path: file });
  expect(existsSync(file)).toBe(false);
  await expect(defaultRemoveMcpJsonFile({ path: file })).resolves.toBeUndefined();
});

it('stages a Codex home on the real filesystem, names it "run" for an empty run id, and cleans it up', async () => {
  const source = join(scratch, 'codex-source');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'config.toml'), 'model = "personal-model"\n');
  writeFileSync(join(source, 'auth.json'), fixtureCredential());
  const home = await prepareCodexHomeIfNeeded({ input: { runId: '', def: getAgentDef({ id: 'codex' })!, mcpBridge: { kind: 'codex-toml', serverEntry } },
    deps: { mcpJsonInjection: { command: 'host-bridge', daemonUrl: 'http://site' }, hostEnv: { CODEX_HOME: source },
      releaseStagedResources: async () => {}, failBeforeSpawn: refuse } });
  try {
    expect(dirname(home!.path)).toBe(tmpdir());
    expect(basename(home!.path)).toMatch(/^jini-codex-home-run-/);
    const config = readFileSync(join(home!.path, 'config.toml'), 'utf8');
    expect(config).toContain('model = "personal-model"');
    expect(config).toContain('[mcp_servers.jini]');
    expect(lstatSync(join(home!.path, 'auth.json')).isSymbolicLink()).toBe(true);
  } finally {
    await home!.cleanup();
  }
  expect(existsSync(home!.path)).toBe(false);
  expect(readFileSync(join(source, 'auth.json'), 'utf8')).toBe(fixtureCredential());
});

it('stages an isolated Claude config dir on the real filesystem with only the file-based login copied', async () => {
  const source = join(scratch, 'claude-source');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, '.credentials.json'), fixtureCredential());
  writeFileSync(join(source, 'settings.json'), '{"personal":true}');
  const dir = await prepareClaudeConfigDirIfNeeded({ input: { runId: '', def: getAgentDef({ id: 'claude' })! },
    deps: { enabled: true, claudeConfigDirIsolation: undefined, hostEnv: { CLAUDE_CONFIG_DIR: source },
      releaseStagedResources: async () => {}, failBeforeSpawn: refuse } });
  try {
    expect(dirname(dir!.path)).toBe(tmpdir());
    expect(basename(dir!.path)).toMatch(/^jini-claude-config-run-/);
    expect(readFileSync(join(dir!.path, '.credentials.json'), 'utf8')).toBe(fixtureCredential());
    expect(existsSync(join(dir!.path, 'settings.json'))).toBe(false);
  } finally {
    await dir!.cleanup();
  }
  expect(existsSync(dir!.path)).toBe(false);
  expect(existsSync(join(source, '.credentials.json'))).toBe(true);
});

it('removes a half-staged Claude config dir and fails before spawn when the login copy cannot be written', async () => {
  const removed: string[] = [];
  const releaseStagedResources = vi.fn(async () => {});
  await expect(prepareClaudeConfigDirIfNeeded({ input: { runId: 'run-1', def: getAgentDef({ id: 'claude' })! },
    deps: { enabled: true, hostEnv: { CLAUDE_CONFIG_DIR: '/operator/claude' }, releaseStagedResources, failBeforeSpawn: refuse,
      claudeConfigDirIsolation: {
        mkdtemp: async ({ prefix }) => `/scratch/${prefix}abc`,
        readFile: async () => fixtureCredential(),
        writeFile: async () => { throw new Error('ENOSPC: no space left on device'); },
        removeDir: async ({ path }) => { removed.push(path); },
      } } })).rejects.toThrow('ENOSPC: no space left on device');
  expect(removed).toEqual(['/scratch/jini-claude-config-run-1-abc']);
  expect(releaseStagedResources).toHaveBeenCalledTimes(1);
});

it('runAcpDispatch omits permissionMode from the ACP attach when its caller supplies none', async () => {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'acp-direct' });
  const child = Object.assign(new EventEmitter(), { pid: 5300, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
  const attached: Record<string, unknown>[] = [];
  const attach = ((required: Record<string, unknown>, optional: Record<string, unknown> = {}) => {
    attached.push({ ...required, ...optional });
    return { hasFatalError: () => false, getDurableSessionId: () => null, completedSuccessfully: () => true, abort: () => {} };
  }) as unknown as typeof attachAcpSession;
  await runAcpDispatch({
    input: { runId: run.id, agentId: 'acp-agent', child: child as unknown as ChildProcess, prompt: 'go', cwd: '/work',
      permissionMode: undefined, model: undefined, imagePaths: [], envFormat: undefined, mcpBridge: null },
    deps: { lifecycle, attachAcpSession: attach, onPermissionRequest: undefined, onCleanupFailure: () => {},
      cleanupStagedFiles: async () => {}, journal: undefined, classifyFailure: undefined, releaseStagedResources: async () => {},
      failBeforeSpawn: refuse, listProcessSnapshots: async () => [], collectProcessTreePids: () => [],
      stopProcesses: async () => ({ alreadyStopped: true, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] }) },
  });
  expect(Object.keys(attached[0]!).sort()).toEqual(['child', 'cwd', 'prompt', 'send']);
  // A run succeeds only once it has produced output.
  (attached[0]!.send as (args: { event: string; payload: unknown }) => void)({ event: 'agent', payload: { type: 'text_delta', delta: 'done' } });
  child.emit('close', 0, null);
  expect((await lifecycle.waitForTerminal({ runId: run.id })).state).toBe('succeeded');
});
