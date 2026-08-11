import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { beforeEach, describe, expect, it } from 'vitest';

import { findOneBy } from '../find-one-by.js';

const widgets = sqliteTable('widgets', {
  id: integer('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  slug: text('slug').notNull(),
});

const schema = { widgets };

function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE widgets (id integer PRIMARY KEY, workspace_id text NOT NULL, slug text NOT NULL)');
  return drizzle(sqlite, { schema });
}

describe('findOneBy', () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    db.insert(widgets).values({ id: 1, workspaceId: 'w1', slug: 'alpha' }).run();
    db.insert(widgets).values({ id: 2, workspaceId: 'w2', slug: 'alpha' }).run();
  });

  it('returns the mapped record when a row matches every condition', () => {
    const found = findOneBy(
      db,
      widgets,
      [eq(widgets.workspaceId, 'w1'), eq(widgets.slug, 'alpha')],
      (row) => ({ id: row.id, slug: row.slug }),
    );
    expect(found).toEqual({ id: 1, slug: 'alpha' });
  });

  it('scopes by every condition, not just the first — the whole point of the helper', () => {
    const found = findOneBy(db, widgets, [eq(widgets.workspaceId, 'w2'), eq(widgets.slug, 'alpha')], (row) => row.id);
    expect(found).toBe(2);
  });

  it('returns null rather than throwing when nothing matches', () => {
    const found = findOneBy(db, widgets, [eq(widgets.slug, 'missing')], (row) => row.id);
    expect(found).toBeNull();
  });

  it('does not call the mapper when there is no row', () => {
    let calls = 0;
    findOneBy(db, widgets, [eq(widgets.slug, 'missing')], (row) => {
      calls += 1;
      return row.id;
    });
    expect(calls).toBe(0);
  });
});
