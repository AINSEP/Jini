/**
 * Direct boundary tests for `sql/store.ts` paths the shared store contracts do not reach: the
 * history reader's tool-event projection, non-unique insert failures, a conversation deleted
 * between its insert and its re-read, and a host-supplied user-text redactor. Real SQLite only;
 * host behaviour is simulated with SQL triggers rather than fakes.
 */
import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { sqliteFixture } from './fixtures.js';
import { createSqliteChatStore } from '../sqlite/index.js';
import { ChatStoreError } from '../errors.js';
import type { ChatOwnerScope } from '../ports.js';
import type { RedactUserText } from '../../core/user-text-redaction.js';

const scope: ChatOwnerScope = { scopeId: 's', ownerKind: 'user', ownerId: 'u' };

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try { await run(); } catch (error) { return error; }
  return undefined;
}

describe('history.read tool-event projection', () => {
  it('includes an events key holding undefined for a message stored without events when includeToolEvents is set', async () => {
    const fixture = await sqliteFixture();
    try {
      const store = createSqliteChatStore({ kernel: fixture.kernel, scope });
      await store.create({ id: 'c' });
      await store.appendMessage({ conversationId: 'c', message: { id: 'm', role: 'assistant', content: 'hi' } });
      const page = await store.history!.read({ chatId: 'c' }, { includeToolEvents: true });
      expect(page.messages).toHaveLength(1);
      expect('events' in page.messages[0]!).toBe(true);
      expect(page.messages[0]!.events).toBeUndefined();
    } finally { await fixture.close(); }
  });
});

describe('create failure paths', () => {
  it('reports a non-unique insert failure as unavailable, keeping the driver error as its cause', async () => {
    const fixture = await sqliteFixture();
    try {
      await fixture.kernel.query(sql`CREATE TRIGGER refuse BEFORE INSERT ON ai_chats BEGIN SELECT RAISE(ABORT, 'host policy refused'); END`);
      const store = createSqliteChatStore({ kernel: fixture.kernel, scope });
      const error = await caught(() => store.create({ id: 'c' }));
      expect(error).toBeInstanceOf(ChatStoreError);
      expect((error as ChatStoreError).code).toBe('unavailable');
      expect(((error as ChatStoreError).cause as Error).message).toContain('host policy refused');
    } finally { await fixture.close(); }
  });

  it('refuses with unavailable when the new conversation is gone before its re-read (a concurrent delete)', async () => {
    const fixture = await sqliteFixture();
    try {
      await fixture.kernel.query(sql`CREATE TRIGGER vanish AFTER INSERT ON ai_chats BEGIN DELETE FROM ai_chats WHERE id = NEW.id; END`);
      const store = createSqliteChatStore({ kernel: fixture.kernel, scope });
      const error = await caught(() => store.create({ id: 'gone' }));
      expect(error).toBeInstanceOf(ChatStoreError);
      expect((error as ChatStoreError).code).toBe('unavailable');
      expect(((error as ChatStoreError).cause as Error).message).toBe('ai_chats: created conversation gone was not readable in its own scope');
    } finally { await fixture.close(); }
  });
});

describe('appendMessage with a host redactor', () => {
  it('persists the host redactor output and reports its count', async () => {
    const fixture = await sqliteFixture();
    try {
      const redactUserText: RedactUserText = ({ text }) => ({ text: text.replace('hunter2', '[host removed]'), secretRedacted: true, count: 2 });
      const signals: unknown[] = [];
      const store = createSqliteChatStore({ kernel: fixture.kernel, scope }, { redactUserText, onSecretRedacted: signal => signals.push(signal) });
      await store.create({ id: 'c' });
      const saved = await store.appendMessage({ conversationId: 'c', message: { id: 'm', role: 'user', content: 'pw hunter2' } });
      expect(saved?.content).toBe('pw [host removed]');
      expect(saved?.secretRedaction).toEqual({ secretRedacted: true, count: 2 });
      expect(signals).toEqual([{ secretRedacted: true, count: 2 }]);
    } finally { await fixture.close(); }
  });
});
