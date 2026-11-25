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

// A package test supplies its own clock port; the system clock lives in the platform package.
const testClock = { nowMs: () => Date.now() };

const scope: ChatOwnerScope = { scopeId: 's', ownerKind: 'user', ownerId: 'u' };

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try { await run(); } catch (error) { return error; }
  return undefined;
}

describe('history.read tool-event projection', () => {
  it('includes an events key holding undefined for a message stored without events when includeToolEvents is set', async () => {
    const fixture = await sqliteFixture();
    try {
      const store = createSqliteChatStore({ clock: testClock, kernel: fixture.kernel, scope });
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
      const store = createSqliteChatStore({ clock: testClock, kernel: fixture.kernel, scope });
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
      const store = createSqliteChatStore({ clock: testClock, kernel: fixture.kernel, scope });
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
      const store = createSqliteChatStore({ clock: testClock, kernel: fixture.kernel, scope }, { redactUserText, onSecretRedacted: signal => signals.push(signal) });
      await store.create({ id: 'c' });
      const saved = await store.appendMessage({ conversationId: 'c', message: { id: 'm', role: 'user', content: 'pw hunter2' } });
      expect(saved?.content).toBe('pw [host removed]');
      expect(saved?.secretRedaction).toEqual({ secretRedacted: true, count: 2 });
      expect(signals).toEqual([{ secretRedacted: true, count: 2 }]);
    } finally { await fixture.close(); }
  });
});

interface StoredMessageRow {
  id: string; conversation_id: string; role: string; content: string;
  agent_id: string | null; agent_name: string | null; events_json: string | null; attachments_json: string | null;
  run_id: string | null; run_status: string | null; position: number; created_at: number;
  started_at: number | null; ended_at: number | null;
}

async function storedRows(fixture: Awaited<ReturnType<typeof sqliteFixture>>): Promise<StoredMessageRow[]> {
  return fixture.kernel.query<StoredMessageRow>(sql`select * from ai_chat_messages order by position`);
}

describe('writeMessage row encoding (pinned stored columns)', () => {
  it('stores a minimal message with every optional column NULL and created_at taken from the clock', async () => {
    const fixture = await sqliteFixture();
    try {
      const store = createSqliteChatStore({ clock: { nowMs: () => 1234 }, kernel: fixture.kernel, scope });
      await store.create({ id: 'c' });
      const saved = await store.appendMessage({ conversationId: 'c', message: { id: 'm0', role: 'assistant', content: 'hi' } });
      expect(await storedRows(fixture)).toEqual([{
        id: 'm0', conversation_id: 'c', role: 'assistant', content: 'hi',
        agent_id: null, agent_name: null, events_json: null, attachments_json: null,
        run_id: null, run_status: null, position: 0, created_at: 1234, started_at: null, ended_at: null,
      }]);
      expect(saved).toEqual({ id: 'm0', role: 'assistant', content: 'hi', createdAt: 1234 });
    } finally { await fixture.close(); }
  });

  it('stores every optional field as its own column, JSON-encodes events/attachments, and round-trips on read', async () => {
    const fixture = await sqliteFixture();
    try {
      const store = createSqliteChatStore({ clock: { nowMs: () => 9000 }, kernel: fixture.kernel, scope });
      await store.create({ id: 'c' });
      const events = [{ kind: 'text', text: 'x' }] as never;
      const attachments = [{ path: 'a.png', name: 'a.png' }] as never;
      await store.appendMessage({ conversationId: 'c', message: { id: 'm0', role: 'user', content: 'first' } });
      const saved = await store.appendMessage({ conversationId: 'c', message: {
        id: 'm1', role: 'assistant', content: 'full', agentId: 'ag', agentName: 'Agent', events, attachments,
        runId: 'r1', runStatus: 'succeeded', createdAt: 5, startedAt: 6, endedAt: 7,
      } });
      const rows = await storedRows(fixture);
      expect(rows[1]).toEqual({
        id: 'm1', conversation_id: 'c', role: 'assistant', content: 'full', agent_id: 'ag', agent_name: 'Agent',
        events_json: JSON.stringify(events), attachments_json: JSON.stringify(attachments),
        run_id: 'r1', run_status: 'succeeded', position: 1, created_at: 5, started_at: 6, ended_at: 7,
      });
      const expected = { id: 'm1', role: 'assistant', content: 'full', agentId: 'ag', agentName: 'Agent', events, attachments, runId: 'r1', runStatus: 'succeeded', createdAt: 5, startedAt: 6, endedAt: 7 };
      expect(saved).toEqual(expected);
      expect(await store.message!({ conversationId: 'c', messageId: 'm1' })).toEqual(expected);
      expect((await store.messages({ conversationId: 'c' })).map(message => message.id)).toEqual(['m0', 'm1']);
    } finally { await fixture.close(); }
  });

  it('re-writing an id keeps its position and creation columns but replaces the mutable run columns, and bumps the chat activity time', async () => {
    const fixture = await sqliteFixture();
    try {
      let now = 100;
      const store = createSqliteChatStore({ clock: { nowMs: () => now }, kernel: fixture.kernel, scope });
      await store.create({ id: 'c' });
      await store.appendMessage({ conversationId: 'c', message: { id: 'm0', role: 'assistant', content: 'draft', agentId: 'ag', runId: 'r', runStatus: 'running', startedAt: 1 } });
      now = 200;
      await store.appendMessage({ conversationId: 'c', message: { id: 'm1', role: 'user', content: 'next' } });
      now = 300;
      await store.appendMessage({ conversationId: 'c', message: { id: 'm0', role: 'assistant', content: 'final', agentId: 'other', runId: 'r', runStatus: 'succeeded', startedAt: 1, endedAt: 9 } });
      const rows = await storedRows(fixture);
      expect(rows.map(row => [row.id, row.position])).toEqual([['m0', 0], ['m1', 1]]);
      expect(rows[0]).toMatchObject({ content: 'final', agent_id: 'ag', run_status: 'succeeded', ended_at: 9, created_at: 100 });
      const [chat] = await fixture.kernel.query<{ updated_at: number }>(sql`select updated_at from ai_chats where id = 'c'`);
      expect(chat!.updated_at).toBe(300);
    } finally { await fixture.close(); }
  });

  it('returns null and writes nothing for a conversation the scope does not own', async () => {
    const fixture = await sqliteFixture();
    try {
      const store = createSqliteChatStore({ clock: testClock, kernel: fixture.kernel, scope });
      expect(await store.appendMessage({ conversationId: 'missing', message: { id: 'm', role: 'user', content: 'x' } })).toBeNull();
      expect(await storedRows(fixture)).toEqual([]);
    } finally { await fixture.close(); }
  });
});

describe('writeMessage atomicity (M-split-write-transaction pin)', () => {
  it('leaves no message row when the activity-time update fails after the insert, in its own transaction', async () => {
    const fixture = await sqliteFixture();
    try {
      const store = createSqliteChatStore({ clock: testClock, kernel: fixture.kernel, scope });
      await store.create({ id: 'c' });
      await fixture.kernel.query(sql`CREATE TRIGGER refuse_touch BEFORE UPDATE ON ai_chats BEGIN SELECT RAISE(ABORT, 'touch refused'); END`);
      const error = await caught(() => store.appendMessage({ conversationId: 'c', message: { id: 'm', role: 'user', content: 'x' } }));
      expect(error).toBeInstanceOf(ChatStoreError);
      expect(await storedRows(fixture)).toEqual([]);
    } finally { await fixture.close(); }
  });

  it('a rolled-back write consumes no position: the next append to the same conversation starts at 0', async () => {
    const fixture = await sqliteFixture();
    try {
      const store = createSqliteChatStore({ clock: testClock, kernel: fixture.kernel, scope });
      await store.create({ id: 'c' });
      await fixture.kernel.query(sql`CREATE TRIGGER refuse_touch BEFORE UPDATE ON ai_chats BEGIN SELECT RAISE(ABORT, 'touch refused'); END`);
      await caught(() => store.appendMessage({ conversationId: 'c', message: { id: 'm1', role: 'user', content: 'x' } }));
      await fixture.kernel.query(sql`DROP TRIGGER refuse_touch`);
      const saved = await store.appendMessage({ conversationId: 'c', message: { id: 'm2', role: 'user', content: 'y' } });
      expect(saved?.id).toBe('m2');
      expect((await storedRows(fixture)).map(row => [row.id, row.position])).toEqual([['m2', 0]]);
    } finally { await fixture.close(); }
  });
});
