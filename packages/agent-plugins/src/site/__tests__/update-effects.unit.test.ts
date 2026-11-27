import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createDeferredAgentPluginUpdateEffects, type UpdateMcpDeps } from '../update-effects.js';

test('recovery dependencies are read only when each effect is invoked', async () => {
  let reads = 0; let notified = 0;
  const deps = { workspaceId: 'ws', agentPluginLayout: {}, mcp: { repo: {}, saveServer: async () => {} }, notifyExternalMcpRosterChanged: async () => { notified++; } } as unknown as UpdateMcpDeps;
  const port = createDeferredAgentPluginUpdateEffects({ resolveDeps: () => { reads++; return deps; }, actor: 'system:recovery',
    resolveServers: async () => ({}), provisionServers: async (mcp, input) => {
      assert.equal(mcp, deps.mcp);
      assert.deepEqual(input, { workspaceId: 'ws', pluginId: 'demo', servers: {}, principalId: 'system:recovery' });
      return { provisioned: [], alreadyProvisioned: [], adopted: [], skipped: [], failed: [] };
    },
  });
  assert.equal(reads, 0);
  await port.notifyRosterChanged({ workspaceId: 'ws' });
  assert.equal(reads, 1); assert.equal(notified, 1);
  await assert.rejects(port.setEnabled({ workspaceId: 'ws', pluginId: 'demo', enabled: true }), /shared activation\/removal owner/);
  assert.equal(reads, 2);
  await port.provision({ workspaceId: 'ws', installed: { pluginId: 'demo' } } as Parameters<typeof port.provision>[0]);
  assert.equal(reads, 3);
});

test('deferred recovery refuses removal and fails explicitly when the host omitted roster notification', async () => {
  let reads = 0;
  const deps = { workspaceId: 'tenant-updates', agentPluginLayout: {}, mcp: { repo: {}, saveServer: async () => {} } } as unknown as UpdateMcpDeps;
  const port = createDeferredAgentPluginUpdateEffects({
    resolveDeps: () => { reads++; return deps; },
    actor: 'system:recovery',
    resolveServers: async () => { throw new Error('unexpected declaration read'); },
    provisionServers: async () => { throw new Error('unexpected provisioning'); },
  });
  await assert.rejects(port.notifyRosterChanged({ workspaceId: 'tenant-updates' }),
    { message: 'Agent Plugin update is unavailable: the host did not bind its MCP provisioning.' });
  let notified = false;
  deps.notifyExternalMcpRosterChanged = async () => { notified = true; };
  await assert.rejects(port.remove({ workspaceId: 'tenant-updates', pluginId: 'example' }),
    { message: 'Use the shared activation/removal owner.' });
  assert.equal(reads, 2);
  assert.equal(notified, false);
});
