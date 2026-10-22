import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sqliteFixture, type Fixture } from './fixtures.js';
import { pgliteFixture } from './pg-fixtures.js';

const scope = { scopeId: 'site-a', ownerKind: 'user', ownerId: 'owner' } as const;
for (const [name, makeFixture] of [['SQLite', sqliteFixture], ['PGlite', pgliteFixture]] as const) {
  describe(`${name} bounded history reader`, () => {
    let fixture: Fixture;
    beforeEach(async () => { fixture = await makeFixture(); });
    afterEach(async () => { await fixture?.close(); });

    it('searches owned titles and content literally, newest first, without other owners/sites/guests', async () => {
      let now = 10;
      const store = fixture.make(scope, { nowMs: () => now });
      await store.create({ id: 'older', title: 'Theme plan' });
      await store.appendMessage({ conversationId: 'older', message: { id: 'first', role: 'user', content: 'first line\nsecond line' } });
      now = 20;
      await store.create({ id: 'newer', title: 'Different title' });
      await store.appendMessage({ conversationId: 'newer', message: { id: 'body', role: 'assistant', content: 'theme 100%_done!' } });
      await store.create({ id: 'empty', title: 'Empty' });
      for (const foreignScope of [{ ...scope, ownerId: 'other' }, { ...scope, scopeId: 'site-b' }, { ...scope, ownerKind: 'guest' as const }]) {
        const foreign = fixture.make(foreignScope);
        await foreign.create({ id: `foreign-${foreignScope.ownerId}-${foreignScope.scopeId}-${foreignScope.ownerKind}`, title: 'Theme plan' });
      }
      expect((await store.history!.list({}, { query: 'THEME' })).map(row => row.id)).toEqual(['newer', 'older']);
      expect((await store.history!.list({}, { query: '100%_done!' })).map(row => row.id)).toEqual(['newer']);
      expect(await store.history!.list({}, { query: "%' OR 1=1 --" })).toEqual([]);
      expect((await store.history!.list({}, { limit: 1 }))[0]?.id).toBe('empty');
      const older = (await store.history!.list({}, { query: 'first line' }))[0]!;
      expect(older).toMatchObject({ id: 'older', messageCount: 1, firstUserLine: 'first line\nsecond line', updatedAt: 10 });
    });

    it('reads a tail or forward positions in order, bounded, and never projects attachments', async () => {
      const store = fixture.make(scope);
      await store.create({ id: 'chat' });
      for (let i = 0; i < 5; i++) await store.appendMessage({ conversationId: 'chat', message: {
        id: `m${i}`, role: 'assistant', content: `content ${i}`, attachments: [{ path: 'private', name: 'file', kind: 'file' }],
        events: [{ kind: 'tool_use', id: 'use', name: 'read_file', input: { secret: 'payload' } }],
      } });
      fixture.resetReadRows();
      const tail = await store.history!.read({ chatId: 'chat' }, { limit: 2 });
      expect(tail.messages.map(row => row.position)).toEqual([3, 4]);
      expect(tail.hasMore).toBe(true);
      expect(fixture.readRows()).toBe(3);
      expect(tail.messages.every(row => !('attachments' in row) && !('events' in row))).toBe(true);
      const page = await store.history!.read({ chatId: 'chat' }, { fromPosition: 1, limit: 2, includeToolEvents: true });
      expect(page.messages.map(row => row.position)).toEqual([1, 2]);
      expect(page.messages[0]?.events?.[0]).toMatchObject({ kind: 'tool_use', name: 'read_file' });
      expect(page.hasMore).toBe(true);
      expect((await store.history!.read({ chatId: 'chat' }, { fromPosition: 3, limit: 2 })).hasMore).toBe(false);
      expect(await store.history!.read({ chatId: 'chat' }, { fromPosition: 999 })).toEqual({ messages: [], hasMore: false });
      const foreign = fixture.make({ ...scope, ownerId: 'other' });
      expect(await foreign.history!.read({ chatId: 'chat' })).toEqual({ messages: [], hasMore: false });
      expect(await foreign.history!.read({ chatId: 'missing' })).toEqual({ messages: [], hasMore: false });
    });

    it('rejects invalid resource bounds rather than reading an unbounded transcript', async () => {
      const reader = fixture.make(scope).history!;
      for (const limit of [0, 51, NaN, 1.5]) await expect(reader.list({}, { limit })).rejects.toMatchObject({ code: 'invalid-input' });
      await expect(reader.list({}, { query: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'invalid-input' });
      for (const limit of [0, 101, NaN, 1.5]) await expect(reader.read({ chatId: 'chat' }, { limit })).rejects.toMatchObject({ code: 'invalid-input' });
      for (const fromPosition of [-1, Infinity, 0.5]) await expect(reader.read({ chatId: 'chat' }, { fromPosition })).rejects.toMatchObject({ code: 'invalid-input' });
    });
  });
}
