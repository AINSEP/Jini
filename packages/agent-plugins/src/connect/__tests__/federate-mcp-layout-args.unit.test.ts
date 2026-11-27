import { expect, test, vi } from 'vitest';
import { listInstalledAgentPluginServers } from '../import-access-token.js';
import { resolveAgentPluginMcpServers, resolveAgentPluginReadOnlyRemoteNames, type AgentPluginInstalledMcpReads, type AgentPluginLayout } from '../federate-mcp.js';

/** Mirrors the real layout, which destructures `{ workspaceId }` and throws on a bare string. */
const strictLayout: AgentPluginLayout = {
  forWorkspace: (required: { workspaceId: string }) => {
    const { workspaceId } = required;
    if (typeof workspaceId.toLowerCase !== 'function') throw new TypeError('workspaceId must be a string');
    return { root: `/ws/${workspaceId}` };
  },
} as AgentPluginLayout;

test('resolveAgentPluginMcpServers asks the layout for a workspace with an object, not a bare id', async () => {
  const roots: string[] = [];
  const servers = await resolveAgentPluginMcpServers({
    agentPluginLayout: strictLayout,
    workspaceId: 'ws-1',
    pluginId: 'p1',
    lifecycle: {
      readBundledAgentPluginDigests: async ({ workspaceRoot }: { workspaceRoot: string }) => { roots.push(workspaceRoot); return new Map(); },
      preferBundledAgentPluginDigests: ({ installed }: { installed: readonly unknown[] }) => installed,
      listInstalledPlugins: async () => [{ pluginId: 'p1', packageRoot: '/pkg' }],
      readInstalledMcpServers: async () => ({ s: { command: 'x' } }),
    } as never,
  });
  expect(roots).toEqual(['/ws/ws-1']);
  expect(servers).toEqual({ s: { command: 'x' } });
});

const config = { type: 'streamable-http', url: 'https://sync.example.test/mcp', defaultTools: { allow: ['list', 'modify'], write: ['modify'], read: ['list'] } } as const;
const pinned = { pluginId: 'p1', archiveDigest: 'bundled-123', packageRoot: '/pkg/bundled', files: [], skills: [] };
const stale = { ...pinned, archiveDigest: 'operator-456', packageRoot: '/pkg/operator' };
const separate = { ...stale, pluginId: 'p2', packageRoot: '/pkg/other' };
const duplicate = { ...separate, archiveDigest: 'operator-789', packageRoot: '/pkg/duplicate' };
function registry() {
  const listInstalledPlugins = vi.fn<AgentPluginInstalledMcpReads['listInstalledPlugins']>(async () => [pinned, separate, duplicate]);
  const readBundledAgentPluginDigests = vi.fn<AgentPluginInstalledMcpReads['readBundledAgentPluginDigests']>(async () => new Map([['p1', pinned.archiveDigest]]));
  const readInstalledMcpServers = vi.fn<AgentPluginInstalledMcpReads['readInstalledMcpServers']>(async ({ packageRoot }) => {
    if (packageRoot === '/pkg/bundled') return { main: config };
    if (packageRoot === '/pkg/other') return {};
    throw new Error('unexpected package root');
  });
  return {
    listInstalledPlugins, readBundledAgentPluginDigests, readInstalledMcpServers,
    preferBundledAgentPluginDigests: <T extends { readonly pluginId: string; readonly archiveDigest: string }>({ installed }: { readonly installed: readonly T[] }) => [...installed],
  } satisfies AgentPluginInstalledMcpReads;
}

test('reviewed names require the active bundled digest and an exact endpoint match', async () => {
  const lifecycle = registry();
  const input = { agentPluginLayout: strictLayout, lifecycle, workspaceId: 'ws-1', pluginId: 'p1', serverId: 'main', url: config.url };
  expect(await resolveAgentPluginReadOnlyRemoteNames(input)).toEqual(new Set(['list']));
  expect(await resolveAgentPluginReadOnlyRemoteNames({ ...input, url: 'https://sync.example.test/repointed' })).toEqual(new Set());
  lifecycle.listInstalledPlugins.mockResolvedValueOnce([stale]);
  expect(await resolveAgentPluginReadOnlyRemoteNames(input)).toEqual(new Set());
  expect(await resolveAgentPluginReadOnlyRemoteNames({ ...input, pluginId: 'p2' })).toEqual(new Set());
  expect(lifecycle.listInstalledPlugins.mock.calls).toEqual(Array(3).fill([{ workspaceRoot: '/ws/ws-1' }]));
  expect(lifecycle.readInstalledMcpServers.mock.calls).toEqual(Array(2).fill([{ packageRoot: '/pkg/bundled' }]));
});

test('boot declaration listing reads the first selected copy once per id and marks only bundled digests', async () => {
  const lifecycle = registry();
  expect(await listInstalledAgentPluginServers({ workspaceRoot: '/studio', lifecycle })).toEqual([
    { pluginId: 'p1', bundled: true, servers: { main: config } },
    { pluginId: 'p2', bundled: false, servers: {} },
  ]);
  expect(lifecycle.readInstalledMcpServers.mock.calls).toEqual([[{ packageRoot: '/pkg/bundled' }], [{ packageRoot: '/pkg/other' }]]);
});
