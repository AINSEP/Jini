import { expect, it } from 'vitest';
import { sql } from 'kysely';
import { sqliteFixture } from './fixtures.js';
import { createSqliteChatStore } from '../sqlite/index.js';

// A package test supplies its own clock port; the system clock lives in the platform package.
const testClock = { nowMs: () => Date.now() };

it('redacts direct client inserts and updates before SQL persistence and reports only a count', async () => {
  const fixture = await sqliteFixture();
  try {
    const signals: unknown[] = [];
    const store = createSqliteChatStore({ clock: testClock, kernel: fixture.kernel, scope: { scopeId: 's', ownerKind: 'user', ownerId: 'u' } }, { onSecretRedacted: signal => signals.push(signal) });
    await store.create({ id: 'c' });
    const saved = await store.appendMessage({ conversationId: 'c', message: { id: 'm', role: 'user', content: 'Please save api_key=x' } });
    expect(saved?.content).toBe('Please save api_key=[token removed]');
    expect(saved?.secretRedaction).toEqual({ secretRedacted: true, count: 1 });
    await store.appendMessage({ conversationId: 'c', message: { id: 'm', role: 'user', content: 'password=y' } });
    const rows = await fixture.kernel.query<{ content: string }>(sql`select content from ai_chat_messages`);
    expect(rows.map(row => row.content)).toEqual(['password=[token removed]']);
    expect((await store.messages({ conversationId: 'c' }))[0]?.content).toBe('password=[token removed]');
    expect(signals).toEqual([{ secretRedacted: true, count: 1 }, { secretRedacted: true, count: 1 }]);
  } finally { await fixture.close(); }
});
