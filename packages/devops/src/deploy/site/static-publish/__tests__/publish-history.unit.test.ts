import assert from 'node:assert/strict';
import { test } from 'vitest';
import { InMemoryPublishHistoryStore, type PublishHistoryEntry } from '../publish-history.js';

test('only confirmed or pending deploy runs enter replay selection', async () => {
  const store = new InMemoryPublishHistoryStore({ peerKind: "peer", resolvePublishHistoryListLimit: () => 100 });
  const row: PublishHistoryEntry = { target: 'host', projectName: 'Site', url: 'https://example.com', reachable: false,
    status: 'uploaded', publishedAt: '2026-11-25T00:00:00Z', triggeredBy: 'agent_tool', configFields: {} };
  await store.recordSuccess({ workspaceId: 'ws', entry: row });
  assert.deepEqual(await store.listDestinationHistory({ workspaceId: 'ws' }), []);
  const pending = { ...row, kind: 'deploy' as const, status: 'started' };
  await store.recordSuccess({ workspaceId: 'ws', entry: pending });
  assert.deepEqual(await store.listDestinationHistory({ workspaceId: 'ws' }), [pending]);
  const peer: PublishHistoryEntry = { kind: 'peer', target: 'host', projectName: 'Peer', url: 'https://peer.example', reachable: true,
    status: 'ready', publishedAt: '2026-11-25T00:00:01Z', triggeredBy: 'agent_tool' };
  await store.recordSuccess({ workspaceId: 'ws', entry: peer });
  assert.deepEqual(await store.listDestinationHistory({ workspaceId: 'ws' }), [peer, pending]);
});
