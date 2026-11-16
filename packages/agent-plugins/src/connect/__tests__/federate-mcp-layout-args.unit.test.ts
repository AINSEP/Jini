import { expect, test } from 'vitest';
import { resolveAgentPluginMcpServers, type AgentPluginLayout } from '../federate-mcp.js';

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
