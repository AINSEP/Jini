import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { LEGACY_CHAT_DDL, insertConversation, upsertMessage, listMessages } from '../index.js';
it('legacy direct client inserts and updates store sanitized text with safe receipts', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY);INSERT INTO projects VALUES ('p');" + LEGACY_CHAT_DDL);
    insertConversation({ db, c: { id: 'c', projectId: 'p', createdAt: 1, updatedAt: 1 } });
    const signals: unknown[] = [];
    const saved = upsertMessage({ db, conversationId: 'c', m: { id: 'm', role: 'user', content: 'save api_key=x' } }, { onSecretRedacted: signal => signals.push(signal) });
    expect(saved?.content).toBe('save api_key=[token removed]');
    expect(saved?.secretRedaction).toEqual({ secretRedacted: true, count: 1 });
    upsertMessage({ db, conversationId: 'c', m: { id: 'm', role: 'user', content: 'Bearer x' } });
    expect(db.prepare('SELECT content FROM messages').get()).toEqual({ content: 'Bearer [token removed]' });
    expect(listMessages({ db, conversationId: 'c' })[0]?.content).toBe('Bearer [token removed]');
    expect(signals).toEqual([{ secretRedacted: true, count: 1 }]);
  } finally { db.close(); }
});
