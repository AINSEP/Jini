import { createSystemClock, type Clock } from '@jini-ai/core/primitives';
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
  EventLog,
  EventLogAppendInput,
  EventLogAppendOptions,
  EventLogEntry,
  EventLogReplayResult,
} from '@jini-ai/protocol';

/**
 * Default per-run retention cap applied when `SqliteEventLogOptions.maxEntriesPerRun` is
 * omitted — see that option's doc for why a durable adapter defaults to a bound instead of
 * mirroring the in-memory reference adapter's unbounded-by-default behavior.
 */
export const DEFAULT_MAX_ENTRIES_PER_RUN = 2000;

export interface SqliteEventLogOptions {
  /**
   * Maximum entries retained per run before the oldest are evicted. Defaults to
   * {@link DEFAULT_MAX_ENTRIES_PER_RUN} (2000) when omitted — unlike the in-memory reference
   * adapter (`@jini-ai/daemon`'s `createInMemoryEventLog`), where an omitted cap means unbounded,
   * a durable on-disk store defaults to a bounded retention window because unbounded persistent
   * growth is a real, unattended operational risk (disk exhaustion across long-lived runs) in a
   * way an in-process, GC'd, process-lifetime-bounded structure is not. Pass an explicit value
   * (larger, smaller, or `0`) to override the default in either direction — the caller then
   * owns that tradeoff explicitly. Must be a non-negative safe integer; anything else (negative,
   * fractional, `NaN`, `Infinity`) throws at construction time.
   */
  readonly maxEntriesPerRun?: number;
  /** Core Clock for durable recordedAt values; omitted clock preserves system wall time. */
  readonly clock?: Clock;
}

/** @internal Validates and resolves `options.maxEntriesPerRun`, applying the documented default. */
function resolveMaxEntriesPerRun(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ENTRIES_PER_RUN;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `createSqliteEventLog: options.maxEntriesPerRun must be a non-negative safe integer, got ${value}`,
    );
  }
  return value;
}

/** @internal Validates a `replay(runId, afterCursor)` cursor. `null` ("from the beginning") is always valid. */
function assertValidReplayCursor(afterCursor: string | null): void {
  if (afterCursor === null) return;
  const n = Number(afterCursor);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(
      `createSqliteEventLog: invalid replay cursor ${JSON.stringify(afterCursor)} — must be a non-negative safe integer string`,
    );
  }
}

/** A `@jini-ai/daemon` `EventLog` backed by a `better-sqlite3` database, plus a `close()` to release the file handle. */
export interface SqliteEventLog extends EventLog {
  close(_args: Record<string, never>): Promise<void>;
}

interface RunRow {
  run_id: string;
  // Keep the counter independently of retained entries and persist its bump with the insert.
  // MAX(cursor) + 1 would reuse cursors once eviction removes every retained entry.
  next_cursor: number;
}

interface EntryRow {
  run_id: string;
  cursor: number;
  event: string;
  // Durable payloads cross a JSON TEXT boundary, unlike the in-memory log's live references.
  // Callers must supply JSON-safe values: object undefined/functions and Map/Set do not round-trip.
  data: string;
  recorded_at: number;
  dedupe_key: string | null;
}

function rowToEntry(row: EntryRow): EventLogEntry {
  return {
    id: String(row.cursor),
    event: row.event,
    data: JSON.parse(row.data) as unknown,
    recordedAt: row.recorded_at,
  };
}

/**
 * Borrows the caller's connection and ensures the dedicated event-log schema idempotently.
 * Closing this adapter never closes a borrowed handle or changes its pragmas.
 * Use openSqliteEventLog with an explicit file/opener to acquire an owned connection.
 * @throws Host SQL/setup failures, or a missing borrowed connection.
 * @complexity Setup O(1) statements; append costs depend on the retained per-run cap.
 */
export function createSqliteEventLog(
  input: { db: SqliteDb },
  options: SqliteEventLogOptions = {},
): SqliteEventLog {
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
): SqliteEventLog {
  resolveMaxEntriesPerRun(options.maxEntriesPerRun);
  let db: SqliteDb | undefined;
  try {
    db = openSqliteConnection({ filePath: input.file, open(file, settings) {
      db = input.open(file, settings);
      return db;
    }, pragmas: ['journal_mode = WAL'] });
    const log = bindSqliteEventLog(db, options);
    let closed = false;
    return { ...log, async close(_args: Record<string, never>) { if (closed) return; closed = true; db!.close(); } };
  } catch (error) {
    try { db?.close(); } catch { /* Preserve the setup failure. */ }
    throw error;
  }
}

/** Binds the unchanged cursor/dedupe/retention SQL to a borrowed synchronous connection. */
function bindSqliteEventLog(db: SqliteDb, options: SqliteEventLogOptions): SqliteEventLog {
  const maxEntriesPerRun = resolveMaxEntriesPerRun(options.maxEntriesPerRun);
  const clock = options.clock ?? createSystemClock();
  db.exec(`
    CREATE TABLE IF NOT EXISTS jini_event_log_runs (
      run_id TEXT PRIMARY KEY,
      next_cursor INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jini_event_log_entries (
      run_id TEXT NOT NULL,
      cursor INTEGER NOT NULL,
      event TEXT NOT NULL,
      data TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      dedupe_key TEXT,
      PRIMARY KEY (run_id, cursor)
    );

    CREATE INDEX IF NOT EXISTS idx_jini_event_log_entries_dedupe
      ON jini_event_log_entries (run_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL;
  `);

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
    (input: EventLogAppendInput<unknown> & EventLogAppendOptions): EventLogEntry<unknown> => {
      let runRow = getRunStmt.get(input.runId);
      if (!runRow) {
        insertRunStmt.run(input.runId, 1);
        runRow = { run_id: input.runId, next_cursor: 1 };
      }
      if (input.dedupeKey !== undefined) {
        const existing = getByDedupeStmt.get(input.runId, input.dedupeKey);
        if (existing) {
          return rowToEntry(existing);
        }
      }
      const cursor = runRow.next_cursor;
      const recordedAt = clock.nowMs();
      insertEntryStmt.run(
        input.runId,
        cursor,
        input.event,
        JSON.stringify(input.data ?? null),
        recordedAt,
        input.dedupeKey ?? null,
      );
      updateNextCursorStmt.run(cursor + 1, input.runId);

      const { count } = countEntriesStmt.get(input.runId)!;
      if (count > maxEntriesPerRun) {
        evictOldestStmt.run(input.runId, input.runId, count - maxEntriesPerRun);
      }

      return {
        id: String(cursor),
        event: input.event,
        data: input.data,
        recordedAt,
      };
    },
  );

  function replaySync(runId: string, afterCursor: string | null): EventLogReplayResult {
    // Validated up front, independent of whether `runId` is known: a malformed cursor is a
    // caller/transport bug regardless of run state, so it throws rather than being folded into
    // (or masked by) an `'unknown-run'`/`'replay-gap'` result.
    assertValidReplayCursor(afterCursor);
    const runRow = getRunStmt.get(runId);
    if (!runRow) {
      return { kind: 'unknown-run' };
    }
    if (afterCursor === null) {
      const oldestRow = selectOldestStmt.get(runId);
      const truncated = oldestRow !== undefined && oldestRow.cursor > 1;
      return {
        kind: 'ok',
        entries: selectAllStmt.all(runId).map(rowToEntry),
        ...(truncated ? { truncated: true as const } : {}),
      };
    }
    // Safe: assertValidReplayCursor already proved this parses to a non-negative safe integer.
    const afterCursorNum = Number(afterCursor);
    const oldestRow = selectOldestStmt.get(runId);
    const oldestRetainedId = oldestRow ? oldestRow.cursor : runRow.next_cursor;
    if (afterCursorNum < oldestRetainedId - 1) {
      return {
        kind: 'replay-gap',
        requestedCursor: afterCursor,
        oldestAvailableCursor: oldestRow ? String(oldestRow.cursor) : null,
      };
    }
    return {
      kind: 'ok',
      entries: selectAfterStmt.all(runId, afterCursorNum).map(rowToEntry),
    };
  }

  const dropTxn = db.transaction((runId: string) => {
    deleteRunEntriesStmt.run(runId);
    deleteRunStmt.run(runId);
  });

  return {
    async append<Payload>(input: EventLogAppendInput<Payload>, options: EventLogAppendOptions = {}): Promise<EventLogEntry<Payload>> {
      return appendTxn({ ...input, dedupeKey: options.dedupeKey } as EventLogAppendInput<unknown> & EventLogAppendOptions) as EventLogEntry<Payload>;
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
