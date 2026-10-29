import { createSystemClock } from '@jini-ai/core/primitives';
/**
 * `createSqliteEventLog` — the durable `EventLog` adapter (extraction-plan §8 task 8,
 * §2.6: "`@jini-ai/daemon/store/event-log/sqlite` is the default adapter... an adapter conformance suite covers
 * transactions/ordering/cursor-durability/cancellation/migrations").
 *
 * Implements the protocol's two-object `EventLog` call shape, with the same distinguishable `'replay-gap'` result,
 * same never-reused monotonic per-run cursor allocation, same FIFO eviction at
 * `maxEntriesPerRun` — see `createInMemoryEventLog` in `@jini-ai/daemon` for the
 * reference behavior this mirrors. `better-sqlite3` is synchronous; every public
 * method still returns a `Promise` per extraction-plan §2.6 ("ports are async-only
 * from day one... a real persistent adapter is a drop-in swap"), and every
 * multi-statement operation (`append`'s dedupe-check + insert + eviction) runs
 * inside a `better-sqlite3` transaction for atomicity.
 *
 * Three deliberate divergences from the in-memory reference adapter, all scoped to this durable
 * adapter only: (1) `maxEntriesPerRun` defaults to {@link DEFAULT_MAX_ENTRIES_PER_RUN} (2000)
 * instead of unbounded — see `SqliteEventLogOptions.maxEntriesPerRun`'s doc; (2) `replay`'s
 * `afterCursor` is validated up front and throws for anything other than `null` or a
 * non-negative-safe-integer string, instead of returning a `'invalid-cursor'` result — see
 * `assertValidReplayCursor`; (3) dedupe evidence is retained only while its entry remains in the
 * FIFO window. Memory keeps dedupe evidence until drop, including evicted entries. This durable
 * adapter preserves its existing bounded SQL/schema behavior rather than adding a hidden archive.
 */
import { openSqliteConnection, type SqliteDb, type SqliteSyncOpener } from '@jini-ai/db/sqlite';
import type {
  EventLogAppendInput,
  EventLogAppendOptions,
  EventLogEntry,
  EventLogReplayResult,
} from '@jini-ai/protocol';

import {
  resolveMaxEntriesPerRun, assertValidReplayCursor, existingAppendResult,
  replayResult, rowToEntry, SQLITE_EVENT_LOG_SCHEMA,
  type RunRow, type EntryRow, type SqliteEventLogOptions, type SqliteEventLogWithReceipts,
  type SqliteEventLogAppendOptions, type SqliteEventLogAppendResult,
} from './sqlite-policy.js';
export { DEFAULT_MAX_ENTRIES_PER_RUN, SQLITE_EVENT_LOG_SCHEMA } from './sqlite-policy.js';
export type {
  SqliteEventLog, SqliteEventLogOptions, SqliteEventLogWithReceipts,
  SqliteEventLogDatabase, SqliteEventLogAppendOptions, SqliteEventLogAppendResult,
} from './sqlite-policy.js';
export { createKernelSqliteEventLog } from './sqlite-kernel.js';

/**
 * Borrows the caller's connection; ensures schema unless schemaSetup is 'host'.
 * Closing this adapter never closes a borrowed handle or changes its pragmas.
 * Use openSqliteEventLog with an explicit file/opener to acquire an owned connection.
 * @throws Host SQL/setup failures, or a missing borrowed connection.
 * @complexity Setup O(1) statements; append costs depend on the retained per-run cap.
 */
export function createSqliteEventLog(
  input: { db: SqliteDb },
  options: SqliteEventLogOptions = {},
): SqliteEventLogWithReceipts {
  resolveMaxEntriesPerRun(options.maxEntriesPerRun);
  if (!input || typeof input !== 'object' || !input.db) {
    throw new Error('createSqliteEventLog: pass a borrowed SqliteDb');
  }
  return bindSqliteEventLog(input.db, options);
}

/**
 * Acquires a connection through the host opener; setup failure closes that connection.
 * Successful close is idempotent and closes only this owned handle.
 * @param input File and host-owned opener; no ambient driver is loaded.
 * @returns Durable event log with an owned closer.
 * @throws Original acquisition/schema/prepare failure; cleanup never masks it.
 * @complexity O(1) acquisition calls; subsequent costs are the borrowed adapter's.
 */
export function openSqliteEventLog(
  input: { file: string; open: SqliteSyncOpener },
  options: SqliteEventLogOptions = {},
): SqliteEventLogWithReceipts {
  resolveMaxEntriesPerRun(options.maxEntriesPerRun);
  let db: SqliteDb | undefined;
  try {
    db = openSqliteConnection({ filePath: input.file, open({ filePath }, settings) {
      db = input.open(filePath, settings);
      return db;
    } }, { pragmas: ['journal_mode = WAL'] });
    const log = bindSqliteEventLog(db, options);
    let closed = false;
    return { ...log, async close(_args: Record<string, never>) { if (closed) return;
      closed = true; db!.close(); } };
  } catch (error) {
    try { db?.close(); } catch { /* Preserve the setup failure. */ }
    throw error;
  }
}

/** Binds event-log policies to a borrowed synchronous connection and its atomic transactions. */
function bindSqliteEventLog(db: SqliteDb, options: SqliteEventLogOptions): SqliteEventLogWithReceipts {
  const maxEntriesPerRun = resolveMaxEntriesPerRun(options.maxEntriesPerRun);
  const clock = options.clock ?? createSystemClock();
  if (options.schemaSetup !== 'host') db.exec(SQLITE_EVENT_LOG_SCHEMA);

  const getRunStmt = db.prepare<[string], RunRow>(
    'SELECT run_id, next_cursor FROM jini_event_log_runs WHERE run_id = ?',
  );
  const insertRunStmt = db.prepare<[string, number]>(
    'INSERT INTO jini_event_log_runs (run_id, next_cursor) VALUES (?, ?)',
  );
  const updateNextCursorStmt = db.prepare<[number, string]>(
    'UPDATE jini_event_log_runs SET next_cursor = ? WHERE run_id = ?',
  );
  const getByDedupeStmt = db.prepare<[string, string], EntryRow>(
    'SELECT * FROM jini_event_log_entries WHERE run_id = ? AND dedupe_key = ?',
  );
  const insertEntryStmt = db.prepare<[string, number, string, string, number, string | null]>(
    'INSERT INTO jini_event_log_entries (run_id, cursor, event, data, recorded_at, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const countEntriesStmt = db.prepare<[string], { count: number }>(
    'SELECT COUNT(*) AS count FROM jini_event_log_entries WHERE run_id = ?',
  );
  const evictOldestStmt = db.prepare<[string, string, number]>(`
    DELETE FROM jini_event_log_entries
    WHERE run_id = ? AND cursor IN (
      SELECT cursor FROM jini_event_log_entries WHERE run_id = ? ORDER BY cursor ASC LIMIT ?
    )
  `);
  const selectAllStmt = db.prepare<[string], EntryRow>(
    'SELECT * FROM jini_event_log_entries WHERE run_id = ? ORDER BY cursor ASC',
  );
  const selectAfterStmt = db.prepare<[string, number], EntryRow>(
    'SELECT * FROM jini_event_log_entries WHERE run_id = ? AND cursor > ? ORDER BY cursor ASC',
  );
  const selectOldestStmt = db.prepare<[string], EntryRow>(
    'SELECT * FROM jini_event_log_entries WHERE run_id = ? ORDER BY cursor ASC LIMIT 1',
  );
  const selectRunIdsStmt = db.prepare<[], { run_id: string }>(
    'SELECT run_id FROM jini_event_log_runs ORDER BY run_id ASC',
  );
  const deleteRunEntriesStmt = db.prepare<[string]>(
    'DELETE FROM jini_event_log_entries WHERE run_id = ?',
  );
  const deleteRunStmt = db.prepare<[string]>('DELETE FROM jini_event_log_runs WHERE run_id = ?');

  // `db.transaction()` does not preserve a wrapped callback's own generic parameter (the
  // returned `Transaction` type is non-generic), so this runs on `unknown` payloads and the
  // public `append<Payload>` method below casts at the boundary — the same pattern
  // `createInMemoryEventLog` uses for its dedupe-hit early return.
  const appendTxn = db.transaction(
    (input: EventLogAppendInput<unknown>, options: SqliteEventLogAppendOptions): SqliteEventLogAppendResult<unknown> => {
      if (options.dedupeKey !== undefined) {
        const existing = getByDedupeStmt.get(input.runId, options.dedupeKey);
        if (existing) return existingAppendResult({ row: existing, input }, options);
      }
      if (options.retentionPolicy === 'reject' && countEntriesStmt.get(input.runId)!.count >= maxEntriesPerRun) {
        return { kind: 'capacity-exceeded', maxEntriesPerRun };
      }
      let runRow = getRunStmt.get(input.runId);
      if (!runRow) {
        insertRunStmt.run(input.runId, 1);
        runRow = { run_id: input.runId, next_cursor: 1 };
      }
      const cursor = runRow.next_cursor;
      const recordedAt = clock.nowMs();
      insertEntryStmt.run(
        input.runId, cursor, input.event, JSON.stringify(input.data ?? null), recordedAt, options.dedupeKey ?? null,
      );
      updateNextCursorStmt.run(cursor + 1, input.runId);
      const { count } = countEntriesStmt.get(input.runId)!;
      if (count > maxEntriesPerRun) {
        evictOldestStmt.run(input.runId, input.runId, count - maxEntriesPerRun);
      }
      return { kind: 'inserted', entry: { id: String(cursor), event: input.event, data: input.data, recordedAt } };
    },
  );

  function replaySync(runId: string, afterCursor: string | null): EventLogReplayResult {
    // Validated up front, independent of whether `runId` is known: a malformed cursor is a
    // caller/transport bug regardless of run state, so it throws rather than being folded into
    // (or masked by) an `'unknown-run'`/`'replay-gap'` result.
    assertValidReplayCursor(afterCursor);
    const run = getRunStmt.get(runId);
    if (!run) return { kind: 'unknown-run' };
    const oldest = selectOldestStmt.get(runId);
    const result = replayResult({ run, oldest, afterCursor });
    if (result.kind !== 'ok') return result;
    // Safe: assertValidReplayCursor already proved this parses to a non-negative safe integer.
    const rows = afterCursor === null ? selectAllStmt.all(runId) : selectAfterStmt.all(runId, Number(afterCursor));
    return { ...result, entries: rows.map(rowToEntry) };
  }

  const dropTxn = db.transaction((runId: string) => {
    deleteRunEntriesStmt.run(runId);
    deleteRunStmt.run(runId);
  });

  return {
    async append<Payload>(input: EventLogAppendInput<Payload>, options: EventLogAppendOptions = {}): Promise<EventLogEntry<Payload>> {
      // Forwarding only dedupeKey guarantees an inserted/existing receipt, never a refusal.
      const result = appendTxn(input, options.dedupeKey === undefined ? {} : { dedupeKey: options.dedupeKey }) as { entry: EventLogEntry<Payload> };
      return result.entry;
    },
    async appendWithResult<P>(input: EventLogAppendInput<P>, options: SqliteEventLogAppendOptions = {}): Promise<SqliteEventLogAppendResult<P>> {
      return appendTxn(input, options) as SqliteEventLogAppendResult<P>;
    },
    async replay({ runId, afterCursor }: { runId: string; afterCursor: string | null }): Promise<EventLogReplayResult> {
      return replaySync(runId, afterCursor);
    },
    async listRunIds(_args: Record<string, never>): Promise<readonly string[]> {
      return selectRunIdsStmt.all().map((row) => row.run_id);
    },
    async drop({ runId }: { runId: string }): Promise<void> {
      dropTxn(runId);
    },
    async close(_args: Record<string, never>): Promise<void> {
      // Borrowed handle: the host owns its lifetime.
    },
  };
}
