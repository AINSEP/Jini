/** The raw-handle wrappers open their kernel only through the factory the host injects (K5). */
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { sqliteKernel } from '@jini-ai/db/kernel/sqlite';
import { createChatHistoryMaintenance, createChatHistoryStore, ensureChatHistoryTables } from '../sqlite/index.js';
import type { ChatDatabase } from '../sql/tables.js';

const scope = { scopeId: 'ws', ownerKind: 'user' as const, ownerId: 'alice' };

function openDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  ensureChatHistoryTables({ db });
  return db;
}

describe('sqlite chat wrappers take the kernel factory from the host', () => {
  it('opens the store kernel through the injected factory, for exactly the handle it was given', async () => {
    const db = openDb();
    const open = vi.fn(({ source }: { source: typeof db }) => sqliteKernel<ChatDatabase>({ source }));
    const store = createChatHistoryStore({ db, sqliteKernel: open, scope, clock: { nowMs: () => 1 } });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toEqual({ source: db });
    await store.create({ id: 'c', title: 'kept' });
    expect((await store.get({ id: 'c' }))?.title).toBe('kept');
    db.close();
  });

  it('opens the maintenance kernel through the injected factory too', async () => {
    const db = openDb();
    const open = vi.fn(({ source }: { source: typeof db }) => sqliteKernel<ChatDatabase>({ source }));
    const maintenance = createChatHistoryMaintenance({ db, sqliteKernel: open });
    expect(open.mock.calls).toEqual([[{ source: db }]]);
    expect(typeof maintenance.sweepExpired).toBe('function');
    db.close();
  });
});
