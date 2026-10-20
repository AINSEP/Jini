/** Boundary tests for the legacy sync message store (upsert, telemetry latch, event appends, redaction). */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RedactUserText, SecretRedactionSignal } from '../../../../core/user-text-redaction.js';
import { insertConversation } from '../conversations.js';
import {
  MessageConversationMismatchError,
  appendMessageAgentEvent,
  appendMessageStatusEvent,
  deleteMessage,
  getMessageTelemetryFinalizationState,
  listMessages,
  upsertMessage,
} from '../messages.js';
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
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY);INSERT INTO projects VALUES ('p');${LEGACY_CHAT_DDL}`);
  for (const id of ['c', 'd']) insertConversation({ db, c: { id, projectId: 'p', createdAt: 1, updatedAt: 1 } });
  return db;
}

/** A better-sqlite3 handle whose statements refuse `undefined` bindings, as stricter SqliteDb drivers do. */
function strictBindingDatabase(): Db {
  const db = new Database(':memory:');
  const prepare = db.prepare.bind(db);
  function strictPrepare<P extends unknown[] | object = unknown[], R = unknown>(source: string) {
    const statement = prepare<P, R>(source);
    refuseUndefinedBindings(statement, source);
    return statement;
  }
  db.prepare = strictPrepare;
  return db;
}

function refuseUndefinedBindings(statement: { run(...params: unknown[]): Database.RunResult }, source: string): void {
  const run = statement.run.bind(statement);
  statement.run = (...params: unknown[]) => {
    if (params.includes(undefined)) throw new TypeError(`undefined binding in: ${source}`);
    return run(...params);
  };
}

function rawRow(db: Db, id: string) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown>;
}

describe('upsertMessage insert path', () => {
  it('appends positions, stamps now, stringifies JSON fields and bumps the conversation', () => {
    const db = freshDb();
    vi.spyOn(Date, 'now').mockReturnValue(500);
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: 'x' } });
    const saved = upsertMessage({
      db,
      conversationId: 'c',
      m: {
        id: 'b', role: 'assistant', content: 'y', agentId: 'ag', agentName: 'Agent', runId: 'r', runStatus: 'running',
        lastRunEventId: 'e1', events: [{ kind: 'text' }], attachments: [{ name: 'f' }], sessionMode: 'plan',
        runContext: { k: 1 }, createdAt: 42, startedAt: 3, endedAt: 4,
      },
    });
    expect(saved).toEqual({
      id: 'b', role: 'assistant', content: 'y', agentId: 'ag', agentName: 'Agent', runId: 'r', runStatus: 'running',
      lastRunEventId: 'e1', events: [{ kind: 'text' }], attachments: [{ name: 'f' }], sessionMode: 'plan',
      runContext: { k: 1 }, createdAt: 42, startedAt: 3, endedAt: 4,
    });
    expect(rawRow(db, 'a')).toMatchObject({ position: 0, created_at: 500, telemetry_finalized_at: null, events_json: null, session_mode: null });
    expect(rawRow(db, 'b')).toMatchObject({ position: 1 });
    expect(db.prepare("SELECT updated_at AS u FROM conversations WHERE id = 'c'").get()).toEqual({ u: 500 });
  });

  it('falls back to now for a non-finite createdAt and latches telemetry when finalized on insert', () => {
    const db = freshDb();
    vi.spyOn(Date, 'now').mockReturnValue(900);
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '', createdAt: Number.NaN, telemetryFinalized: true } });
    expect(rawRow(db, 'a')).toMatchObject({ created_at: 900, telemetry_finalized_at: 900 });
  });

  it('binds absent optional fields as explicit null, never undefined, for strict drivers', () => {
    const strict = strictBindingDatabase();
    open.push(strict);
    strict.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY);INSERT INTO projects VALUES ('p');${LEGACY_CHAT_DDL}`);
    insertConversation({ db: strict, c: { id: 'c', projectId: 'p', createdAt: 1, updatedAt: 1 } });
    upsertMessage({ db: strict, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '' } });
    expect(upsertMessage({ db: strict, conversationId: 'c', m: { id: 'a', role: 'assistant', content: 'u' } })?.content).toBe('u');
  });

  it('stores falsy JSON sub-fields as null rather than their JSON text', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '', events: null, attachments: 0, runContext: '' } });
    expect(rawRow(db, 'a')).toMatchObject({ events_json: null, attachments_json: null, run_context_json: null });
  });

  it('starts at position 0 when the position-max query returns no row', () => {
    const db = freshDb();
    const prepare = db.prepare.bind(db);
    function noMaxRowPrepare<P extends unknown[] | object = unknown[], R = unknown>(source: string) {
      const statement = prepare<P, R>(source);
      if (source.includes('COALESCE(MAX(position)')) statement.get = () => undefined;
      return statement;
    }
    db.prepare = noMaxRowPrepare;
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'user', content: '1' } });
    upsertMessage({ db, conversationId: 'c', m: { id: 'b', role: 'user', content: '2' } });
    expect(rawRow(db, 'b')).toMatchObject({ position: 0 });
  });

  it('positions are per conversation', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'user', content: '1' } });
    upsertMessage({ db, conversationId: 'd', m: { id: 'b', role: 'user', content: '2' } });
    expect(rawRow(db, 'b')).toMatchObject({ position: 0 });
  });

  it('stores an unknown session mode as null and reads it back as undefined', () => {
    const db = freshDb();
    expect(upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '', sessionMode: 'odd' } })?.sessionMode).toBeUndefined();
    expect(rawRow(db, 'a')).toMatchObject({ session_mode: null });
  });

  it('returns null when the row is gone by the time it is re-read', () => {
    const db = freshDb();
    db.exec('CREATE TRIGGER vanish AFTER INSERT ON messages BEGIN DELETE FROM messages WHERE id = NEW.id; END;');
    expect(upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'user', content: 'api_key=x' } })).toBeNull();
  });
});

describe('upsertMessage update path', () => {
  it('overwrites the row in place, keeping its position and createdAt', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: 'old', createdAt: 5, events: [{ kind: 'x' }] } });
    const saved = upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: 'new', runStatus: 'succeeded', createdAt: 99 } });
    expect(saved).toMatchObject({ content: 'new', runStatus: 'succeeded', createdAt: 5, events: undefined });
    expect(rawRow(db, 'a')).toMatchObject({ position: 0 });
  });

  it('sets telemetry_finalized_at once and never moves it afterwards', () => {
    const db = freshDb();
    const now = vi.spyOn(Date, 'now').mockReturnValue(10);
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '' } });
    now.mockReturnValue(20);
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '', telemetryFinalized: true } });
    now.mockReturnValue(30);
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '', telemetryFinalized: true } });
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '' } });
    expect(getMessageTelemetryFinalizationState({ db, messageId: 'a' })).toEqual({ exists: true, finalizedAt: 20 });
  });

  it('throws MessageConversationMismatchError naming both conversations when the id belongs elsewhere', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'user', content: 'mine' } });
    let thrown: unknown;
    try {
      upsertMessage({ db, conversationId: 'd', m: { id: 'a', role: 'user', content: 'theirs' } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MessageConversationMismatchError);
    expect(thrown).toMatchObject({
      name: 'MessageConversationMismatchError',
      messageId: 'a',
      actualConversationId: 'c',
      requestedConversationId: 'd',
      message: 'upsertMessage: message id "a" belongs to a different conversation ("c"), not "d"',
    });
    expect(rawRow(db, 'a')).toMatchObject({ content: 'mine', conversation_id: 'c' });
  });
});

describe('upsertMessage redaction', () => {
  it('does not redact assistant content', () => {
    const db = freshDb();
    expect(upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: 'api_key=x' } })?.content).toBe('api_key=x');
  });

  it('skips redaction when user content is not a string', () => {
    const db = freshDb();
    const redact = vi.fn<RedactUserText>();
    expect(upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'user', content: 7 } }, { redactUserText: redact })?.content).toBe('7.0');
    expect(redact).not.toHaveBeenCalled();
  });

  it('stores a custom redactor text without a receipt when it reports no secret', () => {
    const db = freshDb();
    const signals: SecretRedactionSignal[] = [];
    const redact: RedactUserText = ({ text }) => ({ text: text.toUpperCase(), secretRedacted: false, count: 0 });
    const saved = upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'user', content: 'hi' } }, { redactUserText: redact, onSecretRedacted: (s) => signals.push(s) });
    expect(saved?.content).toBe('HI');
    expect(saved).not.toHaveProperty('secretRedaction');
    expect(signals).toEqual([]);
  });

  it('attaches a receipt from a custom redactor without requiring a callback', () => {
    const db = freshDb();
    const redact: RedactUserText = () => ({ text: '[gone]', secretRedacted: true, count: 2 });
    expect(upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'user', content: 'k' } }, { redactUserText: redact })).toMatchObject({
      content: '[gone]', secretRedaction: { secretRedacted: true, count: 2 },
    });
  });
});

describe('listMessages', () => {
  it('returns one conversation in position order with nulls as undefined', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'user', content: '1', sessionMode: 'chat' } });
    upsertMessage({ db, conversationId: 'd', m: { id: 'x', role: 'user', content: 'other' } });
    upsertMessage({ db, conversationId: 'c', m: { id: 'b', role: 'assistant', content: '2', sessionMode: 'design' } });
    const messages = listMessages({ db, conversationId: 'c' });
    expect(messages.map((m) => [m.id, m.sessionMode])).toEqual([['a', 'chat'], ['b', 'design']]);
    expect(messages[0]).toMatchObject({ agentId: undefined, agentName: undefined, runId: undefined, runStatus: undefined, lastRunEventId: undefined, startedAt: undefined, endedAt: undefined, runContext: undefined });
  });
});

describe('listMessages on a host table with nullable created_at', () => {
  it('reads a null created_at as undefined', () => {
    const db = new Database(':memory:');
    open.push(db);
    const ddl = LEGACY_CHAT_DDL.replace(/created_at INTEGER NOT NULL,(\s+FOREIGN KEY\(conversation_id\))/, 'created_at INTEGER,$1');
    expect(ddl).not.toBe(LEGACY_CHAT_DDL);
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY);INSERT INTO projects VALUES ('p');${ddl}INSERT INTO conversations VALUES ('c', 'p', NULL, 'design', 1, 1);`);
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, position) VALUES ('a', 'c', 'user', 'x', 0)").run();
    expect(listMessages({ db, conversationId: 'c' })[0]?.createdAt).toBeUndefined();
  });
});

describe('getMessageTelemetryFinalizationState', () => {
  it('reports a missing message', () => {
    expect(getMessageTelemetryFinalizationState({ db: freshDb(), messageId: 'nope' })).toEqual({ exists: false, finalizedAt: null });
  });

  it('reports null for a non-numeric stored value', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'user', content: '' } });
    db.prepare("UPDATE messages SET telemetry_finalized_at = 'soon' WHERE id = 'a'").run();
    expect(getMessageTelemetryFinalizationState({ db, messageId: 'a' })).toEqual({ exists: true, finalizedAt: null });
  });
});

describe('appendMessageStatusEvent', () => {
  it('returns null for an empty, whitespace or non-string label', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '' } });
    expect(appendMessageStatusEvent({ db, messageId: 'a', event: { label: '   ' } })).toBeNull();
    expect(appendMessageStatusEvent({ db, messageId: 'a', event: { label: 5 } })).toBeNull();
    expect(appendMessageStatusEvent({ db, messageId: 'a', event: JSON.parse('null') })).toBeNull();
  });

  it('returns null for an unknown message', () => {
    expect(appendMessageStatusEvent({ db: freshDb(), messageId: 'nope', event: { label: 'x' } })).toBeNull();
  });

  it('trims, appends after existing events, and dedupes the same label+detail', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '', events: [{ kind: 'text' }] } });
    expect(appendMessageStatusEvent({ db, messageId: 'a', event: { label: ' Run ', detail: ' s1 ' } })).toEqual([{ kind: 'text' }, { kind: 'status', label: 'Run', detail: 's1' }]);
    expect(appendMessageStatusEvent({ db, messageId: 'a', event: { label: 'Run', detail: 's1' } })).toHaveLength(2);
    expect(appendMessageStatusEvent({ db, messageId: 'a', event: { label: 'Run', detail: 5 } })).toEqual([{ kind: 'text' }, { kind: 'status', label: 'Run', detail: 's1' }, { kind: 'status', label: 'Run' }]);
    expect(appendMessageStatusEvent({ db, messageId: 'a', event: { label: 'Run' } })).toHaveLength(3);
    expect(listMessages({ db, conversationId: 'c' })[0]?.events).toHaveLength(3);
  });

  it('does not dedupe against a different label or a non-status event', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '', events: [{ kind: 'text', label: 'Run' }] } });
    expect(appendMessageStatusEvent({ db, messageId: 'a', event: { label: 'Run' } })).toHaveLength(2);
    expect(appendMessageStatusEvent({ db, messageId: 'a', event: { label: 'Walk' } })).toHaveLength(3);
  });

  it('starts a fresh list when stored events are not an array', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '', events: { kind: 'x' } } });
    expect(appendMessageStatusEvent({ db, messageId: 'a', event: { label: 'L' } })).toEqual([{ kind: 'status', label: 'L' }]);
  });
});

describe('appendMessageAgentEvent', () => {
  it('returns null for a non-object event, a missing kind, or an unknown message', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '' } });
    expect(appendMessageAgentEvent({ db, messageId: 'a', event: JSON.parse('"text"') })).toBeNull();
    expect(appendMessageAgentEvent({ db, messageId: 'a', event: { kind: 3 } })).toBeNull();
    expect(appendMessageAgentEvent({ db, messageId: 'a', event: Object.assign(() => undefined, { kind: 'text' }) })).toBeNull();
    expect(appendMessageAgentEvent({ db, messageId: 'nope', event: { kind: 'text', text: 'x' } })).toBeNull();
  });

  it('streams text deltas into content and appends non-text events without touching content', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: 'He', events: 'not-array' } });
    appendMessageAgentEvent({ db, messageId: 'a', event: { kind: 'text', text: 'l' } });
    appendMessageAgentEvent({ db, messageId: 'a', event: { kind: 'text', text: 7 } });
    const events = appendMessageAgentEvent({ db, messageId: 'a', event: { kind: 'tool', text: 'ignored' } });
    expect(events).toEqual([{ kind: 'text', text: 'l' }, { kind: 'text', text: 7 }, { kind: 'tool', text: 'ignored' }]);
    expect(rawRow(db, 'a')).toMatchObject({ content: 'Hel' });
  });

  it('dedupes a byte-identical consecutive event', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'assistant', content: '' } });
    appendMessageAgentEvent({ db, messageId: 'a', event: { kind: 'text', text: 'x' } });
    expect(appendMessageAgentEvent({ db, messageId: 'a', event: { kind: 'text', text: 'x' } })).toEqual([{ kind: 'text', text: 'x' }]);
    expect(rawRow(db, 'a')).toMatchObject({ content: 'x' });
  });
});

describe('deleteMessage', () => {
  it('removes only the named message', () => {
    const db = freshDb();
    upsertMessage({ db, conversationId: 'c', m: { id: 'a', role: 'user', content: '1' } });
    upsertMessage({ db, conversationId: 'c', m: { id: 'b', role: 'user', content: '2' } });
    deleteMessage({ db, id: 'a' });
    expect(listMessages({ db, conversationId: 'c' }).map((m) => m.id)).toEqual(['b']);
  });
});
