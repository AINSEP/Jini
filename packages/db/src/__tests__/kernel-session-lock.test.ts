import { expect, it } from 'vitest';
import { openPostgresKernel } from '../kernel/postgres/driver.js';
import { scopeToSchema, withKernelSessionLock } from '../kernel/index.js';

function database() {
  const locks = new Set<string>();
  const statements: string[] = [];
  class Pool {
    on() {}
    async connect() { return {
      async query(text: string, parameters: unknown[] = []) {
        statements.push(text);
        const key = String(parameters[0]);
        if (text.includes('pg_try_advisory_lock')) {
          const locked = !locks.has(key);
          if (locked) locks.add(key);
          return { rows: [{ locked }], command: 'SELECT', rowCount: 1 };
        }
        if (text.includes('pg_advisory_unlock')) locks.delete(key);
        return { rows: [], command: 'SELECT', rowCount: 0 };
      },
      release() {},
    }; }
    async end() {}
  }
  const kernel = openPostgresKernel({ pg: { Pool, types: { getTypeParser: () => (value: string) => value } } as never, connectionString: 'postgres://test-only' });
  return { kernel, locks, statements };
}

it('one session owns a key while normal ledger transactions commit independently', async () => {
  const { kernel, locks, statements } = database();
  let enter!: () => void;
  let finish!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const first = withKernelSessionLock({ kernel, key: 'commerce', run: async () => {
    expect(kernel.inTransaction()).toBe(false);
    await kernel.transaction(async () => {});
    enter(); await finished; return 'done';
  } });
  await entered;
  expect(await withKernelSessionLock({ kernel, key: 'commerce', run: async () => 'duplicate' })).toEqual({ acquired: false });
  expect(locks.has('commerce')).toBe(true);
  expect(statements.some(statement => statement.toLowerCase().startsWith('commit'))).toBe(true);
  finish();
  expect(await first).toEqual({ acquired: true, value: 'done' });
  expect(locks.size).toBe(0);
  await kernel.close();
});

it('schema-scoped kernels share ownership and a failed cycle always releases the session lock', async () => {
  const { kernel, locks } = database();
  const scoped = scopeToSchema(kernel, 'public');
  await expect(withKernelSessionLock({ kernel: scoped, key: 'commerce', run: async () => { throw new Error('projection failed'); } })).rejects.toThrow('projection failed');
  expect(locks.size).toBe(0);
  expect(await withKernelSessionLock({ kernel, key: 'commerce', run: async () => 'retry' })).toEqual({ acquired: true, value: 'retry' });
  await kernel.close();
});
