import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { createLegacySqliteStorage } from '../legacy/sqlite.js';

// hwb #8: opening another host must not close the first host's database, even at the same file path.
it('isolates connection ownership and closes only its own cached handle', () => {
  const first = createLegacySqliteStorage({});
  const second = createLegacySqliteStorage({});
  const open = () => new Database(':memory:');
  const filesystem = { mkdirSync: () => undefined };
  const a = first.openDatabase({ projectRoot: '/first', open }, { filesystem });
  const b = second.openDatabase({ projectRoot: '/second', open }, { filesystem });
  try {
    expect(a.open).toBe(true);
    expect(b.open).toBe(true);
    expect(first.openDatabase({ projectRoot: '/first', open }, { filesystem })).toBe(a);
    second.closeDatabase();
    expect(a.open).toBe(true);
    expect(b.open).toBe(false);
    expect(a.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 });
  } finally { first.closeDatabase(); second.closeDatabase(); }
});
