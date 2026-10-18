import { constants, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { resolveMcpBridgeForRun } from '../mcp-bridge.js';

const home = vi.hoisted(() => ({ path: '' }));
vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(), homedir: () => home.path,
}));

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => fs.rm(path, { recursive: true, force: true }))); });
async function fixture(raw?: string) {
  const root = await fs.mkdtemp(join(tmpdir(), 'agy-permissions-'));
  roots.push(root);
  home.path = root;
  const settingsPath = join(root, '.gemini', 'antigravity-cli', 'settings.json');
  await fs.mkdir(join(root, '.gemini', 'antigravity-cli'), { recursive: true });
  if (raw !== undefined) await fs.writeFile(settingsPath, raw);
  return settingsPath;
}

/** Exercise the existing launch seam so the old resolver reaches the regression assertions. */
function prepare() {
  return resolveMcpBridgeForRun({
    input: { runId: 'run', cwd: '/isolated', def: { id: 'antigravity', externalMcpInjection: 'env-passthrough' } as RuntimeAgentDef },
    deps: {
      mcpJsonInjection: { command: 'jini-mcp', daemonUrl: 'http://localhost:4317' },
      cleanupStagedFiles: async () => {},
      failBeforeSpawn: async ({ message }) => { throw new Error(message); },
    },
  });
}

it('adds only Jini permission, preserves every other setting and keeps a one-time original backup', async () => {
  const before = { theme: 'dark', permissions: { allow: ['command(git)', 'read_url(example.com)'], ask: ['mcp(other/*)'], deny: ['command(rm)'] }, model: 'existing' };
  const raw = JSON.stringify(before);
  const settingsPath = await fixture(raw);
  await prepare();
  const once = await fs.readFile(settingsPath, 'utf8');
  expect(JSON.parse(once)).toEqual({ ...before, permissions: { ...before.permissions, allow: [...before.permissions.allow, 'mcp(jini/*)'] } });
  expect(await fs.readFile(`${settingsPath}.jini-backup`, 'utf8')).toBe(raw);
  expect(JSON.parse(once).permissions.allow).not.toContain('mcp(*)');
  expect(JSON.parse(once).permissions.allow).not.toContain('mcp(other/*)');
  await prepare();
  expect(await fs.readFile(settingsPath, 'utf8')).toBe(once);
  // Later edits still cannot replace the first backup.
  await fs.writeFile(settingsPath, JSON.stringify({ ...before, theme: 'light' }));
  await prepare();
  expect(await fs.readFile(`${settingsPath}.jini-backup`, 'utf8')).toBe(raw);
});

it('keeps exactly one Jini grant without removing or reordering any other rules', async () => {
  const settingsPath = await fixture(JSON.stringify({ permissions: { allow: ['command(git)', 'mcp(jini/*)', 'read_file(src/)', 'mcp(jini/*)', 'command(git)'] } }));
  await prepare();
  expect(JSON.parse(await fs.readFile(settingsPath, 'utf8')).permissions.allow).toEqual(['command(git)', 'mcp(jini/*)', 'read_file(src/)', 'command(git)']);
});

it('serializes concurrent setup and creates a missing settings file with only the Jini rule', async () => {
  const settingsPath = await fixture();
  await Promise.all(Array.from({ length: 3 }, () => prepare()));
  expect(JSON.parse(await fs.readFile(settingsPath, 'utf8'))).toEqual({ permissions: { allow: ['mcp(jini/*)'] } });
  await expect(fs.access(`${settingsPath}.jini-backup`, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['{broken', '[]', '{"permissions":[]}', '{"permissions":null}', '{"permissions":{"allow":"mcp(*)"}}'])('refuses malformed settings without replacing them: %s', async raw => {
  const settingsPath = await fixture(raw);
  await expect(prepare()).rejects.toThrow();
  expect(await fs.readFile(settingsPath, 'utf8')).toBe(raw);
});

it('launch preparation authorizes the Jini bridge before returning delivery, and fails closed on setup errors', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const authorize = vi.fn(async () => { await gate; });
  const cleanupStagedFiles = vi.fn(async () => {});
  const failBeforeSpawn = vi.fn(async (input: { message: string }): Promise<never> => { throw new Error(input.message); });
  const input = { runId: 'run', cwd: '/isolated', def: { id: 'antigravity', externalMcpInjection: 'env-passthrough' } as RuntimeAgentDef };
  const deps = { mcpJsonInjection: { command: 'jini-mcp', daemonUrl: 'http://localhost:4317' }, cleanupStagedFiles, failBeforeSpawn, ensureAntigravityMcpPermission: authorize };
  let ready = false;
  const pending = resolveMcpBridgeForRun({ input, deps }).then(value => { ready = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'jini', settingsPath: expect.stringMatching(/\.gemini[\\/]antigravity-cli[\\/]settings\.json$/) }));
  expect(ready).toBe(false);
  release();
  expect(await pending).toMatchObject({ kind: 'env-passthrough' });
  authorize.mockRejectedValueOnce(new Error('settings not writable'));
  await expect(resolveMcpBridgeForRun({ input, deps })).rejects.toThrow('settings not writable');
  expect(cleanupStagedFiles).toHaveBeenCalledOnce();
  expect(failBeforeSpawn).toHaveBeenCalledOnce();
  authorize.mockClear();
  await resolveMcpBridgeForRun({ input, deps: { ...deps, mcpJsonInjection: undefined } });
  await resolveMcpBridgeForRun({ input: { ...input, def: { ...input.def, id: 'another-agent' } }, deps });
  expect(authorize).not.toHaveBeenCalled();
});
