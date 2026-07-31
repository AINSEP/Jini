/**
 * Owner isolation for `ai_chats` / `ai_chat_messages`.
 *
 * This file exists before any consumer does, deliberately. The failure this guards against is an
 * omission — a query that filters on `id` and forgets the owner — and omissions do not announce
 * themselves in review or in a happy-path test. Every method on the store gets a "someone else's
 * id" case here, so adding a method without an isolation test leaves a visible hole.
 *
 * The assertion is always `null` / `[]` / no-op, never a thrown error: distinguishing "not found"
 * from "not yours" is itself an enumeration oracle, and a store that throws `Forbidden` for the
 * second case tells an attacker which ids exist.
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { createChatHistoryMaintenance, createChatHistoryStore } from '../store.js';
import { ensureChatHistoryTables } from '../schema.js';
import type { SqliteDb } from '../../core/types.js';

const ALICE = { scopeId: 'ws-1', ownerKind: 'user', ownerId: 'alice' } as const;
/** Same workspace, different user — the case a naive `WHERE id = ?` gets wrong. */
const BOB = { scopeId: 'ws-1', ownerKind: 'user', ownerId: 'bob' } as const;
/** Same *user id* string, different workspace — catches a predicate that drops `scope_id`. */
const ALICE_OTHER_WS = { scopeId: 'ws-2', ownerKind: 'user', ownerId: 'alice' } as const;
/** Same id string as a user, but a guest — catches a predicate that drops `owner_kind`. */
const GUEST = { scopeId: 'ws-1', ownerKind: 'guest', ownerId: 'alice' } as const;

let db: SqliteDb;

beforeEach(() => {
  db = new Database(':memory:');
  // Without this the `ON DELETE CASCADE` is inert and the cascade test below passes vacuously.
  db.pragma('foreign_keys = ON');
  ensureChatHistoryTables(db);
});

async function seedAliceChat(id = 'chat-a') {
  const alice = createChatHistoryStore(db, ALICE);
  await alice.create({ id, title: 'Alice private' });
  await alice.appendMessage(id, { id: 'm1', role: 'user', content: 'secret' });
  return alice;
}

describe('cross-owner reads', () => {
  it('returns null when another user fetches a chat by id', async () => {
    await seedAliceChat();
    expect(await createChatHistoryStore(db, BOB).get('chat-a')).toBeNull();
  });

  it('returns null across workspaces even for the same owner id', async () => {
    await seedAliceChat();
    expect(await createChatHistoryStore(db, ALICE_OTHER_WS).get('chat-a')).toBeNull();
  });

  it('returns null across owner kinds even for the same owner id', async () => {
    await seedAliceChat();
    expect(await createChatHistoryStore(db, GUEST).get('chat-a')).toBeNull();
  });

  it('omits other owners chats from list', async () => {
    await seedAliceChat();
    await createChatHistoryStore(db, BOB).create({ id: 'chat-b', title: 'Bob own' });
    const bobList = await createChatHistoryStore(db, BOB).list();
    expect(bobList.map((c) => c.id)).toEqual(['chat-b']);
  });

  it('returns no messages when another user asks for them', async () => {
    await seedAliceChat();
    expect(await createChatHistoryStore(db, BOB).messages('chat-a')).toEqual([]);
  });
});

describe('cross-owner writes are no-ops, not errors', () => {
  it('does not delete another owners chat', async () => {
    const alice = await seedAliceChat();
    await createChatHistoryStore(db, BOB).delete('chat-a');
    expect(await alice.get('chat-a')).not.toBeNull();
  });

  it('does not rename another owners chat', async () => {
    const alice = await seedAliceChat();
    await createChatHistoryStore(db, BOB).rename('chat-a', 'pwned');
    expect((await alice.get('chat-a'))?.title).toBe('Alice private');
  });

  it('refuses to append a message into another owners chat', async () => {
    const alice = await seedAliceChat();
    const written = await createChatHistoryStore(db, BOB).appendMessage('chat-a', {
      id: 'injected',
      role: 'user',
      content: 'injected',
    });
    expect(written).toBeNull();
    expect((await alice.messages('chat-a')).map((m) => m.id)).toEqual(['m1']);
  });

  it('does not overwrite another owners message when appending a colliding id to its OWN chat', async () => {
    /*
     * Distinct from the case above, and the one that actually got through: here the caller owns the
     * conversation it names, so `owns()` legitimately passes. The leak was the upsert's conflict
     * target — `ON CONFLICT(id)` is the GLOBAL primary key and the `DO UPDATE` carried no
     * conversation predicate, so a message id belonging to someone else's chat was updated in place.
     * The caller then received `null` (a 404 at the route) *after* the write had already landed,
     * which is what made it invisible: the request looks rejected.
     *
     * Reachable without an attacker. A client bug that posts one conversation's messages under
     * another conversation's id produces exactly this sequence — observed live in the Tovu admin
     * before its conversation-switch race was fixed, where a stale transcript was PUT against a
     * newly selected chat.
     */
    const alice = await seedAliceChat();
    const bob = createChatHistoryStore(db, BOB);
    await bob.create({ id: 'chat-b', title: 'Bob own' });

    const written = await bob.appendMessage('chat-b', { id: 'm1', role: 'user', content: 'pwned' });

    // Alice's message must be untouched, and still hers.
    expect((await alice.messages('chat-a')).map((m) => m.content)).toEqual(['secret']);
    // And the write must not have silently landed on Bob's side either.
    expect(written).toBeNull();
    expect(await bob.messages('chat-b')).toEqual([]);
  });

  it('does not touch another owners chat', async () => {
    const alice = await seedAliceChat();
    const before = (await alice.get('chat-a'))!.updatedAt;
    await createChatHistoryStore(db, BOB).touch('chat-a', { expiresAt: 1 });
    const after = await alice.get('chat-a');
    expect(after!.updatedAt).toBe(before);
    expect(after!.expiresAt).toBeUndefined();
  });
});

describe('append semantics', () => {
  /*
   * The legitimate half of the upsert, which had no coverage at all — and which the
   * conversation-scoped `WHERE` added to `ON CONFLICT` could plausibly have broken. `PUT
   * .../messages/:id` is idempotent by message id on purpose: a reply is written once when it
   * settles and re-written when its `runStatus`/timings finalize, so an in-place update has to work
   * and must not consume a second position.
   */
  it('updates a message in place when the same id is appended again to the same chat', async () => {
    const alice = await seedAliceChat();
    await alice.appendMessage('chat-a', {
      id: 'm1',
      role: 'user',
      content: 'secret, revised',
      runStatus: 'succeeded',
    });

    const messages = await alice.messages('chat-a');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('secret, revised');
    expect(messages[0]?.runStatus).toBe('succeeded');
  });

  it('keeps position stable across an in-place update', async () => {
    const alice = await seedAliceChat();
    await alice.appendMessage('chat-a', { id: 'm2', role: 'assistant', content: 'second' });
    // Re-write the FIRST message; it must stay first.
    await alice.appendMessage('chat-a', { id: 'm1', role: 'user', content: 'secret, revised' });

    expect((await alice.messages('chat-a')).map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('deletion', () => {
  it('cascades to the conversation messages', async () => {
    const alice = await seedAliceChat();
    await alice.delete('chat-a');
    const orphans = db.prepare(`SELECT COUNT(*) AS n FROM ai_chat_messages`).get() as { n: number };
    expect(orphans.n).toBe(0);
  });
});

describe('title source', () => {
  it('lets a generated title replace a fallback one', async () => {
    const alice = createChatHistoryStore(db, ALICE);
    await alice.create({ id: 'c', title: 'Search My Posts', titleSource: 'fallback' });
    const renamed = await alice.rename('c', 'Post Search Results', 'generated');
    expect(renamed?.title).toBe('Post Search Results');
  });

  it('never lets a generated title clobber a manual rename', async () => {
    const alice = createChatHistoryStore(db, ALICE);
    await alice.create({ id: 'c', title: 'Search My Posts' });
    await alice.rename('c', 'Q3 launch notes', 'manual');
    await alice.rename('c', 'Post Search Results', 'generated');
    const after = await alice.get('c');
    expect(after?.title).toBe('Q3 launch notes');
    expect(after?.titleSource).toBe('manual');
  });
});

describe('retention sweep', () => {
  it('deletes only expired rows and never touches never-expiring history', async () => {
    const alice = createChatHistoryStore(db, ALICE);
    const guest = createChatHistoryStore(db, GUEST);
    await alice.create({ id: 'admin-forever' });
    await guest.create({ id: 'guest-stale', expiresAt: 1_000 });
    await guest.create({ id: 'guest-fresh', expiresAt: 9_000 });

    const deleted = await createChatHistoryMaintenance(db).sweepExpired(5_000);

    expect(deleted).toBe(1);
    expect(await alice.get('admin-forever')).not.toBeNull();
    expect(await guest.get('guest-fresh')).not.toBeNull();
    expect(await guest.get('guest-stale')).toBeNull();
  });

  it('honours its chunk limit so one call cannot hold a long write lock', async () => {
    const guest = createChatHistoryStore(db, GUEST);
    for (let i = 0; i < 5; i += 1) await guest.create({ id: `g${i}`, expiresAt: 1_000 });
    const maintenance = createChatHistoryMaintenance(db);
    expect(await maintenance.sweepExpired(5_000, 2)).toBe(2);
    expect(await maintenance.sweepExpired(5_000, 2)).toBe(2);
    expect(await maintenance.sweepExpired(5_000, 2)).toBe(1);
    expect(await maintenance.sweepExpired(5_000, 2)).toBe(0);
  });
});

describe('message ordering', () => {
  it('assigns sequential positions and returns messages in that order', async () => {
    const alice = createChatHistoryStore(db, ALICE);
    await alice.create({ id: 'c' });
    // Identical `createdAt` on every message: ordering must come from `position`, so a store
    // that sorted by timestamp would produce a nondeterministic result here rather than pass.
    for (const id of ['m1', 'm2', 'm3']) {
      await alice.appendMessage('c', { id, role: 'user', content: id, createdAt: 42 });
    }
    expect((await alice.messages('c')).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('updates a message in place without allocating a new position', async () => {
    const alice = createChatHistoryStore(db, ALICE);
    await alice.create({ id: 'c' });
    await alice.appendMessage('c', { id: 'm1', role: 'assistant', content: '', runStatus: 'running' });
    await alice.appendMessage('c', { id: 'm1', role: 'assistant', content: 'done', runStatus: 'succeeded' });
    const messages = await alice.messages('c');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('done');
    expect(messages[0]?.runStatus).toBe('succeeded');
  });
});
