import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { sql } from 'kysely';
import pg from 'pg';
import { openPostgresKernel } from '../kernel/postgres/driver.js';
import { withKernelSessionLock } from '../kernel/index.js';

const connectionString = process.env.COMMERCE_PG_URL ?? process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres';
const exec = promisify(execFile);

it('native PG excludes independent pools and processes while business transactions commit outside the owner session', async () => {
  const first = openPostgresKernel({ pg, connectionString });
  const second = openPostgresKernel({ pg, connectionString });
  const key = `commerce-owner-test:${randomUUID()}`;
  const table = `commerce_owner_${randomUUID().replaceAll('-', '')}`;
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const done = new Promise<void>(resolve => { finish = resolve; });
  try {
    await first.execute(sql`CREATE TABLE ${sql.id(table)} (id integer PRIMARY KEY)`);
    const owner = withKernelSessionLock({ kernel: first, key, run: async lease => {
      await lease.assertOwned();
      await first.transaction(async () => { await first.execute(sql`INSERT INTO ${sql.id(table)} VALUES (1)`); });
      entered(); await done;
    } });
    await started;
    expect(await second.query(sql`SELECT * FROM ${sql.id(table)}`)).toEqual([{ id: 1 }]);
    expect(await withKernelSessionLock({ kernel: second, key, run: async () => 'duplicate' })).toEqual({ acquired: false });
    const script = `import pg from 'pg'; const pool=new pg.Pool({connectionString:process.env.COMMERCE_PG_URL}); const client=await pool.connect(); const result=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[process.env.COMMERCE_OWNER_KEY]); console.log(JSON.stringify(result.rows[0])); client.release(); await pool.end();`;
    const child = await exec(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('../..', import.meta.url), env: { ...process.env, COMMERCE_PG_URL: connectionString, COMMERCE_OWNER_KEY: key },
    });
    expect(JSON.parse(child.stdout)).toEqual({ locked: false });
    finish(); await owner;
    expect(await withKernelSessionLock({ kernel: second, key, run: async () => 'next owner' })).toEqual({ acquired: true, value: 'next owner' });
  } finally {
    finish();
    await first.execute(sql`DROP TABLE IF EXISTS ${sql.id(table)}`);
    await Promise.all([first.close(), second.close()]);
  }
});

it('a terminated owner session fails its liveness probe before another settlement cycle', async () => {
  const first = openPostgresKernel({ pg, connectionString });
  const second = openPostgresKernel({ pg, connectionString });
  const key = `commerce-owner-loss:${randomUUID()}`;
  try {
    await expect(withKernelSessionLock({ kernel: first, key, run: async lease => {
      const locks = await second.query<{ pid: number }>(sql`SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=((hashtextextended(${key},0) >> 32) & 4294967295)::oid AND objid=(hashtextextended(${key},0) & 4294967295)::oid AND objsubid=1 AND granted`);
      expect(locks).toHaveLength(1);
      await second.query(sql`SELECT pg_terminate_backend(${locks[0]!.pid})`);
      await lease.assertOwned();
    } })).rejects.toThrow();
    expect(await withKernelSessionLock({ kernel: second, key, run: async () => 'replacement' })).toEqual({ acquired: true, value: 'replacement' });
  } finally { await Promise.all([first.close(), second.close()]); }
});

it('a one-connection native pool remains usable while refusing a background session owner', async () => {
  const kernel = openPostgresKernel({ pg, connectionString }, { max: 1 });
  try {
    await expect(withKernelSessionLock({ kernel, key: `commerce-small-pool:${randomUUID()}`, run: async () => {
      throw new Error('a session must not be acquired');
    } })).rejects.toThrow(/pool.*at least 2/i);
    expect(await kernel.query<{ value: number }>(sql`SELECT 1::integer AS value`)).toEqual([{ value: 1 }]);
  } finally { await kernel.close(); }
});

it('independent site schemas acquire distinct settlement keys concurrently', async () => {
  const admin = openPostgresKernel({ pg, connectionString });
  const schemas = [`commerce_site_a_${randomUUID().replaceAll('-', '')}`, `commerce_site_b_${randomUUID().replaceAll('-', '')}`];
  const kernels: ReturnType<typeof openPostgresKernel>[] = [];
  try {
    for (const schema of schemas) {
      await admin.execute(sql`CREATE SCHEMA ${sql.id(schema)}`);
      const scoped = new URL(connectionString); scoped.searchParams.set('options', `-c search_path=${schema}`);
      kernels.push(openPostgresKernel({ pg, connectionString: scoped.href }, { max: 2 }));
    }
    const key = (siteId: string) => `commerce:settlement-worker:${JSON.stringify(['workspace', siteId])}`;
    await withKernelSessionLock({ kernel: kernels[0]!, key: key(schemas[0]!), run: async () => {
      expect(await withKernelSessionLock({ kernel: kernels[1]!, key: key(schemas[1]!), run: async () => 'second site' })).toEqual({ acquired: true, value: 'second site' });
      expect(await withKernelSessionLock({ kernel: kernels[1]!, key: key(schemas[0]!), run: async () => 'duplicate' })).toEqual({ acquired: false });
    } });
  } finally {
    await Promise.all(kernels.map(kernel => kernel.close()));
    for (const schema of schemas) await admin.execute(sql`DROP SCHEMA IF EXISTS ${sql.id(schema)} CASCADE`);
    await admin.close();
  }
});
