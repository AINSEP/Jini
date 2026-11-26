import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createDeferredAgentPluginUpdateEffects, type UpdateMcpDeps } from '../update-effects.js';

test('recovery dependencies are read only when each effect is invoked', async () => {
  let reads = 0; let notified = 0;
  const deps = { workspaceId: 'ws', agentPluginLayout: {}, mcp: { repo: {}, saveServer: async () => {} }, notifyExternalMcpRosterChanged: async () => { notified++; } } as unknown as UpdateMcpDeps;
  const port = createDeferredAgentPluginUpdateEffects({ resolveDeps: () => { reads++; return deps; }, actor: 'system:recovery',
    resolveServers: async () => ({}), provisionServers: async () => ({ provisioned: [], alreadyProvisioned: [], adopted: [], skipped: [], failed: [] }),
  });
  assert.equal(reads, 0);
  await port.notifyRosterChanged({ workspaceId: 'ws' });
  assert.equal(reads, 1); assert.equal(notified, 1);
  await assert.rejects(port.setEnabled({ workspaceId: 'ws', pluginId: 'demo', enabled: true }), /shared activation\/removal owner/);
  assert.equal(reads, 2);
});
