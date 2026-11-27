import assert from 'node:assert/strict';
import { test } from 'vitest';
import { publishFixture } from "./publish.fixture.js";
import { InMemoryPublishHistoryStore, listPublishDestinations, listStaticPublishDestinations, type PublishHistoryEntry } from '../publish-history.js';

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

const entry: PublishHistoryEntry = { target: 'host', projectName: 'Studio Docs', url: 'https://docs.example.test', reachable: true,
  status: 'ready', publishedAt: '2026-11-25T00:00:01Z', triggeredBy: 'admin_ui', configFields: { bucket: 'public-docs' } };
const newHistory = () => new InMemoryPublishHistoryStore({ peerKind: 'peer', resolvePublishHistoryListLimit: ({ requested }) => requested ?? 2 });

test('the workspace ledger preserves older rows, filters by target, and ignores peers in last-static lookup', async () => {
  const store = newHistory();
  const renewed = { ...entry, url: 'https://new.docs.example.test' };
  const peer = { ...entry, kind: 'peer', url: 'https://peer.example.test' };
  await store.recordSuccess({ workspaceId: 'ws', entry });
  await store.recordSuccess({ workspaceId: 'ws', entry: { ...entry, target: 'different-host' } });
  await store.recordSuccess({ workspaceId: 'ws', entry: renewed });
  await store.recordSuccess({ workspaceId: 'ws', entry: peer });
  await store.recordSuccess({ workspaceId: 'other', entry: { ...entry, url: 'https://private.example.test' } });
  assert.deepEqual(await store.getLast({ workspaceId: 'ws', target: 'host' }), renewed);
  assert.equal(await store.getLast({ workspaceId: 'missing', target: 'host' }), null);
  assert.deepEqual(await store.list({ workspaceId: 'ws' }), [peer, renewed]);
  assert.deepEqual(await store.list({ workspaceId: 'ws', target: 'host', limit: 8 }), [peer, renewed, entry]);
  assert.deepEqual(await store.listLiveUrls({ workspaceId: 'ws' }), ['https://docs.example.test', 'https://new.docs.example.test', 'https://peer.example.test']);
});

test('projects the latest usable destinations with public config and only authorized peers', async () => {
  const store = newHistory();
  const f = publishFixture();
  const field = (name: string) => ({ name, label: name, required: false });
  const target = { ...f.target, descriptor: { ...f.target.descriptor,
    configFields: [...f.target.descriptor.configFields, ...['apiKey', 'account', 'credentialId', 'target', 'projectName'].map(field), { ...field('secretNote'), secret: true as const }],
    credential: { vendorId: 'vendor', tokenField: 'apiKey', fields: [{ ...field('apiKey'), required: true }, field('account')] },
  } };
  const registry = { ...f.registry, get: (id: string) => id === 'host' ? target : undefined };
  const latest = { ...entry, credentialId: 'saved-row', configFields: { bucket: 'public-docs', apiKey: 'private', account: 'internal',
    target: 'mismatch', credentialId: 'spoof', projectName: 'spoof', secretNote: 'note', undeclared: 'discard' } };
  for (const row of [entry, latest, { ...entry, target: 'uninstalled' }, { ...entry, kind: 'peer', target: 'deleted' },
    { ...entry, kind: 'peer', target: 'connected', publishedAt: '2026-11-25T00:00:03Z' },
    { ...entry, kind: 'deploy', target: 'cloud', projectName: 'Main', status: 'started', reachable: false, url: 'https://peer.example.test/blog/', publishedAt: '2026-11-25T00:00:02Z' },
    { ...entry, kind: 'deploy', target: 'cloud', projectName: 'Other', url: 'https://peer.example.test/other', publishedAt: '2026-11-25T00:00:00Z' },
    { ...entry, kind: 'deploy', target: 'cloud', projectName: 'Draft', url: '' }]) {
    await store.recordSuccess({ workspaceId: 'ws', entry: row });
  }
  const input = { historyStore: store, registry, workspaceId: 'ws' };
  const visible = { id: 'static:host:Studio%20Docs', kind: 'static', label: 'Studio host: Studio Docs', url: 'https://docs.example.test',
    lastPublishedAt: '2026-11-25T00:00:01Z', target: 'host', projectName: 'Studio Docs', credentialId: 'saved-row', configFields: { bucket: 'public-docs' } };
  assert.deepEqual(await listStaticPublishDestinations(input), [visible]);
  assert.deepEqual(await listPublishDestinations({ ...input, peerKind: 'peer', peers: [{ id: 'connected', label: 'Blog', baseUrl: 'https://peer.example.test/blog' }] }), [
    { id: 'peer:connected', kind: 'peer', label: 'Blog', url: 'https://peer.example.test/blog', peerId: 'connected', lastPublishedAt: '2026-11-25T00:00:03Z' },
    { id: 'deploy:cloud:Main', kind: 'deploy', target: 'cloud', label: 'Main', status: 'started', statusMessage: 'Deploy started, not confirmed',
      linkedPeerId: 'connected', url: 'https://peer.example.test/blog/', lastPublishedAt: '2026-11-25T00:00:02Z' },
    visible,
    { id: 'deploy:cloud:Other', kind: 'deploy', target: 'cloud', label: 'Other', status: 'confirmed',
      url: 'https://peer.example.test/other', lastPublishedAt: '2026-11-25T00:00:00Z' },
  ]);
});

test('refuses the 201st destination instead of truncating the published destination list', async () => {
  const store = newHistory();
  const registry = publishFixture().registry;
  const input = { workspaceId: 'ws', historyStore: store, registry };
  for (let i = 0; i < 200; i++) {
    await store.recordSuccess({ workspaceId: 'ws', entry: { ...entry, projectName: `Studio ${i}`, url: `https://site-${i}.example.test` } });
  }
  assert.equal((await listStaticPublishDestinations(input)).length, 200);
  for (let i = 200; i < 202; i++) {
    await store.recordSuccess({ workspaceId: 'ws', entry: { ...entry, projectName: `Studio ${i}`, url: `https://site-${i}.example.test` } });
  }
  await assert.rejects(listStaticPublishDestinations(input), { message: 'publish destination limit exceeded (200)' });
  await assert.rejects(listPublishDestinations({ ...input, peers: [], peerKind: 'peer' }), { message: 'publish destination limit exceeded (200)' });
  const urls = await store.listLiveUrls({ workspaceId: 'ws' });
  assert.equal(urls.length, 201);
  assert.equal(urls.includes('https://site-200.example.test'), true);
  assert.equal(urls.includes('https://site-201.example.test'), false);
});
