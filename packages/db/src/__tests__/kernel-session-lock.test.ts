import { expect, it } from 'vitest';
import { openPostgresKernel } from '../kernel/postgres/driver.js';
import { scopeToSchema, withKernelSessionLock, kernelSessionPoolMax } from '../kernel/index.js';

function database({ max = 10 } = {}) {
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
  const kernel = openPostgresKernel({ pg: { Pool, types: { getTypeParser: () => (value: string) => value } } as never, connectionString: 'postgres://test-only' }, { max });
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

it('a one-connection pool rejects background session ownership before reserving its only connection', async () => {
  const { kernel, statements } = database({ max: 1 });
  let ran = false;
  await expect(withKernelSessionLock({ kernel, key: 'commerce', run: async () => { ran = true; } })).rejects.toThrow(/pool.*at least 2|pool.*max.*2/i);
  expect(ran).toBe(false);
  expect(statements.some(statement => statement.includes('pg_try_advisory_lock'))).toBe(false);
  await kernel.transaction(async () => {});
  expect(statements.some(statement => statement.toLowerCase().startsWith('commit'))).toBe(true);
  const scoped = scopeToSchema(kernel, 'site_a');
  await expect(withKernelSessionLock({ kernel: scoped, key: 'commerce', run: async () => {} })).rejects.toThrow(/pool.*at least 2|pool.*max.*2/i);
  await kernel.close();
});

it('distinct site keys can hold ownership concurrently in the same database', async () => {
  const { kernel, locks } = database();
  const first = 'commerce:settlement-worker:["workspace","site-a"]';
  const second = 'commerce:settlement-worker:["workspace","site-b"]';
  await withKernelSessionLock({ kernel, key: first, run: async () => {
    expect(await withKernelSessionLock({ kernel, key: second, run: async () => 'site-b' })).toEqual({ acquired: true, value: 'site-b' });
    expect(locks.has(first)).toBe(true);
  } });
  expect(locks.size).toBe(0);
  await kernel.close();
});


it('pool capacity is readable before ownership and survives a schema wrapper', async () => {
  const { kernel, statements } = database({ max: 1 });
  expect(kernelSessionPoolMax({ kernel })).toBe(1);
  expect(kernelSessionPoolMax({ kernel: scopeToSchema(kernel, 'site_a') })).toBe(1);
  expect(statements).toEqual([]);
  await kernel.close();
});
