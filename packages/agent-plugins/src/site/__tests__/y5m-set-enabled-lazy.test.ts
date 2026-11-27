import { expect, it, vi } from 'vitest';
import { createSetAgentPluginEnabled } from '../set-enabled.js';
import { createAgentPluginLayout } from "../../lifecycle/layout.js";

it('bypasses uninitialized provider ports with explicit links and reuses lifecycle by layout', async () => {
  let initialized = false;
  let reads = 0;
  const order: string[] = [];
  const provider = { get links() {
    if (!initialized) throw new Error('initializing');
    reads++; return async () => new Map<string, string>();
  } };
  const setAgentPluginEnabled = vi.fn(async (input: { enabled: boolean }) => { order.push('durable'); return { enabled: input.enabled }; });
  const createLifecycle = vi.fn(() => ({ setAgentPluginEnabled }));
  const bound = createSetAgentPluginEnabled({
    createLifecycle, bindProviderFacePorts: () => ({ links: provider.links }), assertAgentPluginReady: vi.fn(), AgentPluginLinkedError: Error,
  } as unknown as Parameters<typeof createSetAgentPluginEnabled>[0]);
  const layout = { forWorkspace: () => ({ root: '/ws' }) } as unknown as Parameters<typeof bound>[0]['agentPluginLayout'];
  const input = { agentPluginLayout: layout, workspaceId: 'ws', pluginId: 'sample', enabled: true, actor: 'owner' };
  const links = { links: async () => new Map<string, string>() };
  await bound(input, { links });
  expect(reads).toBe(0);
  initialized = true;
  await bound({ ...input, enabled: false }, { notifyRosterChanged: async () => { order.push('lower'); } });
  expect(reads).toBe(1);
  expect(createLifecycle).toHaveBeenCalledTimes(1);
  expect(order).toEqual(['durable', 'durable', 'lower']);
  const supplied = { setAgentPluginEnabled: vi.fn(async () => ({ enabled: true })) } as unknown as NonNullable<NonNullable<Parameters<typeof bound>[1]>['lifecycle']>;
  await bound(input, { lifecycle: supplied });
  expect(supplied.setAgentPluginEnabled).toHaveBeenCalledTimes(1);
  expect(createLifecycle).toHaveBeenCalledTimes(1);
});

it('awaits readiness only for linked enable and refuses before writing', async () => {
  const order: string[] = [];
  const write = vi.fn();
  class LinkedError extends Error {}
  const bound = createSetAgentPluginEnabled({
    createLifecycle: () => ({ setAgentPluginEnabled: write }),
    bindProviderFacePorts: () => ({ links: async () => new Map([['sample', 'provider']]) }),
    assertAgentPluginReady: async () => { order.push('ready'); }, AgentPluginLinkedError: LinkedError,
  } as unknown as Parameters<typeof createSetAgentPluginEnabled>[0]);
  const layout = { forWorkspace: () => ({ root: '/ws' }) } as unknown as Parameters<typeof bound>[0]['agentPluginLayout'];
  const input = { agentPluginLayout: layout, workspaceId: 'ws', pluginId: 'sample', enabled: true, actor: 'owner' };
  await expect(bound(input)).rejects.toBeInstanceOf(LinkedError);
  await expect(bound({ ...input, enabled: false })).rejects.toBeInstanceOf(LinkedError);
  expect(order).toEqual(['ready']);
  expect(write).not.toHaveBeenCalled();
});

it('resolves workspace lazily for the link reader and carries conditional enable to the owner', async () => {
  const layout = createAgentPluginLayout({ root: '/test-plugins' });
  const reads: string[] = [];
  const write = vi.fn(async ({ enabled, pluginId }: { enabled: boolean; pluginId: string }, opts?: { unlessOperatorDisabled?: boolean }) => (
    { pluginId, enabled: enabled && opts?.unlessOperatorDisabled !== true }
  ));
  class LinkedError extends Error {}
  const bound = createSetAgentPluginEnabled({
    createLifecycle: () => ({ setAgentPluginEnabled: write }),
    bindProviderFacePorts: ({ workspaceRoot }) => ({
      links: async () => { reads.push(workspaceRoot()); return new Map<string, string>(); },
    }),
    assertAgentPluginReady: async () => { throw new Error('unlinked plugin'); },
    AgentPluginLinkedError: LinkedError,
  });
  const notifyRosterChanged = vi.fn(async () => {});
  const request = { agentPluginLayout: layout, workspaceId: 'tenant-b', pluginId: 'sample', enabled: true, actor: 'system:connected' };
  await expect(bound(request, { unlessOperatorDisabled: true, notifyRosterChanged })).resolves.toEqual({ pluginId: 'sample', enabled: false });
  expect(reads).toEqual(['/test-plugins/ws/tenant-b']);
  expect(write.mock.calls[0]?.[1]).toEqual({ unlessOperatorDisabled: true });
  expect(notifyRosterChanged.mock.calls).toEqual([[{ lowered: { pluginIds: ['sample'] } }]]);
});
