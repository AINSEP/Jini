/** Boundary tests for the legacy sync conversation store (list/get run summaries, durations, CRUD). */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteConversation,
  getConversation,
  insertConversation,
  listConversations,
  normalizeConversationSessionMode,
  updateConversation,
} from '../conversations.js';
import { LEGACY_CHAT_DDL } from '../schema.js';

type Db = InstanceType<typeof Database>;
let open: Db[] = [];
afterEach(() => {
  for (const db of open) db.close();
  open = [];
  vi.restoreAllMocks();
});

function freshDb(): Db {
  const db = new Database(':memory:');
  open.push(db);
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY);INSERT INTO projects VALUES ('p'),('q');${LEGACY_CHAT_DDL}`);
  return db;
}

interface RawMessage {
  id: string;
  conversationId?: string;
  role?: string;
  runStatus?: string | null;
  startedAt?: unknown;
  endedAt?: unknown;
  eventsJson?: string | null;
  position: number;
}

function addMessage(db: Db, m: RawMessage): void {
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, run_status, started_at, ended_at, events_json, position, created_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, 1)`,
  ).run(m.id, m.conversationId ?? 'c', m.role ?? 'assistant', m.runStatus ?? null, m.startedAt ?? null, m.endedAt ?? null, m.eventsJson ?? null, m.position);
}

function withConversation(db: Db, id = 'c', extra: Record<string, unknown> = {}) {
  return insertConversation({ db, c: { id, projectId: 'p', createdAt: 1, updatedAt: 1, ...extra } });
}

describe('normalizeConversationSessionMode', () => {
  it('keeps chat and plan', () => {
    expect(normalizeConversationSessionMode({ value: 'chat' })).toBe('chat');
    expect(normalizeConversationSessionMode({ value: 'plan' })).toBe('plan');
  });
  it('defaults anything else to design', () => {
    expect(normalizeConversationSessionMode({ value: 'nope' })).toBe('design');
    expect(normalizeConversationSessionMode({ value: null })).toBe('design');
  });
});

describe('insertConversation', () => {
  it('stores a missing title as null and an unknown session mode as design', () => {
    const db = freshDb();
    expect(withConversation(db, 'c', { sessionMode: 'bogus' })).toEqual({
      id: 'c', projectId: 'p', title: null, sessionMode: 'design', messageCount: 0, createdAt: 1, updatedAt: 1, latestRun: undefined,
    });
    expect(db.prepare('SELECT session_mode AS s FROM conversations').get()).toEqual({ s: 'design' });
  });
});

describe('getConversation', () => {
  it('returns null for an unknown id', () => {
    expect(getConversation({ db: freshDb(), id: 'missing' })).toBeNull();
  });

  it('counts every message and omits totalDurationMs when no terminal assistant run exists', () => {
    const db = freshDb();
    withConversation(db);
    addMessage(db, { id: 'u', role: 'user', position: 0 });
    addMessage(db, { id: 'a', runStatus: 'running', startedAt: 10, position: 1 });
    const conversation = getConversation({ db, id: 'c' });
    expect(conversation).toMatchObject({ messageCount: 2, latestRun: { status: 'running', startedAt: 10 } });
    expect(conversation).not.toHaveProperty('totalDurationMs');
  });

  it('uses the highest-position assistant run as latestRun and sums terminal wall-clock durations', () => {
    const db = freshDb();
    withConversation(db);
    addMessage(db, { id: 'a1', runStatus: 'succeeded', startedAt: 100, endedAt: 150, position: 0 });
    addMessage(db, { id: 'a2', runStatus: 'failed', startedAt: 200, endedAt: 230, position: 1 });
    addMessage(db, { id: 'u', role: 'user', runStatus: 'succeeded', startedAt: 0, endedAt: 999, position: 2 });
    expect(getConversation({ db, id: 'c' })).toMatchObject({
      totalDurationMs: 80,
      latestRun: { status: 'failed', startedAt: 200, endedAt: 230, durationMs: 30 },
    });
  });

  it('clamps an ended-before-started run to zero in both the summary and the total', () => {
    const db = freshDb();
    withConversation(db);
    addMessage(db, { id: 'a', runStatus: 'canceled', startedAt: 50, endedAt: 20, position: 0 });
    expect(getConversation({ db, id: 'c' })).toMatchObject({ totalDurationMs: 0, latestRun: { durationMs: 0 } });
  });

  it('falls back to the latest usage event duration when timestamps are missing', () => {
    const db = freshDb();
    withConversation(db);
    const events = [{ kind: 'usage', durationMs: 5 }, { kind: 'text' }, { kind: 'usage', durationMs: 42 }, { kind: 'usage', durationMs: 'x' }];
    addMessage(db, { id: 'a', runStatus: 'succeeded', startedAt: 7, eventsJson: JSON.stringify(events), position: 0 });
    expect(getConversation({ db, id: 'c' })).toMatchObject({ totalDurationMs: 42, latestRun: { status: 'succeeded', startedAt: 7, durationMs: 42 } });
  });

  it('clamps a negative usage duration to zero', () => {
    const db = freshDb();
    withConversation(db);
    addMessage(db, { id: 'a', runStatus: 'succeeded', eventsJson: JSON.stringify([{ kind: 'usage', durationMs: -3 }]), position: 0 });
    expect(getConversation({ db, id: 'c' })).toMatchObject({ totalDurationMs: 0, latestRun: { durationMs: 0 } });
  });

  it.each([
    ['malformed JSON', '{oops'],
    ['a non-array JSON value', '{"kind":"usage","durationMs":3}'],
    ['an array-like non-array object', '{"length":1,"0":{"kind":"usage","durationMs":3}}'],
    ['an empty string', ''],
    ['no usage event', JSON.stringify([null, 'x', { kind: 'usage' }, { kind: 'text', durationMs: 4 }])],
  ])('omits durationMs when events_json holds %s', (_label, eventsJson) => {
    const db = freshDb();
    withConversation(db);
    addMessage(db, { id: 'a', runStatus: 'succeeded', eventsJson, position: 0 });
    const conversation = getConversation({ db, id: 'c' });
    expect(conversation?.latestRun).toEqual({ status: 'succeeded' });
    expect(conversation).not.toHaveProperty('totalDurationMs');
  });

  it('omits durationMs when events_json is null', () => {
    const db = freshDb();
    withConversation(db);
    addMessage(db, { id: 'a', runStatus: 'running', endedAt: 9, position: 0 });
    expect(getConversation({ db, id: 'c' })?.latestRun).toEqual({ status: 'running', endedAt: 9 });
  });

  it('drops non-numeric stored timestamps from the summary', () => {
    const db = freshDb();
    withConversation(db);
    addMessage(db, { id: 'a', runStatus: 'running', startedAt: 'soon', endedAt: 'later', position: 0 });
    expect(getConversation({ db, id: 'c' })?.latestRun).toEqual({ status: 'running' });
  });
});

describe('listConversations', () => {
  it('lists only the project conversations, newest first, with counts and run summaries', () => {
    const db = freshDb();
    withConversation(db, 'old', { title: 'Old', sessionMode: 'chat', updatedAt: 1 });
    withConversation(db, 'new', { updatedAt: 5 });
    insertConversation({ db, c: { id: 'other', projectId: 'q', createdAt: 1, updatedAt: 9 } });
    addMessage(db, { id: 'u', conversationId: 'old', role: 'user', position: 0 });
    addMessage(db, { id: 'a1', conversationId: 'old', runStatus: 'succeeded', startedAt: 1, endedAt: 4, position: 1 });
    addMessage(db, { id: 'a2', conversationId: 'old', runStatus: 'running', startedAt: 10, position: 2 });
    expect(listConversations({ db, projectId: 'p' })).toEqual([
      { id: 'new', projectId: 'p', title: null, sessionMode: 'design', messageCount: 0, createdAt: 1, updatedAt: 5, latestRun: undefined },
      {
        id: 'old', projectId: 'p', title: 'Old', sessionMode: 'chat', messageCount: 3, createdAt: 1, updatedAt: 1,
        totalDurationMs: 3, latestRun: { status: 'running', startedAt: 10 },
      },
    ]);
  });

  it('matches getConversation for the same conversation', () => {
    const db = freshDb();
    withConversation(db);
    addMessage(db, { id: 'a', runStatus: 'succeeded', eventsJson: JSON.stringify([{ kind: 'usage', durationMs: 12.5 }]), position: 0 });
    expect(listConversations({ db, projectId: 'p' })).toEqual([getConversation({ db, id: 'c' })]);
  });
});

describe('updateConversation', () => {
  it('returns null for an unknown conversation', () => {
    expect(updateConversation({ db: freshDb(), id: 'missing', patch: { title: 'x' } })).toBeNull();
  });

  it('normalizes a patched sessionMode and keeps an explicit numeric updatedAt', () => {
    const db = freshDb();
    withConversation(db, 'c', { title: 'T', sessionMode: 'plan' });
    expect(updateConversation({ db, id: 'c', patch: { sessionMode: 'weird', updatedAt: 77 } })).toMatchObject({ title: 'T', sessionMode: 'design', updatedAt: 77 });
  });

  it('keeps the existing sessionMode and stamps Date.now() when updatedAt is not a number', () => {
    const db = freshDb();
    withConversation(db, 'c', { title: 'T', sessionMode: 'plan' });
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    expect(updateConversation({ db, id: 'c', patch: { title: 'New', updatedAt: '9' } })).toMatchObject({ title: 'New', sessionMode: 'plan', updatedAt: 1234 });
  });

  it('stores an explicitly undefined title as null', () => {
    const db = freshDb();
    withConversation(db, 'c', { title: 'T' });
    expect(updateConversation({ db, id: 'c', patch: { title: undefined, updatedAt: 2 } })?.title).toBeNull();
  });
});

describe('deleteConversation', () => {
  it('removes only the named conversation', () => {
    const db = freshDb();
    withConversation(db, 'a');
    withConversation(db, 'b');
    deleteConversation({ db, id: 'a' });
    expect(listConversations({ db, projectId: 'p' }).map((c) => c.id)).toEqual(['b']);
  });
});
