import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { ToolInputError, type ToolExecutionContext } from '@jini-ai/core';
import { createAgentPluginLayout } from '../../lifecycle/layout.js';
import { prepareCustomizedAgentPluginArchive } from '../customize-tool.js';

const workspaceId = 'tenant-c';
const baseInput = { pluginId: 'stock', newId: 'my-stock', path: 'skills/main/SKILL.md', oldString: 'old ', newString: '' };
const context = (input: unknown): ToolExecutionContext => ({
  executionId: 'customize-1', run: { id: 'run-1' }, principal: { id: 'owner' }, signal: new AbortController().signal, input,
});

test('forks the lifecycle-selected revision, allows literal removal and leaves the source unchanged', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jini-fork-tool-'));
  try {
    const agentPluginLayout = createAgentPluginLayout({ root });
    const workspaceRoot = path.join(root, 'ws', workspaceId);
    const stock = { pluginId: 'stock', packageRoot: path.join(root, 'owned') };
    const obsolete = { ...stock, packageRoot: path.join(root, 'not-chosen') };
    await mkdir(path.join(stock.packageRoot, 'skills', 'main'), { recursive: true });
    await writeFile(path.join(stock.packageRoot, 'plugin.json'), JSON.stringify({
      name: 'stock', version: '1.0.0', extensions: { jini: { id: 'publisher/stock' } },
    }));
    const skill = path.join(stock.packageRoot, baseInput.path);
    await writeFile(skill, 'Use old instructions.');
    const bundled = new Map([['stock', 'preferred-build']]);
    const lifecycle = {
      listInstalledPlugins: vi.fn(async (_scope: { workspaceRoot: string }) => [obsolete, stock]),
      readBundledAgentPluginDigests: vi.fn(async (_scope: { workspaceRoot: string }) => bundled),
      preferBundledAgentPluginDigests: vi.fn((installed: readonly typeof stock[], digests: typeof bundled) =>
        digests.get('stock') === 'preferred-build' ? installed.filter(item => item === stock) : installed),
      maxAgentPluginInstallArchiveBytes: () => 32 * 1024,
    };
    const deps = { workspaceId, agentPluginLayout };
    const archive = await prepareCustomizedAgentPluginArchive({ deps, lifecycle, ctx: context(baseInput) });
    const storedText = Buffer.from(archive).toString('utf8');
    expect(storedText).toContain('Use instructions.');
    expect(storedText).toContain('local/my-stock');
    expect(storedText).not.toContain('publisher/stock');
    expect(await readFile(skill, 'utf8')).toBe('Use old instructions.');
    expect(lifecycle.listInstalledPlugins.mock.calls).toEqual([[{ workspaceRoot }]]);
    expect(lifecycle.readBundledAgentPluginDigests.mock.calls).toEqual([[{ workspaceRoot }]]);
    expect(lifecycle.preferBundledAgentPluginDigests.mock.calls).toEqual([[[obsolete, stock], bundled]]);

    const error = await prepareCustomizedAgentPluginArchive({ deps, lifecycle, ctx: context({ ...baseInput, oldString: 'not in the skill' }) })
      .then(() => undefined, (error: unknown) => error);
    expect(error).toBeInstanceOf(ToolInputError);
    expect(error).toHaveProperty('message', 'oldString must match exactly once. Read the file and send more context.');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each([0, 2])('refuses a source with %d selected revisions without starting a fork', async count => {
  const agentPluginLayout = createAgentPluginLayout({ root: '/archive-fixture' });
  const maxAgentPluginInstallArchiveBytes = vi.fn(() => 4096);
  const lifecycle = {
    listInstalledPlugins: async () => Array.from({ length: count }, (_, i) => ({ pluginId: 'stock', packageRoot: '/fixtures/revision-' + i })),
    readBundledAgentPluginDigests: async () => new Map<string, string>(),
    preferBundledAgentPluginDigests: (installed: readonly { pluginId: string; packageRoot: string }[]) => installed,
    maxAgentPluginInstallArchiveBytes,
  };
  await expect(prepareCustomizedAgentPluginArchive({ deps: { workspaceId, agentPluginLayout }, ctx: context(baseInput), lifecycle }))
    .rejects.toThrow(new ToolInputError({ message: "Source 'stock' must identify exactly one installed Agent Plugin." }));
  expect(maxAgentPluginInstallArchiveBytes.mock.calls).toEqual([]);
});
