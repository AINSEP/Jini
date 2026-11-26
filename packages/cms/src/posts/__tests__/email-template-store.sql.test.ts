import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { test } from 'vitest';
import type { PostRepoPort } from '../post.js';
import type { PagesHtmlDocumentStoreFactory } from '@jini-ai/core/contracts/site/page-html-store';
import { emailTemplateStore } from '../email-template-store.js';

class TemplateNotFound extends Error {}

test('HTML conversion failure rolls back the draft save in its SQL transaction', async () => {
  const db = new Database(':memory:'); db.exec('CREATE TABLE drafts (id TEXT PRIMARY KEY, row_json TEXT)');
  const conversionFailure = new Error('conversion failed');
  const postRepo = { save: async (row: { id: string }) => { db.prepare('INSERT INTO drafts VALUES (?, ?)').run(row.id, JSON.stringify(row)); },
    transaction: async <T>({ fn }: { fn: () => Promise<T> }): Promise<T> => {
      db.exec('BEGIN'); try { const result = await fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  } as unknown as PostRepoPort;
  const pagesHtmlStore = (() => ({ ensureHtmlFormat: async () => {
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM drafts').get() as { count: number }).count, 1);
    throw conversionFailure;
  } })) as unknown as PagesHtmlDocumentStoreFactory;
  try {
    const store = emailTemplateStore({ deps: { workspaceId: 'ws', postRepo, pagesHtmlStore, clock: { nowMs: () => 0 }, idGen: { newId: () => 'template' }, EmailTemplateNotFoundError: TemplateNotFound } });
    await assert.rejects(store.create({ name: 'Welcome', seedHtml: '<p>Hello</p>', actorId: 'owner' }), error => error === conversionFailure);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM drafts').get() as { count: number }).count, 0);
  } finally { db.close(); }
});
