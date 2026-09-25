/**
 * `createSqliteAsyncOperationStore` — the durable `AsyncOperationStore` adapter.
 *
 * `async-operation-store.ts` ships only `createInMemoryAsyncOperationStore`, so a process restart
 * loses every in-flight submit-then-poll operation despite the store's own module doc describing
 * it as the row that makes crash safety "fall out for free" — that guarantee only holds once a
 * real durable adapter exists. This follows `sqlite-task-store.ts`'s established convention in
 * this same package exactly, rather than inventing a parallel one: `new Database(dbPath)`,
 * `db.pragma('journal_mode = WAL')`, `CREATE TABLE IF NOT EXISTS` (idempotent — reopening the same
 * file resumes from whatever was durably committed), `db.transaction()` for atomic multi-statement
 * writes, every public method still `Promise`-returning despite `better-sqlite3` being fully
 * synchronous under the hood, a `close(): Promise<void>` addition beyond the port interface, and
 * `better-sqlite3` dynamically imported (never at module scope) so a consumer wanting only the
 * in-memory reference store never pays for loading the native binary.
 *
 * One deliberate departure from `sqlite-task-store.ts`'s own precedent: that file hand-copies its
 * source port's transition table into a local `ALLOWED_TRANSITIONS` constant. This file instead
 * imports `TERMINAL_STATUSES` and `assertTransition` from `async-operation-store.ts` — a second
 * hand-maintained copy of this store's lease/terminal-status machinery is exactly the kind of
 * mirror that drifts silently the next time the source of truth changes, and this store's lifecycle
 * (five statuses, a `never leaves 'unknown'`/`'succeeded'`/`'failed'` terminal set, lease fencing)
 * is materially more failure-sensitive than `MediaTaskStore`'s.
 *
 * `claimDue` is the one place this adapter is NOT a row-by-row translation of the in-memory
 * reference: it is a single `UPDATE ... WHERE id IN (SELECT ... ORDER BY ... LIMIT ?) RETURNING *`
 * statement — exactly the "single conditional UPDATE ... RETURNING" the in-memory store's own doc
 * comment already promises a durable adapter would be. `RETURNING` needs the bundled
 * `better-sqlite3` to embed SQLite >= 3.35; verified against this repo's pinned version before
 * writing this file.
 */
import type Database from 'better-sqlite3';

import {
  ASYNC_OPERATION_SCHEMA_VERSION,
  ASYNC_OPERATION_STATUSES,
  assertNoCredentialMaterial,
  assertTransition,
  hydrateAsyncOperationRecord,
  TERMINAL_STATUSES,
} from './async-operation-store.js';
import type {
  AsyncOperationClaimOptions,
  AsyncOperationCreateInput,
  AsyncOperationError,
  AsyncOperationPatch,
  AsyncOperationReconcileResult,
  AsyncOperationRecord,
  AsyncOperationResult,
  AsyncOperationStatus,
  AsyncOperationStore,
  AsyncOperationUpdateOptions,
} from './async-operation-store.js';

/**
 * The non-terminal ("live") status values — `ASYNC_OPERATION_STATUSES` minus `TERMINAL_STATUSES`,
 * built once so this file cannot itself drift from either source set. Used as a positive
 * `status IN (?, ?)` predicate in place of `status NOT IN (?, ?, ?)` in the claim and reconcile
 * queries below: `NOT IN` on `idx_jini_async_operations_claim`'s leading column is not sargable —
 * confirmed via `EXPLAIN QUERY PLAN` against this repo's pinned `better-sqlite3`, `NOT IN` produces
 * `SCAN jini_async_operations` while `IN` produces `SEARCH ... USING INDEX
 * idx_jini_async_operations_claim (status=? AND next_poll_at<?)` — because a b-tree index can be
 * walked to find rows a positive predicate matches, but not to skip rows a negated one excludes.
 * Without this, the index created for exactly this query is dead weight and every poll cycle scans
 * the whole table.
 */
const LIVE_STATUSES: ReadonlySet<AsyncOperationStatus> = new Set(
  ASYNC_OPERATION_STATUSES.filter((status) => !TERMINAL_STATUSES.has(status)),
);
const LIVE_LIST = [...LIVE_STATUSES] as const;
const LIVE_PLACEHOLDERS = LIVE_LIST.map(() => '?').join(', ');

interface OperationRow {
  id: string;
  provider_id: string;
  route_key: string;
  owner_ref: string;
  status: string;
  attempts: number;
  max_attempts: number;
  deadline_at: number;
  next_poll_at: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  state: string | null;
  result: string | null;
  error: string | null;
  schema_version: number;
  created_at: number;
  updated_at: number;
}

function rowToOperation(row: OperationRow): AsyncOperationRecord {
  return hydrateAsyncOperationRecord({
    schemaVersion: row.schema_version,
    id: row.id,
    providerId: row.provider_id,
    routeKey: row.route_key,
    ownerRef: row.owner_ref,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    deadlineAt: row.deadline_at,
    nextPollAt: row.next_poll_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    state: row.state === null ? null : (JSON.parse(row.state) as Record<string, unknown>),
    result: row.result === null ? null : (JSON.parse(row.result) as AsyncOperationResult),
    error: row.error === null ? null : (JSON.parse(row.error) as AsyncOperationError),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** An `AsyncOperationStore` backed by a `better-sqlite3` database, plus a `close()` to release the file handle. */
export interface SqliteAsyncOperationStore extends AsyncOperationStore {
  close(): Promise<void>;
}

/**
 * Opens (creating if absent) a `better-sqlite3` database at `dbPath` and returns an
 * `AsyncOperationStore` backed by it. Pass `':memory:'` for a non-durable in-process database
 * (useful in tests that want SQL semantics without a file). Schema creation is idempotent
 * (`CREATE TABLE IF NOT EXISTS`), so reopening the same file after a restart resumes from whatever
 * was durably committed — a fresh `createSqliteAsyncOperationStore(dbPath)` call sees every
 * operation exactly as it was left, and `recoverAfterRestart`/`reconcileOnBoot` can then release
 * dead leases and expire blown deadlines.
 */
export async function createSqliteAsyncOperationStore(dbPath: string): Promise<SqliteAsyncOperationStore> {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS jini_async_operations (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      route_key TEXT NOT NULL,
      owner_ref TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL,
      deadline_at INTEGER NOT NULL,
      next_poll_at INTEGER NOT NULL,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      state TEXT,
      result TEXT,
      error TEXT,
      schema_version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jini_async_operations_owner ON jini_async_operations (owner_ref);
    CREATE INDEX IF NOT EXISTS idx_jini_async_operations_claim ON jini_async_operations (status, next_poll_at);
  `);

  const getStmt = db.prepare<[string], OperationRow>('SELECT * FROM jini_async_operations WHERE id = ?');
  const insertStmt = db.prepare<[
    string, string, string, string, string, number, number, number, number, string | null, number, number, number,
  ]>(`
    INSERT INTO jini_async_operations
      (id, provider_id, route_key, owner_ref, status, attempts, max_attempts, deadline_at, next_poll_at, state, result, error, schema_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
  `);
  const updateStmt = db.prepare<[
    string, number, number, string | null, string | null, string | null, string | null, number | null, number, string,
  ]>(`
    UPDATE jini_async_operations
    SET status = ?, attempts = ?, next_poll_at = ?, state = ?, result = ?, error = ?, lease_owner = ?, lease_expires_at = ?, updated_at = ?
    WHERE id = ?
  `);
  const listByOwnerStmt = db.prepare<[string], OperationRow>(
    'SELECT * FROM jini_async_operations WHERE owner_ref = ? ORDER BY created_at ASC',
  );
  const releaseLeaseStmt = db.prepare<[number, string, string]>(
    'UPDATE jini_async_operations SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND lease_owner = ?',
  );
  // Variadic bind params (a `now`/`limit` mix plus a spread of `LIVE_LIST`) don't fit a fixed
  // tuple type — `better-sqlite3`'s `Statement` defaults to `unknown[]` when left unspecified.
  const claimDueStmt = db.prepare<unknown[], OperationRow>(`
    UPDATE jini_async_operations
    SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
    WHERE id IN (
      SELECT id FROM jini_async_operations
      WHERE status IN (${LIVE_PLACEHOLDERS})
        AND next_poll_at <= ?
        AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
      ORDER BY next_poll_at ASC
      LIMIT ?
    )
    RETURNING *
  `);
  const deadlineExpireStmt = db.prepare<unknown[], OperationRow>(`
    UPDATE jini_async_operations
    SET status = 'unknown', lease_owner = NULL, lease_expires_at = NULL, error = ?, updated_at = ?
    WHERE status IN (${LIVE_PLACEHOLDERS}) AND deadline_at <= ?
    RETURNING *
  `);
  const releaseDeadLeasesStmt = db.prepare<unknown[], OperationRow>(`
    UPDATE jini_async_operations
    SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
    WHERE status IN (${LIVE_PLACEHOLDERS}) AND lease_owner IS NOT NULL AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    RETURNING *
  `);

  function stateJson(state: Readonly<Record<string, unknown>> | null | undefined): string | null {
    return state == null ? null : JSON.stringify(state);
  }

  const createTxn = db.transaction((input: AsyncOperationCreateInput): AsyncOperationRecord => {
    if (getStmt.get(input.id)) {
      throw new Error(`async operation "${input.id}" already exists`);
    }
    if (!Number.isFinite(input.maxAttempts) || input.maxAttempts < 1) {
      throw new RangeError(`Invalid maxAttempts: ${input.maxAttempts} must be a finite number >= 1`);
    }
    if (!Number.isFinite(input.deadlineAt)) {
      throw new RangeError(`Invalid deadlineAt: ${input.deadlineAt} must be a finite epoch-ms timestamp`);
    }
    assertNoCredentialMaterial(input.state);

    const now = Date.now();
    const status: AsyncOperationStatus = input.status ?? 'submitted';
    insertStmt.run(
      input.id,
      input.providerId,
      input.routeKey,
      input.ownerRef,
      status,
      0,
      input.maxAttempts,
      input.deadlineAt,
      input.nextPollAt ?? now,
      stateJson(input.state),
      ASYNC_OPERATION_SCHEMA_VERSION,
      now,
      now,
    );
    return rowToOperation(getStmt.get(input.id)!);
  });

  const updateTxn = db.transaction(
    (id: string, patch: AsyncOperationPatch, options?: AsyncOperationUpdateOptions): AsyncOperationRecord | null => {
      const existingRow = getStmt.get(id);
      if (!existingRow) return null;
      const existing = rowToOperation(existingRow);

      // Fenced exactly like `releaseLease` and the in-memory store: a caller writing against a
      // lease it no longer holds gets the row back unchanged, not an overwrite.
      if (options?.leaseOwner !== undefined && existing.leaseOwner !== options.leaseOwner) {
        return existing;
      }

      if ('state' in patch) assertNoCredentialMaterial(patch.state);

      const status = patch.status ?? existing.status;
      assertTransition(existing.status, status);

      const next = {
        status,
        attempts: patch.attempts ?? existing.attempts,
        nextPollAt: patch.nextPollAt ?? existing.nextPollAt,
        state: 'state' in patch ? (patch.state ?? null) : existing.state,
        result: 'result' in patch ? (patch.result ?? null) : existing.result,
        error: 'error' in patch ? (patch.error ?? null) : existing.error,
        leaseOwner: 'leaseOwner' in patch ? (patch.leaseOwner ?? null) : existing.leaseOwner,
        leaseExpiresAt: 'leaseExpiresAt' in patch ? (patch.leaseExpiresAt ?? null) : existing.leaseExpiresAt,
        updatedAt: Date.now(),
      };

      updateStmt.run(
        next.status,
        next.attempts,
        next.nextPollAt,
        stateJson(next.state),
        next.result === null ? null : JSON.stringify(next.result),
        next.error === null ? null : JSON.stringify(next.error),
        next.leaseOwner,
        next.leaseExpiresAt,
        next.updatedAt,
        id,
      );
      return rowToOperation(getStmt.get(id)!);
    },
  );

  const claimDueTxn = db.transaction((options: AsyncOperationClaimOptions): AsyncOperationRecord[] => {
    const { now, leaseOwner, leaseMs } = options;
    const limit = options.limit ?? 10;
    const rows = claimDueStmt.all(leaseOwner, now + leaseMs, now, ...LIVE_LIST, now, now, limit);
    return rows.map(rowToOperation);
  });

  const reconcileTxn = db.transaction((options: { now: number }): AsyncOperationReconcileResult => {
    const { now } = options;
    const deadlineExpiredError = JSON.stringify({
      message: 'async operation passed its absolute deadline while unattended — vendor-side effect is undetermined',
      code: 'DEADLINE_EXPIRED',
    });
    const deadlineExpired = deadlineExpireStmt.all(deadlineExpiredError, now, ...LIVE_LIST, now).length;
    const leasesReleased = releaseDeadLeasesStmt.all(now, ...LIVE_LIST, now).length;
    return { leasesReleased, deadlineExpired };
  });

  return {
    async create(input: AsyncOperationCreateInput): Promise<AsyncOperationRecord> {
      return createTxn(input);
    },

    async get(id: string): Promise<AsyncOperationRecord | null> {
      const row = getStmt.get(id);
      return row ? rowToOperation(row) : null;
    },

    async update(id: string, patch: AsyncOperationPatch, options?: AsyncOperationUpdateOptions): Promise<AsyncOperationRecord | null> {
      return updateTxn(id, patch, options);
    },

    async listByOwner(ownerRef: string): Promise<AsyncOperationRecord[]> {
      return listByOwnerStmt.all(ownerRef).map(rowToOperation);
    },

    async claimDue(options: AsyncOperationClaimOptions): Promise<AsyncOperationRecord[]> {
      return claimDueTxn(options);
    },

    async releaseLease(id: string, leaseOwner: string): Promise<void> {
      releaseLeaseStmt.run(Date.now(), id, leaseOwner);
    },

    async reconcileOnBoot(options: { now: number }): Promise<AsyncOperationReconcileResult> {
      return reconcileTxn(options);
    },

    async close(): Promise<void> {
      db.close();
    },
  };
}
