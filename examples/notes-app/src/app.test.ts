/**
 * @file The notes app's contact form over a real socket and a temp SQLite file: the per-client
 * limit and the stored `source_ip` both come from the socket peer, not from a request header.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openAppDatabase } from './db.ts';
import { createNodeServer, type NodeServer } from './node-server.ts';
import { registerNotesApp } from './app.ts';

describe('contact form client address', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-app-test-'));
  const filePath = join(dir, 'notes.db');
  let app: NodeServer;
  let closeDb: () => void = () => {};
  let base = '';

  before(async () => {
    const database = await openAppDatabase({ filePath });
    closeDb = database.close;
    app = createNodeServer();
    await registerNotesApp({ app, kernel: database.kernel });
    base = `http://127.0.0.1:${(await app.listen({ port: 0 })).port}`;
  });
  after(async () => {
    await app.close();
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keys the form limit on the socket peer, so a spoofed x-forwarded-for cannot reset it', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 31; index += 1) {
      const response = await fetch(`${base}/forms/contact`, {
        method: 'POST',
        headers: { 'x-forwarded-for': `198.51.100.${index}` },
        body: new URLSearchParams({ name: 'Ada', email: 'ada@example.com', message: `message ${index}` }),
      });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses.slice(0, 30), Array(30).fill(202));
    assert.equal(statuses[30], 429);
  });

  it('stores the socket peer as source_ip', () => {
    const db = new Database(filePath, { readonly: true });
    try {
      const rows = db.prepare('SELECT DISTINCT source_ip AS ip FROM form_submissions').all() as { ip: string | null }[];
      assert.deepEqual(rows.map((row) => row.ip), ['127.0.0.1']);
    } finally {
      db.close();
    }
  });
});
