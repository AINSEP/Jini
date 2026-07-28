/**
 * `createSqliteMediaTaskStore` — the durable `MediaTaskStore` adapter
 * (added 2026-07-21, per the task brief's "durable task adapter" ask: many
 * ported vendors are async submit-then-poll jobs, so a job's state must
 * survive a process restart).
 *
 * Reuses this repo's existing durability pattern exactly —
 * `packages/sqlite/src/event-log.ts`'s `createSqliteEventLog`, the durable
 * adapter for `@jini-ai/daemon`'s `EventLog` port — rather than inventing a
 * parallel one: `new Database(dbPath)`, `db.pragma('journal_mode = WAL')`,
 * `CREATE TABLE IF NOT EXISTS` (idempotent — reopening the same file
 * resumes from whatever was durably committed), `db.transaction()` for
 * atomic multi-statement writes, every public method still `Promise`-
 * returning despite `better-sqlite3` being fully synchronous under the
 * hood (extraction-plan.md §2.6: "ports are async-only from day one... a
 * real persistent adapter is a drop-in swap"), and a `close(): Promise<void>`
 * addition beyond the port interface to release the file handle — the same
 * shape `SqliteEventLog extends EventLog` already established.
 *
 * **Why this lives in `@jini-ai/media` itself, not `@jini-ai/sqlite`** (the
 * "natural" home per the `EventLog` precedent, where the durable adapter
 * lives in a separate package from the port it implements): `@jini-ai/sqlite`
 * is one of `scripts/check-engine-boundaries.ts`'s 14 *locked* packages;
 * `@jini-ai/media` is listed in `UNLOCKED.md` with `status: "incubating"`.
 * `check-engine-boundaries.ts`'s R7 rule forbids a locked package from
 * importing an unlocked, non-`"stable"` one — `@jini-ai/sqlite` depending on
 * `@jini-ai/media` for `MediaTaskStore`'s types would fail `pnpm guard`
 * outright. Implementing the adapter inside `@jini-ai/media` (itself
 * unlocked, so unrestricted in what it may depend on) keeps the exact same
 * schema/transaction/WAL/`close()` conventions without a guard violation.
 * See `ADS-memory/reports/proposals/PROP-media-durable-tasks-2026-07-21.md`
 * for the open question of whether this should move to `@jini-ai/sqlite` once
 * `@jini-ai/media` is promoted to `"stable"`.
 *
 * Implements `task-store.ts`'s `MediaTaskStore` port exactly: same
 * `queued -> running -> done|failed|interrupted` transition legality
 * (`ALLOWED_TRANSITIONS`), same duplicate-id rejection, same
 * `listByOwner` terminal-status filtering, same `reconcileOnBoot`
 * two-phase boot reconciliation. See `createInMemoryMediaTaskStore` in
 * `task-store.ts` for the reference behavior this mirrors.
 */
import Database from 'better-sqlite3';
import type {
  MediaTask,
  MediaTaskCreateInput,
  MediaTaskError,
  MediaTaskListOptions,
  MediaTaskPatch,
  MediaTaskReconcileOptions,
  MediaTaskReconcileResult,
  MediaTaskStatus,
  MediaTaskStore,
} from './task-store.js';

const VALID_STATUSES: ReadonlySet<MediaTaskStatus> = new Set([
  'queued',
  'running',
  'done',
  'failed',
  'interrupted',
]);
const TERMINAL_STATUSES: ReadonlySet<MediaTaskStatus> = new Set(['done', 'failed', 'interrupted']);

// Mirrors task-store.ts's own ALLOWED_TRANSITIONS exactly (CR-013: enum
// membership alone doesn't prove a transition is legal, e.g. done -> running).
const ALLOWED_TRANSITIONS: Readonly<Record<MediaTaskStatus, ReadonlySet<MediaTaskStatus>>> = {
  queued: new Set(['queued', 'running', 'done', 'failed', 'interrupted']),
  running: new Set(['running', 'done', 'failed', 'interrupted']),
  done: new Set(['done']),
  failed: new Set(['failed']),
  interrupted: new Set(['interrupted']),
};

const INTERRUPTED_ERROR: MediaTaskError = {
  message: 'media task interrupted by daemon restart',
  code: 'DAEMON_RESTART',
};

function assertValidStatus(status: MediaTaskStatus): void {
  if (!VALID_STATUSES.has(status)) {
    throw new RangeError(`Invalid media task status: "${status}"`);
  }
}

interface TaskRow {
  id: string;
  owner_ref: string;
  status: string;
  surface: string | null;
  model: string | null;
  progress: string;
  file: string | null;
  error: string | null;
  started_at: number;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * Reconstructs a `MediaTask` from a stored row. `surface`/`model` are
 * conditionally spread — matching `task-store.ts`'s own in-memory adapter,
 * which never assigns `undefined` to an optional field (this package's
 * `exactOptionalPropertyTypes: true` tsconfig would reject that) — a task
 * created without a `surface`/`model` has no key at all, not a key set to
 * `undefined`.
 */
function rowToTask(row: TaskRow): MediaTask {
  return {
    id: row.id,
    ownerRef: row.owner_ref,
    status: row.status as MediaTaskStatus,
    progress: JSON.parse(row.progress) as readonly string[],
    file: row.file === null ? null : (JSON.parse(row.file) as unknown),
    error: row.error === null ? null : (JSON.parse(row.error) as MediaTaskError),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.surface !== null ? { surface: row.surface } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
  };
}

/** A `MediaTaskStore` backed by a `better-sqlite3` database, plus a `close()` to release the file handle. */
export interface SqliteMediaTaskStore extends MediaTaskStore {
  close(): Promise<void>;
}

/**
 * Opens (creating if absent) a `better-sqlite3` database at `dbPath` and
 * returns a `MediaTaskStore` backed by it. Pass `':memory:'` for a
 * non-durable in-process database (useful in tests that want SQL semantics
 * without a file). Schema creation is idempotent (`CREATE TABLE IF NOT
 * EXISTS`), so re-opening the same file resumes from whatever was durably
 * committed — this is what makes an in-flight job's state survive a
 * process restart: a fresh `createSqliteMediaTaskStore(dbPath)` call after
 * the process comes back up sees every task exactly as it was left, and
 * `reconcileOnBoot` can then mark anything still `queued`/`running` as
 * `interrupted`.
 */
export function createSqliteMediaTaskStore(dbPath: string): SqliteMediaTaskStore {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS jini_media_tasks (
      id TEXT PRIMARY KEY,
      owner_ref TEXT NOT NULL,
      status TEXT NOT NULL,
      surface TEXT,
      model TEXT,
      progress TEXT NOT NULL,
      file TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jini_media_tasks_owner
      ON jini_media_tasks (owner_ref, status);
  `);

  const getStmt = db.prepare<[string], TaskRow>('SELECT * FROM jini_media_tasks WHERE id = ?');
  const insertStmt = db.prepare<
    [string, string, string, string | null, string | null, string, string | null, string | null, number, number | null, number, number]
  >(`
    INSERT INTO jini_media_tasks
      (id, owner_ref, status, surface, model, progress, file, error, started_at, ended_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare<
    [string, string | null, string | null, string, string | null, string | null, number | null, number, string]
  >(`
    UPDATE jini_media_tasks
    SET status = ?, surface = ?, model = ?, progress = ?, file = ?, error = ?, ended_at = ?, updated_at = ?
    WHERE id = ?
  `);
  const deleteStmt = db.prepare<[string]>('DELETE FROM jini_media_tasks WHERE id = ?');
  const listAllForOwnerStmt = db.prepare<[string], TaskRow>(
    'SELECT * FROM jini_media_tasks WHERE owner_ref = ? ORDER BY started_at DESC',
  );
  const listInFlightForOwnerStmt = db.prepare<[string], TaskRow>(
    `SELECT * FROM jini_media_tasks WHERE owner_ref = ? AND status NOT IN ('done', 'failed', 'interrupted') ORDER BY started_at DESC`,
  );
  const selectAllStmt = db.prepare<[], TaskRow>('SELECT * FROM jini_media_tasks');

  function writeRow(task: MediaTask, isInsert: boolean): void {
    const progressJson = JSON.stringify(task.progress);
    const fileJson = task.file == null ? null : JSON.stringify(task.file);
    const errorJson = task.error == null ? null : JSON.stringify(task.error);
    const surface = task.surface ?? null;
    const model = task.model ?? null;
    if (isInsert) {
      insertStmt.run(
        task.id,
        task.ownerRef,
        task.status,
        surface,
        model,
        progressJson,
        fileJson,
        errorJson,
        task.startedAt,
        task.endedAt,
        task.createdAt,
        task.updatedAt,
      );
    } else {
      updateStmt.run(task.status, surface, model, progressJson, fileJson, errorJson, task.endedAt, task.updatedAt, task.id);
    }
  }

  const createTxn = db.transaction((input: MediaTaskCreateInput): MediaTask => {
    if (getStmt.get(input.id)) {
      throw new Error(`media task "${input.id}" already exists`);
    }
    const status = input.status ?? 'queued';
    assertValidStatus(status);
    const now = Date.now();
    const startedAt = input.startedAt ?? now;
    const task: MediaTask = {
      id: input.id,
      ownerRef: input.ownerRef,
      status,
      progress: input.progress ? [...input.progress] : [],
      file: input.file == null ? null : (structuredClone(input.file) as unknown),
      error: input.error == null ? null : { ...input.error },
      startedAt,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
      ...(input.surface !== undefined ? { surface: input.surface } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
    };
    writeRow(task, true);
    return task;
  });

  const updateTxn = db.transaction((id: string, patch: MediaTaskPatch): MediaTask | null => {
    const row = getStmt.get(id);
    if (!row) return null;
    const existing = rowToTask(row);
    const status = patch.status ?? existing.status;
    assertValidStatus(status);
    if (!ALLOWED_TRANSITIONS[existing.status].has(status)) {
      throw new RangeError(`Invalid media task transition: "${existing.status}" -> "${status}"`);
    }
    const surface = 'surface' in patch ? (patch.surface ?? undefined) : existing.surface;
    const model = 'model' in patch ? (patch.model ?? undefined) : existing.model;
    const next: MediaTask = {
      id: existing.id,
      ownerRef: existing.ownerRef,
      status,
      progress: patch.progress ? [...patch.progress] : existing.progress,
      file: 'file' in patch ? (patch.file == null ? null : (structuredClone(patch.file) as unknown)) : existing.file,
      error: 'error' in patch ? (patch.error == null ? null : { ...patch.error }) : existing.error,
      startedAt: existing.startedAt,
      endedAt: 'endedAt' in patch ? (patch.endedAt ?? null) : existing.endedAt,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
      ...(surface !== undefined ? { surface } : {}),
      ...(model !== undefined ? { model } : {}),
    };
    writeRow(next, false);
    return next;
  });

  const reconcileTxn = db.transaction((options: MediaTaskReconcileOptions): MediaTaskReconcileResult => {
    const now = options.now ?? Date.now();
    const cutoff = now - options.terminalTtlMs;
    let interrupted = 0;
    let deleted = 0;
    for (const row of selectAllStmt.all()) {
      const task = rowToTask(row);
      if (task.status === 'queued' || task.status === 'running') {
        const next: MediaTask = {
          ...task,
          status: 'interrupted',
          error: INTERRUPTED_ERROR,
          endedAt: task.endedAt ?? now,
          updatedAt: now,
        };
        writeRow(next, false);
        interrupted += 1;
        continue;
      }
      if (TERMINAL_STATUSES.has(task.status) && (task.endedAt ?? task.updatedAt) < cutoff) {
        deleteStmt.run(task.id);
        deleted += 1;
      }
    }
    return { interrupted, deleted };
  });

  return {
    async create(input: MediaTaskCreateInput): Promise<MediaTask> {
      return createTxn(input);
    },

    async get(id: string): Promise<MediaTask | null> {
      const row = getStmt.get(id);
      return row ? rowToTask(row) : null;
    },

    async update(id: string, patch: MediaTaskPatch): Promise<MediaTask | null> {
      return updateTxn(id, patch);
    },

    async listByOwner(ownerRef: string, options: MediaTaskListOptions = {}): Promise<MediaTask[]> {
      const includeTerminal = options.includeTerminal === true;
      const rows = includeTerminal ? listAllForOwnerStmt.all(ownerRef) : listInFlightForOwnerStmt.all(ownerRef);
      return rows.map(rowToTask);
    },

    async delete(id: string): Promise<void> {
      deleteStmt.run(id);
    },

    async reconcileOnBoot(options: MediaTaskReconcileOptions): Promise<MediaTaskReconcileResult> {
      if (!Number.isFinite(options.terminalTtlMs) || options.terminalTtlMs < 0) {
        throw new RangeError(`Invalid terminalTtlMs: ${options.terminalTtlMs} must be a non-negative finite number`);
      }
      return reconcileTxn(options);
    },

    async close(): Promise<void> {
      db.close();
    },
  };
}
