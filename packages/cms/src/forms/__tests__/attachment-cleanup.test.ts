import assert from 'node:assert/strict';
import { test } from 'vitest';
import { registerFormAttachmentCleanup, scheduleFormAttachmentCleanup } from '../attachment-cleanup.js';
import { InMemoryEventBus } from './eventing.fixture.js';
import { DEFAULT_GC_GRACE_MS } from '../../media/blob-gc.js';

test('file cleanup is durable, delayed by the existing GC grace, and keeps shared bytes', async () => {
  const events: any[] = [], removed: string[] = []; let shared = true;
  const now = Date.parse('2026-11-04T00:00:00Z');
  await scheduleFormAttachmentCleanup({ outbox: { enqueue: async e => { events.push(e); } }, workspaceId: 'w', mediaId: 'm', sha256: 'sha', now });
  assert.equal(Date.parse(events[0].occurredAt), now + DEFAULT_GC_GRACE_MS);
  const bus = new InMemoryEventBus();
  await registerFormAttachmentCleanup({ bus, findBlob: async () => ({ storageKey: 'blob', status: 'tombstoned' }), hasOwners: async () => shared,
    deleteBytes: async ({ storageKey }) => { removed.push(storageKey); }, removeBlob: async () => { removed.push('row'); } });
  await bus.publish(events[0]); assert.deepEqual(removed, []);
  shared = false; await bus.publish(events[0]); assert.deepEqual(removed, ['blob', 'row']);
});
test('blob deletion failure reaches the outbox for retry; missing and active blobs are preserved', async () => {
  const bus = new InMemoryEventBus(); let status = 'tombstoned';
  await registerFormAttachmentCleanup({ bus, findBlob: async () => status === 'missing' ? null : { storageKey: 'blob', status }, hasOwners: async () => false,
    deleteBytes: async () => { throw new Error('provider token=secret'); }, removeBlob: async () => assert.fail('bytes must delete first') });
  const events: any[] = [];
  await scheduleFormAttachmentCleanup({ outbox: { enqueue: async e => { events.push(e); } }, workspaceId: 'w', mediaId: 'm', sha256: 'sha', now: 0 });
  await assert.rejects(bus.publish(events[0]), error => { assert.equal((error as Error).message.includes('secret'), false); return true; });
  status = 'active'; await bus.publish(events[0]); status = 'missing'; await bus.publish(events[0]);
});
