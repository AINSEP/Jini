/** Synchronous admission callers need the same WAL-safe copy operation as kernel storage ops. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'vitest';
import * as sqlite from '../kernel/sqlite/index.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

test('a synchronous snapshot includes committed WAL rows, isolates writes and refuses overwrite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-copy-sync-'));
  const file = path.join(root, 'source.db'), targetPath = path.join(root, "copy's.db");
  const writer = new DatabaseSync(file);
  try {
    writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE posts(title TEXT); INSERT INTO posts VALUES ('latest')");
    const bytes = fs.readFileSync(file);
    const source = new DatabaseSync(file, { readOnly: true });
    try {
      sqlite.copySqliteInto({ source, targetPath });
      const copy = new DatabaseSync(targetPath);
      try {
        assert.deepEqual(copy.prepare('SELECT title FROM posts').all().map(row => row.title), ['latest']);
        copy.exec("INSERT INTO posts VALUES ('copy only')");
        assert.equal(writer.prepare('SELECT count(*) AS n FROM posts').get()!.n, 1);
        assert.throws(() => sqlite.copySqliteInto({ source, targetPath }), /already exists/);
        assert.equal(copy.prepare('SELECT count(*) AS n FROM posts').get()!.n, 2);
      } finally { copy.close(); }
      assert.deepEqual(fs.readFileSync(file), bytes);
    } finally { source.close(); }
  } finally { writer.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
