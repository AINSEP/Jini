import { describe, expect, it } from 'vitest';
import { openPostgresKernel } from '../kernel/postgres/driver.js';
import { openMemorySqliteKernel } from '../kernel/sqlite/index.js';
import { withKernelSessionLock, type KyselyKernel } from '../kernel/index.js';
import { openSqlite } from './helpers.js';

function fakePostgres() {
  const statements: string[] = [];
  class Pool {
    on() {}
    async connect() { return {
      async query(text: string) {
        statements.push(text);
        if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }], command: 'SELECT', rowCount: 1 };
        return { rows: [], command: 'SELECT', rowCount: 0 };
      },
      release() {},
    }; }
    async end() {}
  }
  const kernel = openPostgresKernel({ pg: { Pool, types: { getTypeParser: () => (v: string) => v } } as never, connectionString: 'postgres://test-only' }, { max: 4 });
  return { kernel, statements };
}

describe('withKernelSessionLock guards', () => {
  it('rejects a non-PostgreSQL transport before touching the database', async () => {
    const kernel = openMemorySqliteKernel<unknown>({ open: openSqlite });
    let ran = false;
    await expect(withKernelSessionLock({ kernel, key: 'k', run: async () => { ran = true; } }))
      .rejects.toThrow('A database session lock requires the pooled PostgreSQL transport.');
    expect(ran).toBe(false);
    await kernel.close();
  });

  it('rejects an attempt to start inside a transaction', async () => {
    const { kernel, statements } = fakePostgres();
    await kernel.transaction(async () => {
      await expect(withKernelSessionLock({ kernel, key: 'k', run: async () => 'x' }))
        .rejects.toThrow('A database session owner cannot start inside a transaction.');
    });
    expect(statements.some((s) => s.includes('pg_try_advisory_lock'))).toBe(false);
    await kernel.close();
  });

  it('rejects a kernel that was not built by buildKernel', async () => {
    const { kernel } = fakePostgres();
    const impostor = { transport: 'node-postgres', inTransaction: () => false } as unknown as KyselyKernel<unknown>;
    await expect(withKernelSessionLock({ kernel: impostor, key: 'k', run: async () => 'x' }))
      .rejects.toThrow('A database session lock requires a kernel built by buildKernel.');
    await kernel.close();
  });

  it('hands the callback an assertOwned probe that runs a query on the held session', async () => {
    const { kernel, statements } = fakePostgres();
    const out = await withKernelSessionLock({ kernel, key: 'k', run: async (lease) => {
      const before = statements.length;
      await lease.assertOwned();
      return statements.slice(before);
    } });
    expect(out).toEqual({ acquired: true, value: ['SELECT 1'] });
    expect(statements.at(-1)).toContain('pg_advisory_unlock');
    await kernel.close();
  });
});
