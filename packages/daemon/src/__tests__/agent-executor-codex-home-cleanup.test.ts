import { describe, expect, it, vi } from 'vitest';
import { getAgentDef } from '@jini-ai/agent-runtime';
import { prepareCodexHomeIfNeeded, type McpJsonInjectionOptions } from '../agent-executor.js';

/**
 * Verifies the copied Codex `auth.json` credential does not survive a run whose staging fails
 * partway through, and that the staged scratch directory is released once the run consumes and
 * calls back the returned `cleanup()` — the two paths a leak would show up on. Both already pass
 * against the current code; see the report for why the reviewed finding did not reproduce.
 */
describe('prepareCodexHomeIfNeeded — scratch CODEX_HOME credential cleanup', () => {
  const def = getAgentDef('codex');
  if (!def) throw new Error('codex def missing from registry');

  it('removes the staged directory (and any copied auth.json) when staging fails partway through', async () => {
    const removeDir = vi.fn(async () => {});
    const mcpJsonInjection: McpJsonInjectionOptions = {
      command: '/usr/bin/node',
      args: [],
      daemonUrl: 'http://127.0.0.1:4000',
      mkdtemp: async (prefix) => `/tmp/${prefix}xyz`,
      readFile: async () => {
        throw new Error('ENOENT');
      },
      writeFile: async () => {
        throw new Error('disk full mid-write');
      },
      removeDir,
    };
    const releaseStagedResources = vi.fn(async () => {});
    const failBeforeSpawn = vi.fn(async () => undefined as never);

    const result = await prepareCodexHomeIfNeeded(
      { runId: 'run-leak-1', def, mcpBridge: { kind: 'codex-toml', serverEntry: { command: 'x', args: [], env: { JINI_RUN_ID: 'run-leak-1', JINI_DAEMON_URL: 'http://x' } } } },
      { mcpJsonInjection, hostEnv: {}, releaseStagedResources, failBeforeSpawn },
    );

    expect(result).toBeUndefined();
    expect(removeDir).toHaveBeenCalledTimes(1);
    expect(removeDir).toHaveBeenCalledWith('/tmp/jini-codex-home-run-leak-1-xyz');
  });

  it('removes the staged directory once the caller invokes the returned cleanup()', async () => {
    const removeDir = vi.fn(async () => {});
    const mcpJsonInjection: McpJsonInjectionOptions = {
      command: '/usr/bin/node',
      args: [],
      daemonUrl: 'http://127.0.0.1:4000',
      mkdtemp: async (prefix) => `/tmp/${prefix}abc`,
      readFile: async () => {
        throw new Error('ENOENT');
      },
      writeFile: async () => {},
      removeDir,
    };

    const result = await prepareCodexHomeIfNeeded(
      { runId: 'run-ok-1', def, mcpBridge: { kind: 'codex-toml', serverEntry: { command: 'x', args: [], env: { JINI_RUN_ID: 'run-ok-1', JINI_DAEMON_URL: 'http://x' } } } },
      { mcpJsonInjection, hostEnv: {}, releaseStagedResources: vi.fn(async () => {}), failBeforeSpawn: vi.fn(async () => undefined as never) },
    );

    expect(result).not.toBeNull();
    expect(removeDir).not.toHaveBeenCalled();
    await result?.cleanup();
    expect(removeDir).toHaveBeenCalledTimes(1);
    expect(removeDir).toHaveBeenCalledWith('/tmp/jini-codex-home-run-ok-1-abc');
  });
});
