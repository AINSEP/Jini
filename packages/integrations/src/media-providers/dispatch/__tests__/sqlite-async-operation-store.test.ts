/**
 * Conformance suite for `createSqliteAsyncOperationStore`. Covers the same shape as
 * `async-operation-store.test.ts` (create/get/update/claimDue/releaseLease/reconcileOnBoot,
 * credential-sanitizer and lease-fencing invariants) against the sqlite adapter instead of the
 * in-memory reference, proving behavioral parity — plus a durability-across-restart section with
 * no in-memory equivalent: closes the store, opens a fresh one against the same file, and confirms
 * an in-flight operation's state survived and can be reconciled exactly like a real process
 * restart would leave it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CREDENTIAL_IN_STATE_MESSAGE } from '../async-operation-store.js';
import { createSqliteAsyncOperationStore } from '../sqlite-async-operation-store.js';
import type { SqliteAsyncOperationStore } from '../sqlite-async-operation-store.js';

const BASE = {
  id: 'op-1',
  providerId: 'imagerouter',
  routeKey: 'video',
  ownerRef: 'run-1',
  maxAttempts: 5,
  deadlineAt: 10_000,
  nextPollAt: 0,
} as const;

let dir: string;
let dbPath: string;
let store: SqliteAsyncOperationStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'jini-async-operation-store-'));
  dbPath = join(dir, 'async-operations.db');
  store = await createSqliteAsyncOperationStore(dbPath);
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('createSqliteAsyncOperationStore — lifecycle parity with the in-memory reference', () => {
  it('persists a new operation as "submitted" carrying both independent bounds', async () => {
    const row = await store.create(BASE);

    expect(row.status).toBe('submitted');
    expect(row.attempts).toBe(0);
    expect(row.maxAttempts).toBe(5);
    expect(row.deadlineAt).toBe(10_000);
    expect(row.leaseOwner).toBeNull();
  });

  it('rejects a duplicate id instead of silently overwriting', async () => {
    await store.create(BASE);
    await expect(store.create(BASE)).rejects.toThrow(/already exists/);
  });

  it('refuses to persist credential material in the operation state', async () => {
    await expect(store.create({ ...BASE, state: { jobId: 'j1', apiKey: 'sk-live-123' } })).rejects.toThrow(
      CREDENTIAL_IN_STATE_MESSAGE,
    );
  });

  it('refuses to smuggle credential material in on a later update', async () => {
    await store.create(BASE);
    await expect(store.update('op-1', { state: { authorization: 'Bearer sk-live-123' } })).rejects.toThrow(
      CREDENTIAL_IN_STATE_MESSAGE,
    );
  });

  it('round-trips a non-null state/result/error through the JSON columns', async () => {
    await store.create({ ...BASE, state: { jobId: 'job-77' } });
    const row = await store.update('op-1', {
      status: 'succeeded',
      result: { bytesBase64: 'AAAA', providerNote: 'ok', suggestedExt: 'mp4' },
    });

    expect(row?.state).toEqual({ jobId: 'job-77' });
    expect(row?.result).toEqual({ bytesBase64: 'AAAA', providerNote: 'ok', suggestedExt: 'mp4' });
    expect((await store.get('op-1'))?.result).toEqual({ bytesBase64: 'AAAA', providerNote: 'ok', suggestedExt: 'mp4' });
  });

  it('rejects an illegal lifecycle transition with the exact table-driven message', async () => {
    await store.create(BASE);
    await store.update('op-1', { status: 'succeeded' });

    await expect(store.update('op-1', { status: 'polling' })).rejects.toThrow(
      'Invalid async operation transition: "succeeded" -> "polling"',
    );
  });

  it('claims only operations that are due and unleased', async () => {
    await store.create({ ...BASE, id: 'due', nextPollAt: 100 });
    await store.create({ ...BASE, id: 'not-due', nextPollAt: 900 });

    const claimed = await store.claimDue({ now: 500, leaseOwner: 'w1', leaseMs: 1000 });

    expect(claimed.map((r) => r.id)).toEqual(['due']);
  });

  it('leases exclusively — a second worker cannot claim the same row', async () => {
    await store.create({ ...BASE, id: 'due', nextPollAt: 0 });

    const first = await store.claimDue({ now: 500, leaseOwner: 'w1', leaseMs: 1000 });
    const second = await store.claimDue({ now: 500, leaseOwner: 'w2', leaseMs: 1000 });

    expect(first.map((r) => r.id)).toEqual(['due']);
    expect(second).toEqual([]);
  });

  it('lets another worker reclaim a row whose lease has expired', async () => {
    await store.create({ ...BASE, id: 'due', nextPollAt: 0 });
    await store.claimDue({ now: 500, leaseOwner: 'w1', leaseMs: 1000 });

    const reclaimed = await store.claimDue({ now: 2_000, leaseOwner: 'w2', leaseMs: 1000 });

    expect(reclaimed.map((r) => r.id)).toEqual(['due']);
    expect(reclaimed[0]!.leaseOwner).toBe('w2');
  });

  it('fences lease release on ownership — a late release from the previous owner must not clear a lease another worker has since reclaimed', async () => {
    await store.create({ ...BASE, id: 'due', nextPollAt: 0 });
    await store.claimDue({ now: 0, leaseOwner: 'worker-A', leaseMs: 10 });
    await store.claimDue({ now: 11, leaseOwner: 'worker-B', leaseMs: 1000 });

    await store.releaseLease('due', 'worker-A');

    const row = await store.get('due');
    expect(row?.leaseOwner).toBe('worker-B');

    const stolen = await store.claimDue({ now: 12, leaseOwner: 'worker-C', leaseMs: 1000 });
    expect(stolen).toEqual([]);
  });

  it('fences update() on lease ownership — a stale worker cannot overwrite the row a newer owner already claimed', async () => {
    await store.create({ ...BASE, id: 'due', nextPollAt: 0 });
    await store.claimDue({ now: 0, leaseOwner: 'worker-A', leaseMs: 10 });
    await store.claimDue({ now: 100, leaseOwner: 'worker-B', leaseMs: 1000 });
    await store.update('due', { status: 'polling', attempts: 7 }, { leaseOwner: 'worker-B' });

    const result = await store.update('due', { status: 'polling', attempts: 1 }, { leaseOwner: 'worker-A' });

    expect((await store.get('due'))?.attempts).toBe(7);
    expect(result?.attempts).toBe(7);
  });

  it('releases expired leases on boot WITHOUT terminating in-flight work', async () => {
    await store.create({ ...BASE, id: 'inflight', nextPollAt: 0 });
    await store.update('inflight', { status: 'polling' });
    await store.claimDue({ now: 0, leaseOwner: 'dead-process', leaseMs: 1000 });

    const result = await store.reconcileOnBoot({ now: 9_000 });
    const row = await store.get('inflight');

    expect(result.leasesReleased).toBe(1);
    expect(row?.status).toBe('polling');
    expect(row?.leaseOwner).toBeNull();
  });

  it('marks an operation past its absolute deadline as unknown on boot, not succeeded', async () => {
    await store.create({ ...BASE, id: 'expired', nextPollAt: 0, deadlineAt: 1_000 });
    await store.update('expired', { status: 'polling' });

    const result = await store.reconcileOnBoot({ now: 50_000 });

    expect(result.deadlineExpired).toBe(1);
    expect((await store.get('expired'))?.status).toBe('unknown');
  });

  it('listByOwner returns only that owner\'s rows, oldest first', async () => {
    await store.create({ ...BASE, id: 'a', ownerRef: 'run-1' });
    await store.create({ ...BASE, id: 'b', ownerRef: 'run-2' });
    await store.create({ ...BASE, id: 'c', ownerRef: 'run-1' });

    const rows = await store.listByOwner('run-1');
    expect(rows.map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('createSqliteAsyncOperationStore — durability across a real restart', () => {
  it('survives a process restart: a fresh store opened against the same file sees the in-flight operation intact', async () => {
    await store.create({ ...BASE, id: 'inflight', nextPollAt: 0, state: { jobId: 'job-77' } });
    await store.update('inflight', { status: 'polling', attempts: 3 });
    await store.claimDue({ now: 0, leaseOwner: 'worker-that-died', leaseMs: 1000 });

    // The only thing that models a process restart for a file-backed store: close this handle
    // (as if the process exited) and open an entirely new one against the same path.
    await store.close();
    const restarted = await createSqliteAsyncOperationStore(dbPath);

    const row = await restarted.get('inflight');
    expect(row).not.toBeNull();
    expect(row?.status).toBe('polling');
    expect(row?.attempts).toBe(3);
    expect(row?.state).toEqual({ jobId: 'job-77' });
    expect(row?.leaseOwner).toBe('worker-that-died');

    // And boot reconciliation, run against the fresh handle, releases the dead lease without
    // terminating the resumable work — proving the row is not just present but usable.
    const result = await restarted.reconcileOnBoot({ now: 5_000 });
    expect(result.leasesReleased).toBe(1);
    expect((await restarted.get('inflight'))?.status).toBe('polling');
    expect((await restarted.get('inflight'))?.leaseOwner).toBeNull();

    await restarted.close();
    store = await createSqliteAsyncOperationStore(dbPath); // so afterEach's close() has a live handle
  });

  it('survives a restart with a succeeded terminal result, byte-identical', async () => {
    await store.create({ ...BASE, id: 'done' });
    await store.update('done', {
      status: 'succeeded',
      result: { bytesBase64: Buffer.from('DURABLE').toString('base64'), providerNote: 'polled done' },
    });

    await store.close();
    const restarted = await createSqliteAsyncOperationStore(dbPath);

    const row = await restarted.get('done');
    expect(row?.status).toBe('succeeded');
    expect(Buffer.from(row!.result!.bytesBase64, 'base64').toString()).toBe('DURABLE');

    await restarted.close();
    store = await createSqliteAsyncOperationStore(dbPath);
  });
});

describe("createSqliteAsyncOperationStore — claimDue's real query is sargable (uses its index, not a full scan)", () => {
  /**
   * Regression coverage for the `status NOT IN (...)` full-table-scan bug in `claimDueStmt`:
   * `NOT IN` on the leading column of `idx_jini_async_operations_claim` cannot be satisfied by a
   * b-tree walk of that index — a b-tree can be walked to find rows a *positive* predicate
   * matches, not to skip rows a *negated* one excludes — so every poll cycle scanned the whole
   * table regardless of the index built for exactly this query. The fix rewrites the predicate as
   * a positive `status IN (<live statuses>)`.
   *
   * Deliberately captures the module's own real `claimDueStmt` SQL text via a
   * `Database.prototype.prepare` spy rather than reconstructing the query by hand: a hand-built
   * copy would pass or fail on its own merits and prove nothing about whether the actual
   * production statement changed. `better-sqlite3` refuses `EXPLAIN QUERY PLAN` on a statement
   * with unbound parameters (confirmed directly — "Too few parameter values were provided"), so
   * every `?` in the captured text is bound with a dummy value; `EXPLAIN QUERY PLAN` only needs
   * placeholder positions, never real values, to produce a plan.
   */
  it("claimDue's real prepared statement is satisfied by the claim index, not a full scan", async () => {
    const { default: Database } = await import('better-sqlite3');
    const originalPrepare = Database.prototype.prepare;
    const captured: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- spying across an arbitrary overload set
    (Database.prototype as any).prepare = function (this: unknown, sql: string, ...rest: unknown[]) {
      captured.push(sql);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalPrepare as any).call(this, sql, ...rest);
    };

    const dir2 = mkdtempSync(join(tmpdir(), 'jini-async-operation-store-planquery-'));
    const dbPath2 = join(dir2, 'async-operations.db');
    try {
      const captureStore = await createSqliteAsyncOperationStore(dbPath2);
      await captureStore.close();
    } finally {
      Database.prototype.prepare = originalPrepare;
      rmSync(dir2, { recursive: true, force: true });
    }

    // `claimDueStmt` is the only captured statement shaped as an `UPDATE ... RETURNING *` that
    // also orders by `next_poll_at` — distinguishes it from `deadlineExpireStmt`/
    // `releaseDeadLeasesStmt`, which share the `RETURNING *` shape but not the ordering.
    const claimSql = captured.find(
      (sql) => sql.includes('RETURNING *') && sql.includes('ORDER BY next_poll_at ASC') && sql.includes('UPDATE'),
    );
    expect(claimSql, `expected to capture claimDueStmt's SQL among: ${JSON.stringify(captured)}`).toBeDefined();

    const db = new Database(dbPath);
    try {
      const placeholderCount = (claimSql!.match(/\?/g) ?? []).length;
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${claimSql}`).all(...new Array(placeholderCount).fill(0)) as Array<{
        detail: string;
      }>;
      const details = plan.map((row) => row.detail).join(' | ');
      expect(details).toContain('USING INDEX idx_jini_async_operations_claim');
      expect(details).not.toContain('SCAN jini_async_operations');
    } finally {
      db.close();
    }
  });
});
