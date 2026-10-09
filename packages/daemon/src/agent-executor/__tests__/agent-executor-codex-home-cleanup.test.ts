import { describe, expect, it, vi } from 'vitest';
import { getAgentDef } from '@jini-ai/agent-runtime';
import { prepareCodexHomeIfNeeded, type McpJsonInjectionOptions } from '../index.js';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Verifies the copied Codex `auth.json` credential does not survive a run whose staging fails
 * partway through, and that the staged scratch directory is released once the run consumes and
 * calls back the returned `cleanup()` — the two paths a leak would show up on. Both already pass
 * against the current code; see the report for why the reviewed finding did not reproduce.
 */
describe('prepareCodexHomeIfNeeded — scratch CODEX_HOME credential cleanup', () => {
  const def = getAgentDef({ id: 'codex' });
  if (!def) throw new Error('codex def missing from registry');

  it('removes the staged directory (and any copied auth.json) when staging fails partway through', async () => {
    const removeDir = vi.fn(async () => {});
    const mcpJsonInjection: McpJsonInjectionOptions = {
      command: '/usr/bin/node',
      args: [],
      daemonUrl: 'http://127.0.0.1:4000',
      linkSessionStore: async () => {},
      mkdtemp: async ({ prefix }: { readonly prefix: string }) => `/tmp/${prefix}xyz`,
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

    const result = await prepareCodexHomeIfNeeded({ input: { runId: 'run-leak-1', def, mcpBridge: { kind: 'codex-toml', serverEntry: { command: 'x', args: [], env: { JINI_RUN_ID: 'run-leak-1', JINI_DAEMON_URL: 'http://x' } } } }, deps: { mcpJsonInjection, hostEnv: {}, releaseStagedResources, failBeforeSpawn } }
    );

    expect(result).toBeUndefined();
    expect(removeDir).toHaveBeenCalledTimes(1);
    expect(removeDir).toHaveBeenCalledWith({ path: '/tmp/jini-codex-home-run-leak-1-xyz' });
  });

  it('removes the staged directory once the caller invokes the returned cleanup()', async () => {
    const removeDir = vi.fn(async () => {});
    const mcpJsonInjection: McpJsonInjectionOptions = {
      command: '/usr/bin/node',
      args: [],
      daemonUrl: 'http://127.0.0.1:4000',
      linkSessionStore: async () => {},
      mkdtemp: async ({ prefix }: { readonly prefix: string }) => `/tmp/${prefix}abc`,
      readFile: async () => {
        throw new Error('ENOENT');
      },
      writeFile: async () => {},
      removeDir,
    };

    const result = await prepareCodexHomeIfNeeded({ input: { runId: 'run-ok-1', def, mcpBridge: { kind: 'codex-toml', serverEntry: { command: 'x', args: [], env: { JINI_RUN_ID: 'run-ok-1', JINI_DAEMON_URL: 'http://x' } } } }, deps: { mcpJsonInjection, hostEnv: {}, releaseStagedResources: vi.fn(async () => {}), failBeforeSpawn: vi.fn(async () => undefined as never) } }
    );

    expect(result).not.toBeNull();
    expect(removeDir).not.toHaveBeenCalled();
    await result?.cleanup();
    expect(removeDir).toHaveBeenCalledTimes(1);
    expect(removeDir).toHaveBeenCalledWith({ path: '/tmp/jini-codex-home-run-ok-1-abc' });
  });

  it('keeps a rollout readable in the next isolated home while deleting scratch config and auth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mri-codex-'));
    const sourceHome = join(root, 'operator');
    const entry = { command: 'x', args: [], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://x' } };
    try {
      await mkdir(sourceHome);
      await writeFile(join(sourceHome, 'config.toml'), 'model = "test-model"\n');
      await writeFile(join(sourceHome, 'auth.json'), '{"fixture":"not-a-credential"}');
      const stage = (runId: string) => prepareCodexHomeIfNeeded({ input: { runId, def, mcpBridge: { kind: 'codex-toml', serverEntry: entry } }, deps: {
        mcpJsonInjection: { command: 'x', daemonUrl: 'http://x', mkdtemp: ({ prefix }) => mkdtemp(join(root, prefix)) },
        hostEnv: { CODEX_HOME: sourceHome }, releaseStagedResources: async () => {}, failBeforeSpawn: async () => { throw new Error('staging failed'); },
      } });
      const first = (await stage('first'))!;
      const rollout = 'rollout-thread-1.jsonl';
      await writeFile(join(first.path, 'sessions', rollout), '{"thread_id":"thread-1"}\n');
      await first.cleanup();
      await expect(stat(first.path)).rejects.toMatchObject({ code: 'ENOENT' });
      const second = (await stage('resend'))!;
      expect(await readFile(join(second.path, 'sessions', rollout), 'utf8')).toBe('{"thread_id":"thread-1"}\n');
      expect(await readFile(join(second.path, 'config.toml'), 'utf8')).toContain('model = "test-model"');
      await second.cleanup();
      expect(await readFile(join(sourceHome, 'config.toml'), 'utf8')).toBe('model = "test-model"\n');
      expect(await readFile(join(sourceHome, 'auth.json'), 'utf8')).toBe('{"fixture":"not-a-credential"}');
      expect(await readFile(join(sourceHome, 'sessions', rollout), 'utf8')).toBe('{"thread_id":"thread-1"}\n');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('cleans up the credential copy when linking the persistent session store fails', async () => {
    const removed: string[] = [];
    const error = new Error('session store unavailable');
    const failed: string[] = [];
    const result = await prepareCodexHomeIfNeeded({ input: { runId: 'link-failure', def, mcpBridge: { kind: 'codex-toml', serverEntry: { command: 'x', args: [], env: { JINI_RUN_ID: 'r', JINI_DAEMON_URL: 'http://x' } } } }, deps: {
      mcpJsonInjection: { command: 'x', daemonUrl: 'http://x', mkdtemp: async () => '/fake/staged', readFile: async () => '', writeFile: async () => {},
        linkSessionStore: async () => { throw error; }, removeDir: async ({ path }) => { removed.push(path); } },
      hostEnv: {}, releaseStagedResources: async () => {}, failBeforeSpawn: async ({ message }) => { failed.push(message); return undefined as never; },
    } });
    expect(result).toBeUndefined();
    expect(removed).toEqual(['/fake/staged']);
    expect(failed).toEqual(['AgentExecutor: could not stage a CODEX_HOME for agent "codex": session store unavailable']);
  });
});
