import Database from 'better-sqlite3';
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { sqliteKernel } from '../../kernel/sqlite/index.js';
import { createCheckedSqliteClient, withSqliteTransaction } from '../../sqlite/index.js';

test.each([
  { outcome: undefined, rows: [{ value: 7 }] }, { outcome: null, rows: [{ value: 7 }] },
  { outcome: 'done', rows: [{ value: 7 }] }, { outcome: {}, rows: [{ value: 7 }] },
  { outcome: { ok: true }, rows: [{ value: 7 }] }, { outcome: { ok: false }, rows: [] },
])(
  'only an explicit failed outcome rolls back: $outcome', async ({ outcome, rows }) => {
    const client = createCheckedSqliteClient({ database: new Database(':memory:') });
    const kernel = sqliteKernel<unknown>({ source: client });
    try {
      await kernel.execute(sql`create table writes (value integer)`);
      const result = await withSqliteTransaction({ client, kernel, work: async ({ session }) => {
        await session.transaction({ work: async ({ session: nested }) => {
          await nested.execute({ statement: sql`insert into writes values (7)` });
        } });
        return outcome;
      } }, { rollbackOnFailedOutcome: true });
      expect(result).toBe(outcome);
      expect(await kernel.query(sql`select value from writes`)).toEqual(rows);
    } finally { await kernel.close(); }
  },
);

test('an ordinary AggregateError retains its parts when the owned transaction rolls back', async () => {
  const client = createCheckedSqliteClient({ database: new Database(':memory:') });
  const kernel = sqliteKernel<unknown>({ source: client });
  const parts = [new Error('first'), 'second'];
  try {
    const failure = withSqliteTransaction({ client, kernel, work: async () => {
      throw new AggregateError(parts, 'body failed');
    } });
    await expect(failure).rejects.toMatchObject({ message: 'body failed', errors: parts });
    expect(client.inTransaction).toBe(false);
  } finally { await kernel.close(); }
});

test('failure-shaped domain data commits unless the root explicitly opts in and ok is the boolean false', async () => {
  const database = new Database(':memory:');
  const client = createCheckedSqliteClient({ database });
  const kernel = sqliteKernel<unknown>({ source: client });
  try {
    await kernel.execute(sql`create table retained (value integer)`);
    const commit = (value: number, outcome: { ok: boolean | number | string }, optional?: { rollbackOnFailedOutcome: boolean }) =>
      withSqliteTransaction({ client, kernel, work: async ({ session }) => {
        await session.execute({ statement: sql`insert into retained values (${value})` });
        return outcome;
      } }, optional);
    const disabled = { ok: false };
    expect(await commit(1, disabled)).toBe(disabled);
    expect(await commit(2, { ok: 0 }, { rollbackOnFailedOutcome: true })).toEqual({ ok: 0 });
    expect(await commit(3, { ok: "false" }, { rollbackOnFailedOutcome: true })).toEqual({ ok: "false" });
    expect(database.prepare('select value from retained order by value').all()).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
  } finally { database.close(); }
});
