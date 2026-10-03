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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createChatHistoryMaintenance, createChatHistoryStore } from '../sqlite/index.js';
import { ensureChatHistoryTables } from '../sqlite/index.js';
import type { SqliteDb } from '@jini-ai/db/sqlite';

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
  ensureChatHistoryTables({ db: db });
});

async function seedAliceChat(id = 'chat-a') {
  const alice = createChatHistoryStore({ db: db, scope: ALICE });
  await alice.create({ id, title: 'Alice private' });
  await alice.appendMessage({ conversationId: id, message: { id: 'm1', role: 'user', content: 'secret' } });
  return alice;
}

describe('cross-owner reads', () => {
  it('returns null when another user fetches a chat by id', async () => {
    await seedAliceChat();
    expect(await createChatHistoryStore({ db: db, scope: BOB }).get({ id: 'chat-a' })).toBeNull();
  });

  it('returns null across workspaces even for the same owner id', async () => {
    await seedAliceChat();
    expect(await createChatHistoryStore({ db: db, scope: ALICE_OTHER_WS }).get({ id: 'chat-a' })).toBeNull();
  });

  it('returns null across owner kinds even for the same owner id', async () => {
    await seedAliceChat();
    expect(await createChatHistoryStore({ db: db, scope: GUEST }).get({ id: 'chat-a' })).toBeNull();
  });

  it('omits other owners chats from list', async () => {
    await seedAliceChat();
    await createChatHistoryStore({ db: db, scope: BOB }).create({ id: 'chat-b', title: 'Bob own' });
    const bobList = await createChatHistoryStore({ db: db, scope: BOB }).list();
    expect(bobList.map((c) => c.id)).toEqual(['chat-b']);
  });

  it('returns no messages when another user asks for them', async () => {
    await seedAliceChat();
    expect(await createChatHistoryStore({ db: db, scope: BOB }).messages({ conversationId: 'chat-a' })).toEqual([]);
  });
});

describe('cross-owner writes are no-ops, not errors', () => {
  it('does not delete another owners chat', async () => {
    const alice = await seedAliceChat();
    await createChatHistoryStore({ db: db, scope: BOB }).delete({ id: 'chat-a' });
    expect(await alice.get({ id: 'chat-a' })).not.toBeNull();
  });

  it('does not rename another owners chat', async () => {
    const alice = await seedAliceChat();
    await createChatHistoryStore({ db: db, scope: BOB }).rename({ id: 'chat-a', title: 'pwned' });
    expect((await alice.get({ id: 'chat-a' }))?.title).toBe('Alice private');
  });

  it('refuses to append a message into another owners chat', async () => {
    const alice = await seedAliceChat();
    const written = await createChatHistoryStore({ db: db, scope: BOB }).appendMessage({ conversationId: 'chat-a', message: {
      id: 'injected',
      role: 'user',
      content: 'injected',
    } });
    expect(written).toBeNull();
    expect((await alice.messages({ conversationId: 'chat-a' })).map((m) => m.id)).toEqual(['m1']);
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
     * another conversation's id produces exactly this sequence — observed live in a real admin UI
     * before its conversation-switch race was fixed, where a stale transcript was PUT against a
     * newly selected chat.
     */
    const alice = await seedAliceChat();
    const bob = createChatHistoryStore({ db: db, scope: BOB });
    await bob.create({ id: 'chat-b', title: 'Bob own' });

    const written = await bob.appendMessage({ conversationId: 'chat-b', message: { id: 'm1', role: 'user', content: 'pwned' } });

    // Alice's message must be untouched, and still hers.
    expect((await alice.messages({ conversationId: 'chat-a' })).map((m) => m.content)).toEqual(['secret']);
    // And the write must not have silently landed on Bob's side either.
    expect(written).toBeNull();
    expect(await bob.messages({ conversationId: 'chat-b' })).toEqual([]);
  });

  it('does not touch another owners chat', async () => {
    const alice = await seedAliceChat();
    const before = (await alice.get({ id: 'chat-a' }))!.updatedAt;
    await createChatHistoryStore({ db: db, scope: BOB }).touch({ id: 'chat-a' }, { expiresAt: 1 });
    const after = await alice.get({ id: 'chat-a' });
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
    await alice.appendMessage({ conversationId: 'chat-a', message: {
      id: 'm1',
      role: 'user',
      content: 'secret, revised',
      runStatus: 'succeeded',
    } });

    const messages = await alice.messages({ conversationId: 'chat-a' });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('secret, revised');
    expect(messages[0]?.runStatus).toBe('succeeded');
  });

  it('keeps position stable across an in-place update', async () => {
    const alice = await seedAliceChat();
    await alice.appendMessage({ conversationId: 'chat-a', message: { id: 'm2', role: 'assistant', content: 'second' } });
    // Re-write the FIRST message; it must stay first.
    await alice.appendMessage({ conversationId: 'chat-a', message: { id: 'm1', role: 'user', content: 'secret, revised' } });

    expect((await alice.messages({ conversationId: 'chat-a' })).map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('deletion', () => {
  it('cascades to the conversation messages', async () => {
    const alice = await seedAliceChat();
    await alice.delete({ id: 'chat-a' });
    const orphans = db.prepare(`SELECT COUNT(*) AS n FROM ai_chat_messages`).get() as { n: number };
    expect(orphans.n).toBe(0);
  });
});

describe('title source', () => {
  it('lets a generated title replace a fallback one', async () => {
    const alice = createChatHistoryStore({ db: db, scope: ALICE });
    await alice.create({ id: 'c', title: 'Search My Posts', titleSource: 'fallback' });
    const renamed = await alice.rename({ id: 'c', title: 'Post Search Results' }, { source: 'generated' });
    expect(renamed?.title).toBe('Post Search Results');
  });

  it('never lets a generated title clobber a manual rename', async () => {
    const alice = createChatHistoryStore({ db: db, scope: ALICE });
    await alice.create({ id: 'c', title: 'Search My Posts' });
    await alice.rename({ id: 'c', title: 'Q3 launch notes' }, { source: 'manual' });
    await alice.rename({ id: 'c', title: 'Post Search Results' }, { source: 'generated' });
    const after = await alice.get({ id: 'c' });
    expect(after?.title).toBe('Q3 launch notes');
    expect(after?.titleSource).toBe('manual');
  });
});

describe('retention sweep', () => {
  it('deletes only expired rows and never touches never-expiring history', async () => {
    const alice = createChatHistoryStore({ db: db, scope: ALICE });
    const guest = createChatHistoryStore({ db: db, scope: GUEST });
    await alice.create({ id: 'admin-forever' });
    await guest.create({ id: 'guest-stale', expiresAt: 1_000 });
    await guest.create({ id: 'guest-fresh', expiresAt: 9_000 });

    const deleted = await createChatHistoryMaintenance({ db: db }).sweepExpired({ now: 5_000 });

    expect(deleted).toBe(1);
    expect(await alice.get({ id: 'admin-forever' })).not.toBeNull();
    expect(await guest.get({ id: 'guest-fresh' })).not.toBeNull();
    expect(await guest.get({ id: 'guest-stale' })).toBeNull();
  });

  it('honours its chunk limit so one call cannot hold a long write lock', async () => {
    const guest = createChatHistoryStore({ db: db, scope: GUEST });
    for (let i = 0; i < 5; i += 1) await guest.create({ id: `g${i}`, expiresAt: 1_000 });
    const maintenance = createChatHistoryMaintenance({ db: db });
    expect(await maintenance.sweepExpired({ now: 5_000 }, { limit: 2 })).toBe(2);
    expect(await maintenance.sweepExpired({ now: 5_000 }, { limit: 2 })).toBe(2);
    expect(await maintenance.sweepExpired({ now: 5_000 }, { limit: 2 })).toBe(1);
    expect(await maintenance.sweepExpired({ now: 5_000 }, { limit: 2 })).toBe(0);
  });
});

describe('message ordering', () => {
  it('assigns sequential positions and returns messages in that order', async () => {
    const alice = createChatHistoryStore({ db: db, scope: ALICE });
    await alice.create({ id: 'c' });
    // Identical `createdAt` on every message: ordering must come from `position`, so a store
    // that sorted by timestamp would produce a nondeterministic result here rather than pass.
    for (const id of ['m1', 'm2', 'm3']) {
      await alice.appendMessage({ conversationId: 'c', message: { id, role: 'user', content: id, createdAt: 42 } });
    }
    expect((await alice.messages({ conversationId: 'c' })).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('updates a message in place without allocating a new position', async () => {
    const alice = createChatHistoryStore({ db: db, scope: ALICE });
    await alice.create({ id: 'c' });
    await alice.appendMessage({ conversationId: 'c', message: { id: 'm1', role: 'assistant', content: '', runStatus: 'running' } });
    await alice.appendMessage({ conversationId: 'c', message: { id: 'm1', role: 'assistant', content: 'done', runStatus: 'succeeded' } });
    const messages = await alice.messages({ conversationId: 'c' });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('done');
    expect(messages[0]?.runStatus).toBe('succeeded');
  });
});

afterEach(() => {db.close();});
