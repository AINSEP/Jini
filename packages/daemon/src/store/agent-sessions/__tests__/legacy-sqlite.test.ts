/** The legacy raw-SQLite agent-session helpers, exercised against a real in-memory SQLite database. */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDb } from '@jini-ai/db/sqlite';
import {
  LEGACY_AGENT_SESSIONS_DDL,
  clearAgentSession,
  getAgentSession,
  getAgentSessionRecord,
  latestCompletedAssistantMessageId,
  updateAgentSessionStableHash,
  upsertAgentSession,
} from '../sqlite.js';

const MESSAGES_DDL = `CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
  run_status TEXT, position INTEGER NOT NULL)`;

let raw: Database.Database;
let db: SqliteDb;
beforeEach(() => {
  raw = new Database(':memory:');
  // The legacy table references the host's conversations table; a minimal one satisfies the FK.
  raw.exec("CREATE TABLE conversations (id TEXT PRIMARY KEY); INSERT INTO conversations (id) VALUES ('c1'), ('c2');");
  raw.exec(LEGACY_AGENT_SESSIONS_DDL);
  raw.exec(MESSAGES_DDL);
  db = raw as unknown as SqliteDb;
});
afterEach(() => { raw.close(); });

const key = { conversationId: 'c1', agentId: 'a1' };
const updatedAt = () => (raw.prepare('SELECT updated_at FROM agent_sessions WHERE conversation_id = ? AND agent_id = ?').get('c1', 'a1') as { updated_at: number }).updated_at;

describe('legacy agent-session helpers', () => {
  it('reads nothing for an unknown (conversation, agent) pair', () => {
    expect(getAgentSession({ db, ...key })).toBeNull();
    expect(getAgentSessionRecord({ db, ...key })).toBeNull();
  });

  it('upserts every identity field, stamping updated_at from the injected clock, and replaces on conflict', () => {
    upsertAgentSession({ db, input: { ...key, sessionId: 's1', stablePromptHash: 'h1', model: 'm1', cwd: '/w', lastMessageId: 'msg-1' } }, { nowMs: () => 1_000 });
    expect(getAgentSession({ db, ...key })).toBe('s1');
    expect(getAgentSessionRecord({ db, ...key })).toEqual({ sessionId: 's1', stablePromptHash: 'h1', model: 'm1', cwd: '/w', lastMessageId: 'msg-1' });
    expect(updatedAt()).toBe(1_000);

    upsertAgentSession({ db, input: { ...key, sessionId: 's2' } }, { nowMs: () => 2_000 });
    expect(getAgentSessionRecord({ db, ...key })).toEqual({ sessionId: 's2', stablePromptHash: null, model: null, cwd: null, lastMessageId: null });
    expect(updatedAt()).toBe(2_000);
  });

  it('defaults updated_at to wall time when no clock is injected', () => {
    const before = Date.now();
    upsertAgentSession({ db, input: { ...key, sessionId: 's1' } });
    expect(updatedAt()).toBeGreaterThanOrEqual(before);
    updateAgentSessionStableHash({ db, ...key, stablePromptHash: 'h' });
    expect(updatedAt()).toBeGreaterThanOrEqual(before);
  });

  it('updates only the stable prompt hash (and updated_at) of an existing session', () => {
    upsertAgentSession({ db, input: { ...key, sessionId: 's1', model: 'm1', cwd: '/w' } }, { nowMs: () => 1 });
    updateAgentSessionStableHash({ db, ...key, stablePromptHash: 'h2' }, { nowMs: () => 5 });
    expect(getAgentSessionRecord({ db, ...key })).toEqual({ sessionId: 's1', stablePromptHash: 'h2', model: 'm1', cwd: '/w', lastMessageId: null });
    expect(updatedAt()).toBe(5);
  });

  it('clears one pair without touching another agent in the same conversation', () => {
    upsertAgentSession({ db, input: { ...key, sessionId: 's1' } });
    upsertAgentSession({ db, input: { conversationId: 'c1', agentId: 'a2', sessionId: 's2' } });
    clearAgentSession({ db, ...key });
    expect(getAgentSession({ db, ...key })).toBeNull();
    expect(getAgentSession({ db, conversationId: 'c1', agentId: 'a2' })).toBe('s2');
  });

  it('finds the latest succeeded assistant turn, excluding the in-flight message and admitting only the named resumable failure', () => {
    const insert = raw.prepare('INSERT INTO messages (id, conversation_id, role, run_status, position) VALUES (?, ?, ?, ?, ?)');
    expect(latestCompletedAssistantMessageId({ db, conversationId: 'c1', excludeMessageId: 'none' })).toBeNull();
    insert.run('m1', 'c1', 'assistant', 'succeeded', 1);
    insert.run('u1', 'c1', 'user', 'succeeded', 2);
    insert.run('m2', 'c1', 'assistant', 'failed', 3);
    insert.run('m3', 'c1', 'assistant', null, 4);
    insert.run('o1', 'c2', 'assistant', 'succeeded', 5);

    expect(latestCompletedAssistantMessageId({ db, conversationId: 'c1', excludeMessageId: 'm3' })).toBe('m1');
    expect(latestCompletedAssistantMessageId({ db, conversationId: 'c1', excludeMessageId: 'm3' }, { resumableMessageId: 'm2' })).toBe('m2');
    expect(latestCompletedAssistantMessageId({ db, conversationId: 'c1', excludeMessageId: 'm1' })).toBeNull();
  });

  it('treats a row whose columns are not strings as absent rather than trusting the type', () => {
    raw.exec('DROP TABLE agent_sessions');
    raw.exec(`CREATE TABLE agent_sessions (conversation_id TEXT, agent_id TEXT, session_id, stable_prompt_hash, model, cwd,
      last_message_id, updated_at INTEGER, PRIMARY KEY (conversation_id, agent_id))`);
    raw.prepare('INSERT INTO agent_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('c1', 'a1', 42, 1, 2, 3, 4, 0);
    expect(getAgentSession({ db, ...key })).toBeNull();
    expect(getAgentSessionRecord({ db, ...key })).toBeNull();
    raw.prepare('UPDATE agent_sessions SET session_id = ?').run('s1');
    expect(getAgentSessionRecord({ db, ...key })).toEqual({ sessionId: 's1', stablePromptHash: null, model: null, cwd: null, lastMessageId: null });
    raw.exec('DROP TABLE messages');
    raw.exec('CREATE TABLE messages (id, conversation_id TEXT, role TEXT, run_status TEXT, position INTEGER)');
    raw.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)').run(7, 'c1', 'assistant', 'succeeded', 1);
    expect(latestCompletedAssistantMessageId({ db, conversationId: 'c1', excludeMessageId: 'x' })).toBeNull();
  });
});
