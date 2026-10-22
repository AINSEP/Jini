import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MessageConversationMismatchError } from '@jini-ai/chat/store/legacy/sqlite';
import { openDatabase as openInjectedDatabase, closeDatabase, migrate } from '../legacy/sqlite.js';
import { listConversations,getConversation,normalizeConversationSessionMode,insertConversation,updateConversation,deleteConversation,listMessages,upsertMessage,getMessageTelemetryFinalizationState,appendMessageStatusEvent,appendMessageAgentEvent,deleteMessage } from '@jini-ai/chat/store/legacy/sqlite';
import { listProjects,listLatestProjectRunStatuses,listLatestConversationRunStatuses,listFirstConversationRunStatuses,listLatestRunStatuses,listProjectsAwaitingInput,listConversationsAwaitingInput,getProject,insertProject,updateProject,deleteProject } from '../../store/projects/sqlite.js';
import { getAgentSession,upsertAgentSession,getAgentSessionRecord,latestCompletedAssistantMessageId,updateAgentSessionStableHash,clearAgentSession } from '@jini-ai/daemon/store/agent-sessions/sqlite';
import { parseJsonOrUndef,row,rows } from '@jini-ai/db/core';
import type { SqliteDb } from '@jini-ai/db/sqlite';
/** The fixture injects the host's actual driver; public calls use argument objects. */
function openDatabase({ projectRoot }: { projectRoot: string },options:{dataDir?:string}={}) {
 return openInjectedDatabase({ projectRoot, open: (file, settings) => new Database(file, settings) }, options);
}


const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-db-'));
  tmpDirs.push(d);
  return d;
}
function seedProject(db: SqliteDb, id = 'p1'): string {
  db.prepare(`INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(id, 'P', 1, 1);
  return id;
}

/**
 * Wraps a real SqliteDb so that `.prepare(sql)` calls matching `matches(sql)` return a stub
 * statement instead of the real prepared statement, while every other statement passes through
 * to the real database untouched. Used to force otherwise-unreachable defensive branches (e.g. "the
 * row vanished between write and read") that cannot be produced through normal SQLite query
 * results — the same fake-driver technique `db-inspect.test.ts` already established in this
 * package for its own otherwise-unreachable error paths.
 * @param realDb - The live database handle to wrap.
 * @param matches - Predicate over the raw SQL text identifying which statement to stub.
 * @param stub - Partial stand-in results; omitted methods default to empty/no-op.
 */
function withStubbedStatement(
  realDb: SqliteDb,
  matches: (sql: string) => boolean,
  stub: { get?: () => unknown; all?: () => unknown[] },
): SqliteDb {
  return new Proxy(realDb, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (sql: string) => {
          if (matches(sql)) {
            return {
              get: stub.get ?? (() => undefined),
              all: stub.all ?? (() => []),
              run: () => ({ changes: 0, lastInsertRowid: 0 }),
            };
          }
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as SqliteDb;
}
interface SeedMsg {
  id: string;
  cid: string;
  role?: string;
  position?: number;
  runStatus?: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  eventsJson?: string | null;
}
function seedMessage(db: SqliteDb, m: SeedMsg): void {
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, position, created_at, run_status, started_at, ended_at, events_json)
     VALUES (@id, @cid, @role, '', @position, 0, @runStatus, @startedAt, @endedAt, @eventsJson)`,
  ).run({
    id: m.id,
    cid: m.cid,
    role: m.role ?? 'assistant',
    position: m.position ?? 0,
    runStatus: m.runStatus ?? null,
    startedAt: m.startedAt ?? null,
    endedAt: m.endedAt ?? null,
    eventsJson: m.eventsJson ?? null,
  });
}

/** Opens a fresh temp-dir database seeded with one project ('p1'), ready for conversation/message/project/agent-session writes. */
function freshDb(): SqliteDb {
  const db = openDatabase({ projectRoot: '/r' }, { dataDir: tmp() });
  seedProject(db);
  return db;
}

afterEach(() => {
  closeDatabase();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('connection + schema', () => {
  it('opens under a .jini subfolder by default, creating the generic tables', () => {
    const dir = tmp();
    const db = openDatabase({ projectRoot: dir });
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[])
      .map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['projects', 'conversations', 'messages', 'agent_sessions']));
    // product tables are NOT ported
    expect(tables).not.toContain('deployments');
    expect(tables).not.toContain('preview_comments');
    expect(fs.existsSync(path.join(dir, '.jini', 'app.sqlite'))).toBe(true);
  });

  it('honors an explicit dataDir over the default', () => {
    const dir = tmp();
    openDatabase({ projectRoot: '/unused-root' }, { dataDir: dir });
    expect(fs.existsSync(path.join(dir, 'app.sqlite'))).toBe(true);
  });

  it('returns the cached handle for the same resolved path', () => {
    const dir = tmp();
    const a = openDatabase({ projectRoot: '/r' }, { dataDir: dir });
    const b = openDatabase({ projectRoot: '/r' }, { dataDir: dir });
    expect(b).toBe(a);
  });

  it('closes the previous connection when opening a different path', () => {
    const a = openDatabase({ projectRoot: '/r' }, { dataDir: tmp() });
    const b = openDatabase({ projectRoot: '/r' }, { dataDir: tmp() });
    expect(b).not.toBe(a);
    expect(() => a.prepare('SELECT 1')).toThrow(); // previous handle is closed
  });

  it('closeDatabase is a safe no-op when nothing is open', () => {
    closeDatabase();
    expect(() => closeDatabase()).not.toThrow();
  });

  it('migrate is idempotent', () => {
    const db = openDatabase({ projectRoot: '/r' }, { dataDir: tmp() });
    expect(() => migrate({ db })).not.toThrow();
  });
});

describe('conversations CRUD', () => {
  it('inserts and reads back a conversation, defaulting title/sessionMode', () => {
    const db = freshDb();
    const created = insertConversation({ db, c: { id: 'c1', projectId: 'p1', title: 'T', sessionMode: 'chat', createdAt: 10, updatedAt: 20 } });
    expect(created).toMatchObject({ id: 'c1', projectId: 'p1', title: 'T', sessionMode: 'chat', messageCount: 0, createdAt: 10, updatedAt: 20 });

    // no title, no sessionMode -> title null, sessionMode default 'design'
    const bare = insertConversation({ db, c: { id: 'c2', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
    expect(bare).toMatchObject({ title: null, sessionMode: 'design' });

    expect(getConversation({ db, id: 'c1' })).toMatchObject({ id: 'c1' });
    expect(getConversation({ db, id: 'missing' })).toBeNull();
  });

  it('normalizeConversationSessionMode coerces to a valid mode', () => {
    expect(normalizeConversationSessionMode({ value: 'chat' })).toBe('chat');
    expect(normalizeConversationSessionMode({ value: 'plan' })).toBe('plan');
    expect(normalizeConversationSessionMode({ value: 'design' })).toBe('design');
    expect(normalizeConversationSessionMode({ value: 'bogus' })).toBe('design');
    expect(normalizeConversationSessionMode({ value: undefined })).toBe('design');
  });

  it('lists conversations with wall-clock run duration + message counts', () => {
    const db = freshDb();
    insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 5 } });
    seedMessage(db, { id: 'm0', cid: 'c1', role: 'user', position: 0 });
    seedMessage(db, { id: 'm1', cid: 'c1', role: 'assistant', position: 1, runStatus: 'succeeded', startedAt: 1000, endedAt: 1500 });

    const list = listConversations({ db, projectId: 'p1' });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'c1',
      messageCount: 2,
      latestRun: { status: 'succeeded', startedAt: 1000, endedAt: 1500, durationMs: 500 },
      totalDurationMs: 500,
    });
  });

  it('falls back to the latest usage-event duration when timestamps are absent', () => {
    const db = freshDb();
    insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 5 } });
    seedMessage(db, {
      id: 'm1', cid: 'c1', role: 'assistant', position: 0, runStatus: 'failed',
      startedAt: null, endedAt: null,
      eventsJson: JSON.stringify([{ kind: 'other' }, { kind: 'usage', durationMs: 300 }]),
    });
    const got = getConversation({ db, id: 'c1' });
    expect(got?.latestRun).toMatchObject({ status: 'failed', durationMs: 300 });
    expect(got?.totalDurationMs).toBe(300);
  });

  it('treats malformed / usage-less events as no duration', () => {
    const db = freshDb();
    insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 5 } });
    // malformed events_json + no timestamps -> latestUsageDurationMs catches, no durationMs
    seedMessage(db, { id: 'm1', cid: 'c1', role: 'assistant', position: 0, runStatus: 'canceled', eventsJson: 'not-json' });
    const got = getConversation({ db, id: 'c1' });
    expect(got?.latestRun).toMatchObject({ status: 'canceled' });
    expect(got?.latestRun?.durationMs).toBeUndefined();
    expect(got?.totalDurationMs).toBeUndefined();
  });

  it('ignores non-array and usage-less event payloads (no duration)', () => {
    const db = freshDb();
    // array with no usage event -> the scan loop completes without a match
    insertConversation({ db, c: { id: 'ca', projectId: 'p1', createdAt: 1, updatedAt: 5 } });
    seedMessage(db, { id: 'ma', cid: 'ca', role: 'assistant', position: 0, runStatus: 'failed', eventsJson: '[{"kind":"other"}]' });
    // valid JSON that is not an array -> rejected before the loop
    insertConversation({ db, c: { id: 'cb', projectId: 'p1', createdAt: 1, updatedAt: 6 } });
    seedMessage(db, { id: 'mb', cid: 'cb', role: 'assistant', position: 0, runStatus: 'failed', eventsJson: '{"kind":"usage","durationMs":9}' });

    expect(getConversation({ db, id: 'ca' })?.latestRun?.durationMs).toBeUndefined();
    expect(getConversation({ db, id: 'cb' })?.latestRun?.durationMs).toBeUndefined();
  });

  it('reports no latestRun for a conversation with no assistant runs', () => {
    const db = freshDb();
    insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 5 } });
    seedMessage(db, { id: 'm0', cid: 'c1', role: 'user', position: 0 }); // no run_status
    const list = listConversations({ db, projectId: 'p1' });
    expect(list[0]?.latestRun).toBeUndefined();
    expect(getConversation({ db, id: 'c1' })?.latestRun).toBeUndefined();
  });

  it('updates title + sessionMode, defaults updatedAt, and returns null for a missing id', () => {
    const db = freshDb();
    insertConversation({ db, c: { id: 'c1', projectId: 'p1', title: 'A', sessionMode: 'design', createdAt: 1, updatedAt: 1 } });

    const updated = updateConversation({ db, id: 'c1', patch: { title: 'B', sessionMode: 'plan', updatedAt: 99 } });
    expect(updated).toMatchObject({ title: 'B', sessionMode: 'plan', updatedAt: 99 });

    // patch without sessionMode keeps the existing one; non-number updatedAt -> Date.now()
    const before = Date.now();
    const again = updateConversation({ db, id: 'c1', patch: { title: 'C' } });
    expect(again).toMatchObject({ title: 'C', sessionMode: 'plan' });
    expect(again!.updatedAt).toBeGreaterThanOrEqual(before);

    expect(updateConversation({ db, id: 'missing', patch: { title: 'X' } })).toBeNull();
  });

  it('persists a null title through update', () => {
    const db = freshDb();
    insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } }); // no title
    const updated = updateConversation({ db, id: 'c1', patch: { sessionMode: 'chat' } }); // patch has no title
    expect(updated).toMatchObject({ title: null, sessionMode: 'chat' });
  });

  it('deletes a conversation', () => {
    const db = freshDb();
    insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
    deleteConversation({ db, id: 'c1' });
    expect(getConversation({ db, id: 'c1' })).toBeNull();
  });
});

describe('messages CRUD', () => {
  function freshConversation(db: SqliteDb, id = 'c1'): string {
    insertConversation({ db, c: { id, projectId: 'p1', createdAt: 1, updatedAt: 1 } });
    return id;
  }

  it('inserts a message with every optional field populated and bumps the parent conversation', () => {
    const db = freshDb();
    freshConversation(db);
    const before = getConversation({ db, id: 'c1' })!.updatedAt;

    const created = upsertMessage({ db, conversationId: 'c1', m: {
      id: 'm1',
      role: 'assistant',
      content: 'hello',
      agentId: 'a1',
      agentName: 'Agent One',
      runId: 'r1',
      runStatus: 'succeeded',
      lastRunEventId: 'e1',
      events: [{ kind: 'text', text: 'hi' }],
      attachments: [{ name: 'f.txt' }],
      sessionMode: 'chat',
      runContext: { foo: 1 },
      telemetryFinalized: true,
      startedAt: 100,
      endedAt: 200,
      createdAt: 50,
    } });

    expect(created).toMatchObject({
      id: 'm1',
      role: 'assistant',
      content: 'hello',
      agentId: 'a1',
      agentName: 'Agent One',
      runId: 'r1',
      runStatus: 'succeeded',
      lastRunEventId: 'e1',
      events: [{ kind: 'text', text: 'hi' }],
      attachments: [{ name: 'f.txt' }],
      sessionMode: 'chat',
      runContext: { foo: 1 },
      startedAt: 100,
      endedAt: 200,
      createdAt: 50,
    });
    expect(getMessageTelemetryFinalizationState({ db, messageId: 'm1' })).toMatchObject({ exists: true, finalizedAt: expect.any(Number) });
    expect(getConversation({ db, id: 'c1' })!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('inserts messages with all optional fields omitted, defaulting createdAt and incrementing position', () => {
    const db = freshDb();
    freshConversation(db);

    const first = upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'user', content: 'hi' } });
    expect(first).toMatchObject({
      id: 'm1',
      role: 'user',
      content: 'hi',
      agentId: undefined,
      agentName: undefined,
      runId: undefined,
      runStatus: undefined,
      lastRunEventId: undefined,
      events: undefined,
      attachments: undefined,
      sessionMode: undefined,
      runContext: undefined,
      startedAt: undefined,
      endedAt: undefined,
    });
    expect(first!.createdAt).toEqual(expect.any(Number));
    expect(getMessageTelemetryFinalizationState({ db, messageId: 'm1' })).toMatchObject({ exists: true, finalizedAt: null });

    const second = upsertMessage({ db, conversationId: 'c1', m: { id: 'm2', role: 'user', content: 'again' } });
    expect(listMessages({ db, conversationId: 'c1' }).map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(second).not.toBeNull();
  });

  it('treats a non-finite createdAt as absent and falls back to now', () => {
    const db = freshDb();
    freshConversation(db);
    const before = Date.now();
    const created = upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'user', content: 'x', createdAt: Number.NaN } });
    expect(created!.createdAt).toBeGreaterThanOrEqual(before);
  });

  it('updates an existing message in place: content/fields change, position is preserved, telemetry_finalized_at is a one-way latch', () => {
    const db = freshDb();
    freshConversation(db);
    upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'user', content: 'v1' } });

    // update with all fields populated, not yet finalizing telemetry
    const updated = upsertMessage({ db, conversationId: 'c1', m: {
      id: 'm1',
      role: 'assistant',
      content: 'v2',
      agentId: 'a1',
      agentName: 'A',
      runId: 'r1',
      runStatus: 'running',
      lastRunEventId: 'e1',
      events: [{ kind: 'status', label: 'thinking' }],
      attachments: [{ name: 'x' }],
      sessionMode: 'plan',
      runContext: { a: 1 },
      startedAt: 10,
      endedAt: null,
    } });
    expect(updated).toMatchObject({ id: 'm1', role: 'assistant', content: 'v2', runStatus: 'running', sessionMode: 'plan' });
    expect(getMessageTelemetryFinalizationState({ db, messageId: 'm1' })).toMatchObject({ exists: true, finalizedAt: null });

    // finalize telemetry for the first time -> latch sets finalizedAt
    upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'assistant', content: 'v3', telemetryFinalized: true, endedAt: 20 } });
    const firstFinalize = getMessageTelemetryFinalizationState({ db, messageId: 'm1' });
    expect(firstFinalize).toMatchObject({ exists: true, finalizedAt: expect.any(Number) });

    // finalizing again does not move the already-set timestamp forward
    upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'assistant', content: 'v4', telemetryFinalized: true } });
    expect(getMessageTelemetryFinalizationState({ db, messageId: 'm1' }).finalizedAt).toBe(firstFinalize.finalizedAt);

    // updating with all optional fields omitted clears them back to undefined and leaves position untouched
    // (position is fetched by the internal SELECT but intentionally not part of normalizeMessage's
    // public shape, matching upstream — assert the raw column directly instead.)
    const cleared = upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'user', content: 'v5' } });
    expect(cleared).toMatchObject({ agentId: undefined, runId: undefined, sessionMode: undefined });
    const rawPosition = db.prepare(`SELECT position FROM messages WHERE id = ?`).get('m1') as { position: number };
    expect(rawPosition.position).toBe(0);
  });

  it('getMessageTelemetryFinalizationState reports not-found for an unknown id', () => {
    const db = freshDb();
    expect(getMessageTelemetryFinalizationState({ db, messageId: 'missing' })).toEqual({ exists: false, finalizedAt: null });
  });

  it('upsertMessage returns null if the row vanishes between write and read (defensive race guard)', () => {
    const db = freshDb();
    freshConversation(db);
    const proxied = withStubbedStatement(
      db,
      (sql) => sql.includes('agent_id AS agentId') && sql.includes('WHERE id = ?'),
      {},
    );
    expect(upsertMessage({ db: proxied, conversationId: 'c1', m: { id: 'ghost', role: 'user', content: 'x' } })).toBeNull();
  });

  it('falls back to position 0 when the position-max query unexpectedly returns no row (defensive fallback; COALESCE guarantees a row in real usage)', () => {
    const db = freshDb();
    freshConversation(db);
    const proxied = withStubbedStatement(db, (sql) => sql.includes('COALESCE(MAX(position), -1)'), {});
    const created = upsertMessage({ db: proxied, conversationId: 'c1', m: { id: 'm1', role: 'user', content: 'x' } });
    expect(created).not.toBeNull();
    const rawPosition = db.prepare(`SELECT position FROM messages WHERE id = ?`).get('m1') as { position: number };
    expect(rawPosition.position).toBe(0);
  });

  it('normalizeMessage falls back to undefined for a null createdAt (defensive fallback; created_at is NOT NULL by schema in real usage)', () => {
    const db = freshDb();
    freshConversation(db);
    const fakeRow = {
      id: 'm1', role: 'user', content: 'x', agentId: null, agentName: null,
      runId: null, runStatus: null, lastRunEventId: null, eventsJson: null,
      attachmentsJson: null, sessionMode: null, runContextJson: null,
      createdAt: null, startedAt: null, endedAt: null, position: 0,
    };
    const proxied = withStubbedStatement(
      db,
      (sql) => sql.includes('agent_id AS agentId') && sql.includes('WHERE conversation_id = ?'),
      { all: () => [fakeRow] },
    );
    const [msg] = listMessages({ db: proxied, conversationId: 'c1' });
    expect(msg!.createdAt).toBeUndefined();
  });

  describe('appendMessageStatusEvent', () => {
    it('returns null for a missing message or an empty/whitespace label', () => {
      const db = freshDb();
      freshConversation(db);
      upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'assistant', content: '' } });
      expect(appendMessageStatusEvent({ db, messageId: 'missing', event: { label: 'x' } })).toBeNull();
      expect(appendMessageStatusEvent({ db, messageId: 'm1', event: { label: '' } })).toBeNull();
      expect(appendMessageStatusEvent({ db, messageId: 'm1', event: {} })).toBeNull();
    });

    it('appends a status event with and without detail, and dedupes consecutive identical ones', () => {
      const db = freshDb();
      freshConversation(db);
      upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'assistant', content: '' } });

      const first = appendMessageStatusEvent({ db, messageId: 'm1', event: { label: 'Thinking' } });
      expect(first).toEqual([{ kind: 'status', label: 'Thinking' }]);

      // identical consecutive event (no detail on either side) -> deduped, array unchanged
      const deduped = appendMessageStatusEvent({ db, messageId: 'm1', event: { label: '  Thinking  ' } });
      expect(deduped).toEqual([{ kind: 'status', label: 'Thinking' }]);

      const withDetail = appendMessageStatusEvent({ db, messageId: 'm1', event: { label: 'Running', detail: 'step 1' } });
      expect(withDetail).toEqual([
        { kind: 'status', label: 'Thinking' },
        { kind: 'status', label: 'Running', detail: 'step 1' },
      ]);

      // identical consecutive event with the same detail -> deduped again
      const dedupedWithDetail = appendMessageStatusEvent({ db, messageId: 'm1', event: { label: 'Running', detail: 'step 1' } });
      expect(dedupedWithDetail).toHaveLength(2);
    });

    it('parses malformed existing events_json as an empty array before appending', () => {
      const db = freshDb();
      freshConversation(db);
      upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'assistant', content: '' } });
      db.prepare(`UPDATE messages SET events_json = ? WHERE id = ?`).run('not-json', 'm1');
      expect(appendMessageStatusEvent({ db, messageId: 'm1', event: { label: 'Recovered' } })).toEqual([{ kind: 'status', label: 'Recovered' }]);
    });
  });

  describe('appendMessageAgentEvent', () => {
    it('returns null for a non-object event, an event with no kind, or a missing message', () => {
      const db = freshDb();
      freshConversation(db);
      upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'assistant', content: '' } });
      expect(appendMessageAgentEvent({ db, messageId: 'm1', event: null as any })).toBeNull();
      expect(appendMessageAgentEvent({ db, messageId: 'm1', event: {} })).toBeNull();
      expect(appendMessageAgentEvent({ db, messageId: 'missing', event: { kind: 'text', text: 'hi' } })).toBeNull();
    });

    it('streams text deltas into content and appends non-text events without touching content', () => {
      const db = freshDb();
      freshConversation(db);
      upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'assistant', content: '' } });

      appendMessageAgentEvent({ db, messageId: 'm1', event: { kind: 'text', text: 'Hel' } });
      appendMessageAgentEvent({ db, messageId: 'm1', event: { kind: 'text', text: 'lo' } });
      appendMessageAgentEvent({ db, messageId: 'm1', event: { kind: 'tool_call', name: 'search' } });

      const msg = listMessages({ db, conversationId: 'c1' })[0]!;
      expect(msg.content).toBe('Hello');
      expect(msg.events).toEqual([
        { kind: 'text', text: 'Hel' },
        { kind: 'text', text: 'lo' },
        { kind: 'tool_call', name: 'search' },
      ]);
    });

    it('dedupes a byte-identical consecutive event', () => {
      const db = freshDb();
      freshConversation(db);
      upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'assistant', content: '' } });
      appendMessageAgentEvent({ db, messageId: 'm1', event: { kind: 'tool_call', name: 'search' } });
      const result = appendMessageAgentEvent({ db, messageId: 'm1', event: { kind: 'tool_call', name: 'search' } });
      expect(result).toHaveLength(1);
    });
  });

  it('deletes a message', () => {
    const db = freshDb();
    freshConversation(db);
    upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'user', content: 'x' } });
    deleteMessage({ db, id: 'm1' });
    expect(listMessages({ db, conversationId: 'c1' })).toHaveLength(0);
  });

  describe('cross-conversation ownership (CR-002)', () => {
    it('throws MessageConversationMismatchError when a message id already exists under a different conversation, without corrupting either conversation', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'A', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      insertConversation({ db, c: { id: 'B', projectId: 'p1', createdAt: 1, updatedAt: 1 } });

      upsertMessage({ db, conversationId: 'A', m: { id: 'shared-id', role: 'user', content: 'original in A' } });
      const aUpdatedBefore = getConversation({ db, id: 'A' })!.updatedAt;
      const bUpdatedBefore = getConversation({ db, id: 'B' })!.updatedAt;

      expect(() =>
        upsertMessage({ db, conversationId: 'B', m: {
          id: 'shared-id',
          role: 'user',
          content: 'attempted overwrite from B',
        } }),
      ).toThrow(MessageConversationMismatchError);

      // A's row is untouched by the rejected call presenting its id under conversation B.
      expect(listMessages({ db, conversationId: 'A' })).toMatchObject([{ id: 'shared-id', content: 'original in A' }]);
      // B never received the row.
      expect(listMessages({ db, conversationId: 'B' })).toHaveLength(0);
      // Neither conversation's activity timestamp was bumped by the rejected call (the whole
      // operation — including the `conversations.updated_at` bump — is one transaction, so the
      // thrown ownership error rolls back everything, not just the message write).
      expect(getConversation({ db, id: 'A' })!.updatedAt).toBe(aUpdatedBefore);
      expect(getConversation({ db, id: 'B' })!.updatedAt).toBe(bUpdatedBefore);
    });

    it('allows a normal update when the id and conversationId agree', () => {
      const db = freshDb();
      freshConversation(db, 'c1');
      upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'user', content: 'v1' } });
      const updated = upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'user', content: 'v2' } });
      expect(updated).toMatchObject({ id: 'm1', content: 'v2' });
    });

    it('serializes concurrent writers on the same conversation instead of racing to the same position', () => {
      const dir = tmp();
      const dbFile = path.join(dir, 'app.sqlite');
      const db1 = openDatabase({ projectRoot: '/r' }, { dataDir: dir });
      seedProject(db1);
      insertConversation({ db: db1, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      upsertMessage({ db: db1, conversationId: 'c1', m: { id: 'm0', role: 'user', content: 'seed' } }); // position 0

      // A second, independent connection to the same file simulates a concurrent writer/host
      // process. A short `timeout` keeps the busy-lock assertion below fast instead of waiting
      // out better-sqlite3's 5000ms default.
      const db2 = new Database(dbFile, { timeout: 100 });
      try {
        // db1 opens (but does not commit) a write transaction on the same conversation — the
        // same lock `upsertMessage`'s own `.immediate()` transaction would hold mid-flight.
        db1.prepare('BEGIN IMMEDIATE').run();
        db1
          .prepare(
            `INSERT INTO messages (id, conversation_id, role, content, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('m1', 'c1', 'user', 'in-flight on db1', 1, 2);

        // While db1's transaction is open, db2's own upsertMessage (which also opens a BEGIN
        // IMMEDIATE transaction) cannot acquire the write lock and fails fast with SQLITE_BUSY
        // instead of reading a stale MAX(position) and silently colliding with db1's in-flight row.
        expect(() =>
          upsertMessage({ db: db2, conversationId: 'c1', m: { id: 'm2', role: 'user', content: 'from db2' } }),
        ).toThrow();

        // Once db1 commits, db2's upsert succeeds and correctly continues the position sequence
        // past db1's now-committed row instead of reusing position 1.
        db1.prepare('COMMIT').run();
        const created = upsertMessage({ db: db2, conversationId: 'c1', m: { id: 'm2', role: 'user', content: 'from db2' } });
        expect(created).toMatchObject({ id: 'm2', content: 'from db2' });

        const rawPositions = db1
          .prepare(`SELECT id, position FROM messages WHERE conversation_id = ? ORDER BY position`)
          .all('c1') as { id: string; position: number }[];
        expect(rawPositions).toEqual([
          { id: 'm0', position: 0 },
          { id: 'm1', position: 1 },
          { id: 'm2', position: 2 },
        ]);
      } finally {
        db2.close();
      }
    });
  });
});

describe('projects CRUD', () => {
  it('inserts a project with all fields populated and reads it back', () => {
    const db = freshDb();
    const created = insertProject({ db, project: {
      id: 'p2',
      name: 'Widgets',
      pendingPrompt: 'draft something',
      metadata: { theme: 'dark' },
      customInstructions: 'be terse',
      createdAt: 1,
      updatedAt: 2,
    } });
    expect(created).toMatchObject({
      id: 'p2',
      name: 'Widgets',
      pendingPrompt: 'draft something',
      metadata: { theme: 'dark' },
      customInstructions: 'be terse',
      createdAt: 1,
      updatedAt: 2,
    });
    expect(getProject({ db, id: 'p2' })).toMatchObject({ id: 'p2', name: 'Widgets' });
    expect(getProject({ db, id: 'missing' })).toBeNull();
  });

  it('inserts a project with optional fields omitted, defaulting them to undefined', () => {
    const db = freshDb();
    const created = insertProject({ db, project: { id: 'p2', name: 'Bare', createdAt: 1, updatedAt: 1 } });
    expect(created).toMatchObject({
      id: 'p2',
      name: 'Bare',
      pendingPrompt: undefined,
      metadata: undefined,
      customInstructions: undefined,
    });
  });

  it('lists projects newest-updated first', () => {
    const db = freshDb(); // seeds 'p1' with updatedAt: 1
    insertProject({ db, project: { id: 'pa', name: 'A', createdAt: 1, updatedAt: 2 } });
    insertProject({ db, project: { id: 'pb', name: 'B', createdAt: 1, updatedAt: 5 } });
    expect(listProjects({ db }).map((p) => p.id)).toEqual(['pb', 'pa', 'p1']);
  });

  it('recovers from malformed metadata_json by treating it as absent', () => {
    const db = freshDb();
    insertProject({ db, project: { id: 'p2', name: 'X', createdAt: 1, updatedAt: 1 } });
    db.prepare(`UPDATE projects SET metadata_json = ? WHERE id = ?`).run('not-json', 'p2');
    expect(getProject({ db, id: 'p2' })!.metadata).toBeUndefined();
  });

  it('updates name/pendingPrompt/metadata/customInstructions, defaults updatedAt, and returns null for a missing id', () => {
    const db = freshDb();
    insertProject({ db, project: { id: 'p2', name: 'Old', createdAt: 1, updatedAt: 1 } });

    const updated = updateProject({ db, id: 'p2', patch: { name: 'New', pendingPrompt: 'go', metadata: { a: 1 }, customInstructions: 'terse', updatedAt: 99 } });
    expect(updated).toMatchObject({ name: 'New', pendingPrompt: 'go', metadata: { a: 1 }, customInstructions: 'terse', updatedAt: 99 });

    const before = Date.now();
    const again = updateProject({ db, id: 'p2', patch: { name: 'Newer' } });
    expect(again).toMatchObject({ name: 'Newer', pendingPrompt: 'go' });
    expect(again!.updatedAt).toBeGreaterThanOrEqual(before);

    expect(updateProject({ db, id: 'missing', patch: { name: 'X' } })).toBeNull();
  });

  it('updates a bare project (no pendingPrompt/metadata/customInstructions) with a patch that also omits them, persisting null for all three', () => {
    const db = freshDb();
    insertProject({ db, project: { id: 'p2', name: 'Bare', createdAt: 1, updatedAt: 1 } });
    const updated = updateProject({ db, id: 'p2', patch: { name: 'Still Bare' } });
    expect(updated).toMatchObject({
      name: 'Still Bare',
      pendingPrompt: undefined,
      metadata: undefined,
      customInstructions: undefined,
    });
  });

  it('deletes a project', () => {
    const db = freshDb();
    insertProject({ db, project: { id: 'p2', name: 'X', createdAt: 1, updatedAt: 1 } });
    deleteProject({ db, id: 'p2' });
    expect(getProject({ db, id: 'p2' })).toBeNull();
  });

  describe('run-status aggregation (latest/first, per-project/per-conversation/per-run)', () => {
    function seedRunMessage(db: SqliteDb, cid: string, m: { id: string; runId?: string; runStatus?: string; position: number; endedAt?: number; startedAt?: number; createdAt?: number }): void {
      db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, position, created_at, run_id, run_status, started_at, ended_at)
         VALUES (@id, @cid, 'assistant', '', @position, @createdAt, @runId, @runStatus, @startedAt, @endedAt)`,
      ).run({
        id: m.id,
        cid,
        position: m.position,
        createdAt: m.createdAt ?? m.position,
        runId: m.runId ?? null,
        runStatus: m.runStatus ?? null,
        startedAt: m.startedAt ?? null,
        endedAt: m.endedAt ?? null,
      });
    }

    it('collapses repeated runs per project/conversation/run to only the latest, ordered by recency', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      seedRunMessage(db, 'c1', { id: 'm0', runId: 'run-a', runStatus: 'starting', position: 0, endedAt: 100 });
      seedRunMessage(db, 'c1', { id: 'm1', runId: 'run-a', runStatus: 'succeeded', position: 1, endedAt: 200 });

      const byProject = listLatestProjectRunStatuses({ db });
      expect(byProject.get('p1')).toMatchObject({ value: 'succeeded', runId: 'run-a' });

      const byConversation = listLatestConversationRunStatuses({ db });
      expect(byConversation.get('c1')).toMatchObject({ value: 'succeeded' });

      const byRun = listLatestRunStatuses({ db });
      expect(byRun.get('run-a')).toMatchObject({ value: 'succeeded' });

      const firstByConversation = listFirstConversationRunStatuses({ db });
      expect(firstByConversation.get('c1')).toMatchObject({ value: 'running' }); // 'starting' normalizes to 'running'
    });

    it('reports runId: undefined for a run-status row with no run_id (the project/conversation queries have no run_id filter)', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      seedRunMessage(db, 'c1', { id: 'm0', runStatus: 'succeeded', position: 0, endedAt: 100 }); // no runId
      expect(listLatestProjectRunStatuses({ db }).get('p1')).toMatchObject({ value: 'succeeded', runId: undefined });
      expect(listLatestConversationRunStatuses({ db }).get('c1')).toMatchObject({ value: 'succeeded', runId: undefined });
    });

    it('normalizes a defensively-null runId to undefined in the per-run/first-turn queries (unreachable via real rows since both queries require run_id IS NOT NULL; exercised via a stubbed row)', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });

      const proxiedFirst = withStubbedStatement(
        db,
        (sql) => sql.includes('run_id IS NOT NULL') && sql.includes('conversationId'),
        { all: () => [{ conversationId: 'c1', runId: null, status: 'succeeded', updatedAt: 100, position: 0 }] },
      );
      expect(listFirstConversationRunStatuses({ db: proxiedFirst }).get('c1')).toMatchObject({ value: 'succeeded', runId: undefined });

      const proxiedLatestRun = withStubbedStatement(
        db,
        (sql) => sql.includes('run_id IS NOT NULL') && !sql.includes('conversationId'),
        { all: () => [{ runId: null, status: 'succeeded', updatedAt: 100, position: 0 }] },
      );
      const [onlyEntry] = [...listLatestRunStatuses({ db: proxiedLatestRun }).values()];
      expect(onlyEntry).toMatchObject({ value: 'succeeded', runId: undefined });
    });

    it('normalizes cancelled -> canceled and unknown statuses -> not_started', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      seedRunMessage(db, 'c1', { id: 'm0', runId: 'run-a', runStatus: 'cancelled', position: 0, endedAt: 100 });
      expect(listLatestRunStatuses({ db }).get('run-a')).toMatchObject({ value: 'canceled' });
    });

    it.each(['queued', 'running', 'succeeded', 'failed', 'canceled'])('passes the known status %s through unchanged', (status) => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      seedRunMessage(db, 'c1', { id: 'm0', runId: 'run-a', runStatus: status, position: 0, endedAt: 100 });
      expect(listLatestRunStatuses({ db }).get('run-a')).toMatchObject({ value: status });
    });

    it('defaults an unrecognized status to not_started', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      seedRunMessage(db, 'c1', { id: 'm0', runId: 'run-a', runStatus: 'some-future-status', position: 0, endedAt: 100 });
      expect(listLatestRunStatuses({ db }).get('run-a')).toMatchObject({ value: 'not_started' });
    });

    it('returns empty maps when no message carries a run_status', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      seedRunMessage(db, 'c1', { id: 'm0', position: 0 });
      expect(listLatestProjectRunStatuses({ db }).size).toBe(0);
      expect(listLatestConversationRunStatuses({ db }).size).toBe(0);
      expect(listFirstConversationRunStatuses({ db }).size).toBe(0);
      expect(listLatestRunStatuses({ db }).size).toBe(0);
    });
  });

  describe('awaiting-input detection', () => {
    it('flags a project/conversation whose latest assistant turn asked a question-form and has no user reply yet', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'assistant', content: 'Please fill out <question-form>...</question-form>', createdAt: 10 } });

      expect(listProjectsAwaitingInput({ db })).toEqual(new Set(['p1']));
      expect(listConversationsAwaitingInput({ db })).toEqual(new Set(['c1']));
    });

    it('recognizes the <ask-question> alias tag', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'assistant', content: '<ask-question>Which one?</ask-question>', createdAt: 10 } });
      expect(listConversationsAwaitingInput({ db })).toEqual(new Set(['c1']));
    });

    it('clears once the user replies after the question', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'assistant', content: '<question-form/>', createdAt: 10 } });
      upsertMessage({ db, conversationId: 'c1', m: { id: 'm2', role: 'user', content: 'here is my answer', createdAt: 20 } });
      expect(listProjectsAwaitingInput({ db })).toEqual(new Set());
      expect(listConversationsAwaitingInput({ db })).toEqual(new Set());
    });

    it('does not flag ordinary assistant messages with no question artifact', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      upsertMessage({ db, conversationId: 'c1', m: { id: 'm1', role: 'assistant', content: 'just chatting', createdAt: 10 } });
      expect(listProjectsAwaitingInput({ db })).toEqual(new Set());
      expect(listConversationsAwaitingInput({ db })).toEqual(new Set());
    });
  });
});

describe('agent-sessions CRUD', () => {
  it('returns null/not-found shapes when no session exists yet', () => {
    const db = freshDb();
    expect(getAgentSession({ db, conversationId: 'c1', agentId: 'a1' })).toBeNull();
    expect(getAgentSessionRecord({ db, conversationId: 'c1', agentId: 'a1' })).toBeNull();
  });

  it('creates a session with all optional fields populated and reads it back both ways', () => {
    const db = freshDb();
    insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
    upsertAgentSession({ db, input: {
      conversationId: 'c1',
      agentId: 'a1',
      sessionId: 's1',
      stablePromptHash: 'hash1',
      model: 'gpt',
      cwd: '/work',
      lastMessageId: 'm1',
    } });
    expect(getAgentSession({ db, conversationId: 'c1', agentId: 'a1' })).toBe('s1');
    expect(getAgentSessionRecord({ db, conversationId: 'c1', agentId: 'a1' })).toEqual({
      sessionId: 's1',
      stablePromptHash: 'hash1',
      model: 'gpt',
      cwd: '/work',
      lastMessageId: 'm1',
    });
  });

  it('creates a session with optional fields omitted, defaulting them to null', () => {
    const db = freshDb();
    insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
    upsertAgentSession({ db, input: { conversationId: 'c1', agentId: 'a1', sessionId: 's1' } });
    expect(getAgentSessionRecord({ db, conversationId: 'c1', agentId: 'a1' })).toEqual({
      sessionId: 's1',
      stablePromptHash: null,
      model: null,
      cwd: null,
      lastMessageId: null,
    });
  });

  it('upserts (replaces) the session for the same (conversation, agent) pair on conflict', () => {
    const db = freshDb();
    insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
    upsertAgentSession({ db, input: { conversationId: 'c1', agentId: 'a1', sessionId: 's1', model: 'gpt' } });
    upsertAgentSession({ db, input: { conversationId: 'c1', agentId: 'a1', sessionId: 's2', model: 'claude' } });
    expect(getAgentSession({ db, conversationId: 'c1', agentId: 'a1' })).toBe('s2');
    expect(getAgentSessionRecord({ db, conversationId: 'c1', agentId: 'a1' })?.model).toBe('claude');
  });

  it('updates only the stable prompt hash, leaving other fields untouched', () => {
    const db = freshDb();
    insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
    upsertAgentSession({ db, input: { conversationId: 'c1', agentId: 'a1', sessionId: 's1', model: 'gpt', cwd: '/work' } });
    updateAgentSessionStableHash({ db, conversationId: 'c1', agentId: 'a1', stablePromptHash: 'hash2' });
    expect(getAgentSessionRecord({ db, conversationId: 'c1', agentId: 'a1' })).toMatchObject({ sessionId: 's1', model: 'gpt', cwd: '/work', stablePromptHash: 'hash2' });
  });

  it('clears a session, forcing the next lookup to miss', () => {
    const db = freshDb();
    insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
    upsertAgentSession({ db, input: { conversationId: 'c1', agentId: 'a1', sessionId: 's1' } });
    clearAgentSession({ db, conversationId: 'c1', agentId: 'a1' });
    expect(getAgentSession({ db, conversationId: 'c1', agentId: 'a1' })).toBeNull();
  });

  describe('latestCompletedAssistantMessageId (resume identity guard cursor)', () => {
    function seedAssistant(db: SqliteDb, cid: string, id: string, position: number, runStatus: string | null): void {
      db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, position, created_at, run_status)
         VALUES (?, ?, 'assistant', '', ?, ?, ?)`,
      ).run(id, cid, position, position, runStatus);
    }

    it('returns null when there is no prior completed assistant turn', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      expect(latestCompletedAssistantMessageId({ db, conversationId: 'c1', excludeMessageId: 'in-flight' })).toBeNull();
    });

    it('finds the latest succeeded turn, excluding the current in-flight placeholder', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      seedAssistant(db, 'c1', 'm1', 0, 'succeeded');
      seedAssistant(db, 'c1', 'm2', 1, null); // in-flight placeholder
      expect(latestCompletedAssistantMessageId({ db, conversationId: 'c1', excludeMessageId: 'm2' })).toBe('m1');
    });

    it('excludes a failed/canceled turn unless it matches resumableMessageId', () => {
      const db = freshDb();
      insertConversation({ db, c: { id: 'c1', projectId: 'p1', createdAt: 1, updatedAt: 1 } });
      seedAssistant(db, 'c1', 'm1', 0, 'succeeded');
      seedAssistant(db, 'c1', 'm2', 1, 'failed');

      // a different later failed turn stays excluded -> falls back to the last succeeded one
      expect(latestCompletedAssistantMessageId({ db, conversationId: 'c1', excludeMessageId: 'm3' }, { resumableMessageId: null })).toBe('m1');

      // the failed turn's own id, passed as resumableMessageId, is admitted through the filter
      expect(latestCompletedAssistantMessageId({ db, conversationId: 'c1', excludeMessageId: 'm3' }, { resumableMessageId: 'm2' })).toBe('m2');
    });
  });
});

describe('core helpers', () => {
  it('parseJsonOrUndef parses valid JSON and swallows everything else', () => {
    expect(parseJsonOrUndef('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonOrUndef('[1,2]')).toEqual([1, 2]);
    expect(parseJsonOrUndef('not json')).toBeUndefined();
    expect(parseJsonOrUndef('')).toBeUndefined();
    expect(parseJsonOrUndef(null)).toBeUndefined();
    expect(parseJsonOrUndef(42)).toBeUndefined();
  });

  it('row narrows a get() result to DbRow | null', () => {
    expect(row({ a: 1 })).toEqual({ a: 1 });
    expect(row(null)).toBeNull();
    expect(row('x')).toBeNull();
    expect(row(0)).toBeNull();
  });

  it('rows maps an all() result, replacing non-objects with {}', () => {
    expect(rows([{ a: 1 }, null, 'x'])).toEqual([{ a: 1 }, {}, {}]);
    expect(rows([])).toEqual([]);
  });
});
