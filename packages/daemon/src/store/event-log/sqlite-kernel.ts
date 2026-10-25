/** Async SQLite execution over the host kernel; event-log policy lives in sqlite-policy. */
import { createSystemClock, type Clock } from '@jini-ai/core/primitives';
import type { StorageKernel } from '@jini-ai/db/kernel';
import type { Kysely } from 'kysely';
import type { EventLogAppendInput, EventLogAppendOptions, EventLogEntry, EventLogReplayResult } from '@jini-ai/protocol';
import {
  SQLITE_EVENT_LOG_SCHEMA, resolveMaxEntriesPerRun, assertValidReplayCursor,
  existingAppendResult, replayResult, rowToEntry,
  type SqliteEventLogDatabase, type SqliteEventLogOptions, type SqliteEventLogWithReceipts,
  type SqliteEventLogAppendOptions, type SqliteEventLogAppendResult,
} from './sqlite-policy.js';

type EventDatabase = Kysely<SqliteEventLogDatabase>;

/**
 * Borrow a SQLite kernel, awaiting its readiness and optionally ensuring the owner's schema.
 * Every operation joins the caller's kernel context; append/drop use kernel transactions.
 * Refusals are values: hosts aborting a composed operation must use their exception/rollback path.
 * Close leaves the borrowed kernel open. Driver, readiness and serialization failures propagate.
 * @param required Host kernel with the event-log table subset.
 * @param optional Schema setup, retention cap and clock; defaults match the synchronous adapter.
 * @returns Concrete log with optional conflict/capacity receipts.
 * @complexity Setup uses a fixed number of statements; replay is O(n) in retained entries.
 * @example
 * const log = await createKernelSqliteEventLog({ kernel }, { schemaSetup: 'host' });
 */
export async function createKernelSqliteEventLog<DB extends SqliteEventLogDatabase>(
  required: { kernel: StorageKernel<DB> },
  optional: SqliteEventLogOptions = {},
): Promise<SqliteEventLogWithReceipts> {
  const { kernel } = required;
  const maxEntriesPerRun = resolveMaxEntriesPerRun(optional.maxEntriesPerRun);
  if (!kernel || kernel.dialect !== 'sqlite' || kernel.transport !== 'better-sqlite3') {
    throw new Error('createKernelSqliteEventLog: pass a SQLite better-sqlite3 kernel');
  }
  await kernel.ready;
  // Narrow the query type to required tables; keep the same kernel and its async transaction scope.
  const run = <T>(body: (db: EventDatabase) => Promise<T>): Promise<T> =>
    kernel.run(db => body(db as unknown as EventDatabase));
  await run(db => setupSchema({ db }, optional));
  const clock = optional.clock ?? createSystemClock();
  const appendWithResult = <P>(input: EventLogAppendInput<P>, options: SqliteEventLogAppendOptions = {}): Promise<SqliteEventLogAppendResult<P>> =>
    kernel.transaction(() => run(db => appendInKernel({ db, input, clock, maxEntriesPerRun }, options)));
  return {
    appendWithResult,
    async append<P>(input: EventLogAppendInput<P>, options: EventLogAppendOptions = {}): Promise<EventLogEntry<P>> {
      // Select only the protocol's dedupe option so the legacy method cannot opt into refusal.
      const result = await appendWithResult(input, options.dedupeKey === undefined ? {} : { dedupeKey: options.dedupeKey }) as { entry: EventLogEntry<P> };
      return result.entry;
    },
    async replay({ runId, afterCursor }: { runId: string; afterCursor: string | null }): Promise<EventLogReplayResult> {
      // Validate even when the run is unknown, matching the synchronous adapter.
      assertValidReplayCursor(afterCursor);
      return run(db => replayInKernel({ db, runId, afterCursor }));
    },
    listRunIds(_args: Record<string, never>): Promise<readonly string[]> {
      return run(async db => (await db.selectFrom('jini_event_log_runs').select('run_id')
        .orderBy('run_id').execute()).map(row => row.run_id));
    },
    drop({ runId }: { runId: string }): Promise<void> {
      return kernel.transaction(() => run(async db => {
        await db.deleteFrom('jini_event_log_entries').where('run_id', '=', runId).execute();
        await db.deleteFrom('jini_event_log_runs').where('run_id', '=', runId).execute();
      }));
    },
    async close(_args: Record<string, never>): Promise<void> { /* Borrowed kernel: the host owns its lifetime. */ },
  };
}

/** Ensure using the shared DDL, or validate all required columns without issuing DDL/writes. */
async function setupSchema({ db }: { db: EventDatabase }, options: SqliteEventLogOptions = {}): Promise<void> {
  if (options.schemaSetup !== 'host') {
    // Keep the existing synchronous factory free of a new eager peer import.
    const { sql } = await import('kysely');
    // Kysely executes one statement at a time; the owner DDL contains no embedded semicolons.
    for (const statement of SQLITE_EVENT_LOG_SCHEMA.split(';').filter(part => part.trim())) {
      await sql.raw(statement).execute(db);
    }
  }
  await db.selectFrom('jini_event_log_runs').select(['run_id', 'next_cursor']).limit(0).execute();
  await db.selectFrom('jini_event_log_entries')
    .select(['run_id', 'cursor', 'event', 'data', 'recorded_at', 'dedupe_key']).limit(0).execute();
}

/**
 * Dedupe precedes the cap; refusals allocate nothing. The caller holds a kernel transaction,
 * which serializes SQLite cursor allocation with projection writes and concurrent appends.
 * @complexity Fixed statement count; count/eviction scan the bounded per-run retained rows.
 */
async function appendInKernel<P>(
  { db, input, clock, maxEntriesPerRun }: {
    db: EventDatabase; input: EventLogAppendInput<P>; clock: Clock; maxEntriesPerRun: number;
  },
  options: SqliteEventLogAppendOptions = {},
): Promise<SqliteEventLogAppendResult<P>> {
  if (options.dedupeKey !== undefined) {
    const row = await db.selectFrom('jini_event_log_entries').selectAll()
      .where('run_id', '=', input.runId).where('dedupe_key', '=', options.dedupeKey).executeTakeFirst();
    if (row) return existingAppendResult({ row, input }, options);
  }
  const { count } = await db.selectFrom('jini_event_log_entries')
    .select(db.fn.countAll<number>().as('count')).where('run_id', '=', input.runId).executeTakeFirstOrThrow();
  if (options.retentionPolicy === 'reject' && count >= maxEntriesPerRun) {
    return { kind: 'capacity-exceeded', maxEntriesPerRun };
  }
  let run = await db.selectFrom('jini_event_log_runs').selectAll()
    .where('run_id', '=', input.runId).executeTakeFirst();
  if (!run) {
    run = { run_id: input.runId, next_cursor: 1 };
    await db.insertInto('jini_event_log_runs').values(run).execute();
  }
  const cursor = run.next_cursor;
  const recordedAt = clock.nowMs();
  await db.insertInto('jini_event_log_entries').values({
    run_id: input.runId, cursor, event: input.event, data: JSON.stringify(input.data ?? null),
    recorded_at: recordedAt, dedupe_key: options.dedupeKey ?? null,
  }).execute();
  await db.updateTable('jini_event_log_runs').set({ next_cursor: cursor + 1 })
    .where('run_id', '=', input.runId).execute();
  if (count + 1 > maxEntriesPerRun) {
    await db.deleteFrom('jini_event_log_entries').where('run_id', '=', input.runId)
      .where('cursor', 'in', db.selectFrom('jini_event_log_entries').select('cursor')
        .where('run_id', '=', input.runId).orderBy('cursor').limit(count + 1 - maxEntriesPerRun)).execute();
  }
  return { kind: 'inserted', entry: { id: String(cursor), event: input.event, data: input.data, recordedAt } };
}

/** Decide gaps/truncation first, then read retained rows on the kernel executor. */
async function replayInKernel({ db, runId, afterCursor }: {
  db: EventDatabase; runId: string; afterCursor: string | null;
}): Promise<EventLogReplayResult> {
  const run = await db.selectFrom('jini_event_log_runs').selectAll().where('run_id', '=', runId).executeTakeFirst();
  if (!run) return { kind: 'unknown-run' };
  const oldest = await db.selectFrom('jini_event_log_entries').selectAll().where('run_id', '=', runId)
    .orderBy('cursor').limit(1).executeTakeFirst();
  const result = replayResult({ run, oldest, afterCursor });
  if (result.kind !== 'ok') return result;
  let query = db.selectFrom('jini_event_log_entries').selectAll().where('run_id', '=', runId).orderBy('cursor');
  if (afterCursor !== null) query = query.where('cursor', '>', Number(afterCursor));
  return { ...result, entries: (await query.execute()).map(rowToEntry) };
}
