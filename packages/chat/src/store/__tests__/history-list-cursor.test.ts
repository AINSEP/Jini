import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sqliteFixture, type Fixture } from './fixtures.js';
import { pgliteFixture } from './pg-fixtures.js';
import { buildAssistantHistoryRegistrations, HISTORY_TOTAL_CHAR_CAP } from '../runtime/history-tools.js';
import type { ToolExecutionContext } from '@jini-ai/core';

const scope = { scopeId: 'site-a', ownerKind: 'user', ownerId: 'owner' } as const;
for (const [name, makeFixture] of [['SQLite', sqliteFixture], ['PGlite', pgliteFixture]] as const) {
  describe(`${name} chat history cursor`, () => {
    let fixture: Fixture;
    beforeEach(async () => { fixture = await makeFixture(); });
    afterEach(async () => { await fixture?.close(); });

    it('returns the remaining chats once and binds cursors to the owner', async () => {
      const store = fixture.make(scope, { nowMs: () => 10 });
      for (const id of ['c3', 'c1', 'c2']) await store.create({ id, title: 'same time' });
      const history = store.history;
      if (!history) throw new Error('history reader missing');
      const first = await history.list({}, { limit: 2 });
      expect(first.items.map(row => row.id)).toEqual(['c1', 'c2']);
      expect(typeof first.nextCursor).toBe('string');
      await store.delete({ id: 'c2' });
      const second = await history.list({}, { limit: 2, cursor: first.nextCursor });
      expect(second.items.map(row => row.id)).toEqual(['c3']);
      expect(second.nextCursor).toBeNull();
      const search = await history.list({}, { query: 'same time', limit: 1 });
      const nextSearch = await history.list({}, { query: 'same time', limit: 1, cursor: search.nextCursor });
      expect([...search.items, ...nextSearch.items].map(row => row.id)).toEqual(['c1', 'c3']);
      expect(nextSearch.nextCursor).toBeNull();
      const other = fixture.make({ ...scope, ownerId: 'other' }).history;
      if (!other) throw new Error('foreign history reader missing');
      await expect(other.list({}, { cursor: first.nextCursor })).rejects.toMatchObject({ code: 'invalid-cursor' });
    });

    it('continues after the last returned chat when escaped text fills the output cap', async () => {
      const store = fixture.make(scope, { nowMs: () => 10 });
      for (let i = 0; i < 12; i++) {
        const id = `chat-${String(i).padStart(2, '0')}`;
        await store.create({ id, title: '\u0001'.repeat(300) });
        await store.appendMessage({ conversationId: id, message: { id: `msg-${id}`, role: 'user', content: '\u0001'.repeat(500) } });
      }
      const tool = buildAssistantHistoryRegistrations({ ports: { getStore: async () => store } })
        .find(entry => entry.descriptor.id === 'assistant_chats_list');
      if (!tool) throw new Error('history tool missing');
      expect(tool.descriptor.inputSchema).toMatchObject({ properties: { cursor: { type: 'string' }, limit: { maximum: 50 } } });
      const context = { principal: { id: 'owner' }, executionId: 'exec', run: { id: 'run' }, signal: new AbortController().signal };
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const input = cursor ? { limit: 51, cursor } : { limit: 51 };
        const page = await tool.handler({ ...context, input } as ToolExecutionContext) as { chats: { id: string }[]; nextCursor: string | null; more?: string };
        expect(JSON.stringify(page).length).toBeLessThanOrEqual(HISTORY_TOTAL_CHAR_CAP);
        expect(page.nextCursor === null || typeof page.nextCursor === 'string').toBe(true);
        if (page.nextCursor !== null) expect(page.more).toContain('assistant_chats_list');
        expect(page.chats.length).toBeGreaterThan(0);
        ids.push(...page.chats.map(chat => chat.id));
        cursor = page.nextCursor;
      } while (cursor !== null);
      expect(ids).toEqual(Array.from({ length: 12 }, (_, i) => `chat-${String(i).padStart(2, '0')}`));
    });
  });
}
