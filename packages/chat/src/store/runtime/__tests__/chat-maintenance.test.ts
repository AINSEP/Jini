import { afterEach, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import type { StorageKernel } from '@jini-ai/core/contracts/storage';
import { createChatHistoryStore } from '../chat-history-store.js';
import { createChatMaintenanceForKernel } from '../chat-maintenance.js';
import type { ChatDatabase } from '../kernel.js';
import { runtimeFixture, type RuntimeFixture } from './runtime-fixture.js';

const guest = { scopeId: 'ws', ownerKind: 'guest', ownerId: 'guest-hash' } as const;
const isDaemonRunId = () => false;
let f: RuntimeFixture | undefined;
afterEach(() => { vi.restoreAllMocks(); f?.close(); f = undefined; });

it('routes a better-sqlite3 kernel to the SQLite maintenance, which sweeps only expired chats', async () => {
  f = runtimeFixture();
  const history = createChatHistoryStore({ kernel: f.kernel, scope: guest, isDaemonRunId });
  await history.create({ id: 'gone', expiresAt: 10 });
  await history.create({ id: 'kept' });
  expect(await createChatMaintenanceForKernel({ kernel: f.kernel }).sweepExpired({ now: 10 }, { limit: 500 })).toBe(1);
  expect(f.rows<{ id: string }>('SELECT id FROM ai_chats').map((r) => r.id)).toEqual(['kept']);
});

it.each(['pglite', 'pglite-socket', 'node-postgres'] as const)('routes a postgres %s kernel to its adapter without SQL', (transport) => {
  f = runtimeFixture();
  const run = vi.spyOn(f.kernel, 'run');
  const kernel: StorageKernel<Kysely<ChatDatabase>, ChatDatabase> = { ...f.kernel, dialect: 'postgres', transport };
  expect(typeof createChatMaintenanceForKernel({ kernel }).sweepExpired).toBe('function');
  expect(run).not.toHaveBeenCalled();
});

// The adapter the transport selected refuses a contradicting dialect, proving the selection.
it.each(['pglite', 'pglite-socket', 'node-postgres'] as const)('a sqlite-dialect %s kernel is refused by the selected postgres adapter', (transport) => {
  f = runtimeFixture();
  const kernel: StorageKernel<Kysely<ChatDatabase>, ChatDatabase> = { ...f.kernel, transport };
  expect(() => createChatMaintenanceForKernel({ kernel })).toThrow('Invalid chat store input.');
});

it('a postgres-dialect better-sqlite3 kernel is refused by the selected SQLite adapter', () => {
  f = runtimeFixture();
  const kernel: StorageKernel<Kysely<ChatDatabase>, ChatDatabase> = { ...f.kernel, dialect: 'postgres' };
  expect(() => createChatMaintenanceForKernel({ kernel })).toThrow('Invalid chat store input.');
});
