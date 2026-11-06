import assert from 'node:assert/strict';
import { test } from 'vitest';
import { registerFormAttachmentCleanup, scheduleFormAttachmentCleanup } from '../attachment-cleanup.js';
import { InMemoryEventBus } from './eventing.fixture.js';
import { DEFAULT_GC_GRACE_MS } from '../../media/blob-gc.js';
import { withSha256Lock } from '../../media/blob-gc-lock.js';

test('file cleanup is durable, delayed by the existing GC grace, and keeps shared bytes', async () => {
  const events: any[] = [], removed: string[] = []; let shared = true;
  const now = Date.parse('2026-11-04T00:00:00Z');
  await scheduleFormAttachmentCleanup({ outbox: { enqueue: async e => { events.push(e); } }, workspaceId: 'w', mediaId: 'm', sha256: 'sha', graceMs: DEFAULT_GC_GRACE_MS, now });
  assert.equal(Date.parse(events[0].occurredAt), now + DEFAULT_GC_GRACE_MS);
  const bus = new InMemoryEventBus();
  await registerFormAttachmentCleanup({ bus, withHashLock: withSha256Lock, findBlob: async () => ({ storageKey: 'blob', status: 'tombstoned' }), hasOwners: async () => shared,
    deleteBytes: async ({ storageKey }) => { removed.push(storageKey); }, removeBlob: async () => { removed.push('row'); } });
  await bus.publish(events[0]); assert.deepEqual(removed, []);
  shared = false; await bus.publish(events[0]); assert.deepEqual(removed, ['blob', 'row']);
});
test('blob deletion failure reaches the outbox for retry; missing and active blobs are preserved', async () => {
  const bus = new InMemoryEventBus(); let status = 'tombstoned';
  await registerFormAttachmentCleanup({ bus, withHashLock: withSha256Lock, findBlob: async () => status === 'missing' ? null : { storageKey: 'blob', status }, hasOwners: async () => false,
    deleteBytes: async () => { throw new Error('provider token=secret'); }, removeBlob: async () => assert.fail('bytes must delete first') });
  const events: any[] = [];
  await scheduleFormAttachmentCleanup({ outbox: { enqueue: async e => { events.push(e); } }, workspaceId: 'w', mediaId: 'm', sha256: 'sha', graceMs: DEFAULT_GC_GRACE_MS, now: 0 });
  await assert.rejects(bus.publish(events[0]), error => { assert.equal((error as Error).message.includes('secret'), false); return true; });
  status = 'active'; await bus.publish(events[0]); status = 'missing'; await bus.publish(events[0]);
});


test('the host controls the cleanup grace and locks ownership checks with deletion', async () => {
  const events: any[] = [], removed: string[] = [];
  await scheduleFormAttachmentCleanup({ outbox: { enqueue: async e => { events.push(e); } }, workspaceId: 'w', mediaId: 'm', sha256: 'sha', now: 1000, graceMs: 321 });
  assert.equal(Date.parse(events[0].occurredAt), 1321);
  const bus = new InMemoryEventBus();
  let insideLock = false;
  const lockKeys: string[] = [];
  await registerFormAttachmentCleanup({ bus,
    withHashLock: async ({ key, criticalSection }) => {
      lockKeys.push(key);
      insideLock = true;
      try { await criticalSection(); } finally { insideLock = false; }
    },
    findBlob: async () => { assert.equal(insideLock, true); return { storageKey: 'blob', status: 'tombstoned' }; },
    hasOwners: async () => { assert.equal(insideLock, true); return false; },
    deleteBytes: async ({ storageKey }) => { assert.equal(insideLock, true); removed.push(storageKey); },
    removeBlob: async () => { assert.equal(insideLock, true); removed.push('row'); },
  });
  await bus.publish(events[0]);
  assert.deepEqual(lockKeys, ['sha']);
  assert.deepEqual(removed, ['blob', 'row']);
});

test('cleanup shares the host lock with an upload that restores blob ownership', async () => {
  const bus = new InMemoryEventBus();
  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
  let shared = false, lookedUp = false;
  const upload = withSha256Lock({ key: 'racing-sha', criticalSection: async () => { await uploadGate; shared = true; } });
  await registerFormAttachmentCleanup({ bus, withHashLock: withSha256Lock,
    findBlob: async () => { lookedUp = true; return { storageKey: 'blob', status: 'tombstoned' }; },
    hasOwners: async () => shared,
    deleteBytes: async () => assert.fail('a concurrent upload still owns these bytes'),
    removeBlob: async () => assert.fail('a concurrent upload still owns this row'),
  });
  const cleanup = bus.publish({ id: 'race', name: 'form.attachment.cleanup', workspaceId: 'w', aggregateId: 'm',
    occurredAt: new Date(0).toISOString(), payload: { workspaceId: 'w', sha256: 'racing-sha' } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(lookedUp, false, 'ownership must be checked after the upload releases the shared lock');
  releaseUpload();
  await Promise.all([upload, cleanup]);
  assert.equal(lookedUp, true);
});

test('captured rendition keys survive a missing original and preserve exact-key owners', async () => {
  const events: any[] = [], removed: string[] = [];
  await scheduleFormAttachmentCleanup({ outbox: { enqueue: async e => { events.push(e); } }, workspaceId: 'w', mediaId: 'm', sha256: 'sha', now: 0, graceMs: 1,
    storageKeys: ['thumb', 'shared', 'thumb'] });
  assert.deepEqual(events[0].payload.storageKeys, ['thumb', 'shared']);
  const bus = new InMemoryEventBus();
  await registerFormAttachmentCleanup({ bus, withHashLock: withSha256Lock,
    findBlob: async () => null, hasOwners: async () => false,
    withStorageKeyLock: ({ criticalSection }) => criticalSection(),
    hasStorageKeyOwners: async ({ storageKey }) => storageKey === 'shared',
    deleteBytes: async ({ storageKey }) => { removed.push(storageKey); },
    removeBlob: async () => assert.fail('the original row no longer exists'),
  });
  await bus.publish(events[0]);
  assert.deepEqual(removed, ['thumb']);
});

test('partial rendition deletion remains retryable and ownership checks fail closed', async () => {
  const bus = new InMemoryEventBus();
  const bytes = new Set(['one', 'two']); let fail = true, lookupFails = false;
  await registerFormAttachmentCleanup({ bus, withHashLock: withSha256Lock,
    findBlob: async () => null, hasOwners: async () => false,
    withStorageKeyLock: ({ criticalSection }) => criticalSection(),
    hasStorageKeyOwners: async () => { if (lookupFails) throw new Error('private lookup'); return false; },
    deleteBytes: async ({ storageKey }) => { if (storageKey === 'two' && fail) throw new Error('private provider'); bytes.delete(storageKey); },
    removeBlob: async () => assert.fail('the original row no longer exists'),
  });
  const event = { id: 'partial', name: 'form.attachment.cleanup', workspaceId: 'w', aggregateId: 'm', occurredAt: new Date(0).toISOString(),
    payload: { workspaceId: 'w', sha256: 'sha', storageKeys: ['one', 'two'] } };
  await assert.rejects(bus.publish(event), error => { assert.equal((error as Error).message.includes('private'), false); return true; });
  assert.deepEqual([...bytes], ['two']);
  lookupFails = true; fail = false;
  await assert.rejects(bus.publish(event)); assert.deepEqual([...bytes], ['two']);
  lookupFails = false; await bus.publish(event); assert.deepEqual([...bytes], []);
});

test('captured keys use their own writer lock outside the original source lock', async () => {
  const bus = new InMemoryEventBus(); const locks: string[] = []; let lockedKey: string | undefined, sourceLocked = false;
  await registerFormAttachmentCleanup({ bus,
    withHashLock: async ({ criticalSection }) => { sourceLocked = true; try { await criticalSection(); } finally { sourceLocked = false; } },
    withStorageKeyLock: async ({ storageKey, criticalSection }) => {
      assert.equal(sourceLocked, false, 'source and output hashes must never nest and deadlock');
      locks.push(storageKey); lockedKey = storageKey; try { await criticalSection(); } finally { lockedKey = undefined; }
    },
    findBlob: async () => null, hasOwners: async () => false,
    hasStorageKeyOwners: async ({ storageKey }) => { assert.equal(lockedKey, storageKey); return false; },
    deleteBytes: async ({ storageKey }) => { assert.equal(lockedKey, storageKey); },
    removeBlob: async () => assert.fail('no original row'),
  });
  await bus.publish({ id: 'locks', name: 'form.attachment.cleanup', workspaceId: 'w', aggregateId: 'm', occurredAt: new Date(0).toISOString(),
    payload: { workspaceId: 'w', sha256: 'source', storageKeys: ['output-one', 'output-two'] } });
  assert.deepEqual(locks, ['output-one', 'output-two']);
});
