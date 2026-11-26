import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createAgentPluginSiteLayout } from '../../lifecycle/layout.js';

const diagnostics = {
  workspaceId: ({ workspaceId }: { workspaceId: string }) => new Error(`forWorkspace: '${workspaceId}' is not a valid workspace id`),
  pluginId: ({ pluginId }: { pluginId: string }) => new Error(`'${pluginId}' is not a valid Agent Plugin id`),
  pluginDataId: ({ pluginId }: { pluginId: string }) => new Error(`pluginDataDir: '${pluginId}' is not a valid Agent Plugin id`),
  memoryKind: () => new Error('Invalid plugin memory kind'),
};

test('workspace trees remain isolated and invalid IDs retain the exact diagnostics', () => {
  const layout = createAgentPluginSiteLayout({ root: '/plugins', diagnostics });
  const a = layout.forWorkspace({ workspaceId: 'A' }); const b = layout.forWorkspace({ workspaceId: 'b' });
  assert.equal(layout.workspacesDir, '/plugins/ws');
  assert.equal(a.pluginDataDir({ pluginId: 'demo' }), '/plugins/ws/a/demo/data');
  assert.equal(b.pluginDataDir({ pluginId: 'demo' }), '/plugins/ws/b/demo/data');
  assert.throws(() => layout.forWorkspace({ workspaceId: 'Bad/ID' }), { message: "forWorkspace: 'Bad/ID' is not a valid workspace id" });
  assert.throws(() => a.pluginRootDir({ pluginId: '../bad' }), { message: "'../bad' is not a valid Agent Plugin id" });
  assert.throws(() => a.pluginDataDir({ pluginId: 'BAD' }), { message: "pluginDataDir: 'BAD' is not a valid Agent Plugin id" });
});
