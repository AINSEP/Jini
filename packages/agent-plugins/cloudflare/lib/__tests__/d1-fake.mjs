import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../forms.mjs';

const returnsRows = sql => /^\s*select\b/i.test(sql) || /\breturning\b/i.test(sql);

/** Real SQLite behind the D1 shapes the receiver and the REST provisioning use. */
export function fakeD1({ migrated = true, fail } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  if (migrated) for (const migration of MIGRATIONS) for (const sql of migration.sql) sqlite.exec(sql);
  const execute = ({ sql, params }) => {
    if (fail?.(sql)) throw new Error('D1_ERROR: simulated');
    const statement = sqlite.prepare(sql);
    if (returnsRows(sql)) return { results: statement.all(...params).map(row => ({ ...row })), success: true, meta: {} };
    const info = statement.run(...params);
    return { results: [], success: true, meta: { changes: Number(info.changes) } };
  };
  const prepare = sql => {
    const bound = (params = []) => ({ sql, params,
      bind: (...next) => bound(next),
      all: async () => execute({ sql, params }),
      run: async () => execute({ sql, params }),
      first: async () => execute({ sql, params }).results[0] ?? null });
    return bound();
  };
  return {
    sqlite,
    binding: { prepare, batch: async statements => statements.map(statement => execute(statement)) },
    rows: sql => sqlite.prepare(sql).all().map(row => ({ ...row })),
    /** The REST `/query` endpoint: one statement, positional params. */
    rest: ({ sql, params = [] }) => [execute({ sql, params })],
  };
}
