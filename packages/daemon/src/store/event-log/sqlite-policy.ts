/** Shared event-log schema and policies; synchronous and kernel execution retain distinct transactions. */
import type { Clock } from '@jini-ai/core/primitives';
import type { EventLog, EventLogAppendInput, EventLogAppendOptions, EventLogEntry, EventLogReplayResult } from '@jini-ai/protocol';

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
  /** Ensure tables by default; host skips DDL and requires an already migrated schema. */
  readonly schemaSetup?: 'ensure' | 'host';
}

/** @internal Validates and resolves `options.maxEntriesPerRun`, applying the documented default. */
export function resolveMaxEntriesPerRun(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ENTRIES_PER_RUN;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `createSqliteEventLog: options.maxEntriesPerRun must be a non-negative safe integer, got ${value}`,
    );
  }
  return value;
}

/** @internal Validates a `replay(runId, afterCursor)` cursor. `null` ("from the beginning") is always valid. */
export function assertValidReplayCursor(afterCursor: string | null): void {
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

export interface RunRow {
  run_id: string;
  // Keep the counter independently of retained entries and persist its bump with the insert.
  // MAX(cursor) + 1 would reuse cursors once eviction removes every retained entry.
  next_cursor: number;
}

export interface EntryRow {
  run_id: string;
  cursor: number;
  event: string;
  // Durable payloads cross a JSON TEXT boundary, unlike the in-memory log's live references.
  // Callers must supply JSON-safe values: object undefined/functions and Map/Set do not round-trip.
  data: string;
  recorded_at: number;
  dedupe_key: string | null;
}

/** Decode the persisted JSON boundary while preserving the original cursor and timestamp. */
export function rowToEntry(row: EntryRow): EventLogEntry {
  return {
    id: String(row.cursor),
    event: row.event,
    data: JSON.parse(row.data) as unknown,
    recordedAt: row.recorded_at,
  };
}

/** The existing event-log tables; hosts may extend this database with their own tables. */
export interface SqliteEventLogDatabase {
  jini_event_log_runs: RunRow;
  jini_event_log_entries: EntryRow;
}

/** Opt-in append policies; omitted options preserve legacy dedupe and FIFO retention. */
export type SqliteEventLogAppendOptions = EventLogAppendOptions & {
  detectConflicts?: boolean;
  retentionPolicy?: 'evict-oldest' | 'reject';
};

/** Refusals carry no entry because no write or cursor allocation took place. */
export type SqliteEventLogAppendResult<P> =
  | { kind: 'inserted' | 'existing'; entry: EventLogEntry<P> }
  | { kind: 'conflict' }
  | { kind: 'capacity-exceeded'; maxEntriesPerRun: number };

/** Concrete factories expose receipts without widening the protocol's append return type. */
export interface SqliteEventLogWithReceipts extends SqliteEventLog {
  /**
   * Compare exact persisted JSON only when detectConflicts is true; dedupe precedes capacity.
   * SQL/serialization failures reject. Conflicts/capacity refusals leave all state untouched.
   * @example
   * await log.appendWithResult({ runId: 'r', event: 'update', data: 1 }, { dedupeKey: 'k', detectConflicts: true });
   */
  appendWithResult<P>(
    required: EventLogAppendInput<P>,
    optional?: SqliteEventLogAppendOptions,
  ): Promise<SqliteEventLogAppendResult<P>>;
}

/** Resolve an existing row without writes; legacy retries do not serialize the new payload. */
export function existingAppendResult<P>(
  { row, input }: { row: EntryRow; input: EventLogAppendInput<P> },
  options: SqliteEventLogAppendOptions = {},
): SqliteEventLogAppendResult<P> {
  if (options.detectConflicts && (row.event !== input.event || row.data !== JSON.stringify(input.data ?? null))) {
    return { kind: 'conflict' };
  }
  return { kind: 'existing', entry: rowToEntry(row) as EventLogEntry<P> };
}

/** Decide replay status before loading payloads, keeping a replay gap to indexed lookups only. */
export function replayResult({ run, oldest, afterCursor }: {
  run: RunRow;
  oldest: EntryRow | undefined;
  afterCursor: string | null;
}): EventLogReplayResult {
  if (afterCursor === null) {
    const truncated = oldest !== undefined && oldest.cursor > 1;
    return { kind: 'ok', entries: [], ...(truncated ? { truncated: true as const } : {}) };
  }
  const oldestRetainedId = oldest ? oldest.cursor : run.next_cursor;
  if (Number(afterCursor) < oldestRetainedId - 1) {
    return { kind: 'replay-gap', requestedCursor: afterCursor, oldestAvailableCursor: oldest ? String(oldest.cursor) : null };
  }
  return { kind: 'ok', entries: [] };
}

/** Owner's DDL for both automatic setup and host-managed migrations; no schema fork. */
export const SQLITE_EVENT_LOG_SCHEMA: string = `
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
`;
