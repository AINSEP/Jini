/**
 * `MediaTaskStore` — the async task-tracking port for request-now,
 * poll-later media generation. Generalized from OD's
 * `apps/daemon/src/media/tasks.ts`, which is a `better-sqlite3`-coupled,
 * synchronous CRUD module keyed on `projectId` (an OD domain noun) with a
 * hardcoded SQL schema. Per extraction-plan.md §2.6 ("ports are async-only
 * from day one") and the pattern already established by
 * `@jini-ai/daemon`'s `EventLog` (see `packages/daemon/src/event-log.ts`), this
 * is a from-scratch storage-agnostic port + in-memory reference
 * implementation — not a lift — reproducing the same lifecycle semantics
 * (queued → running → done|failed|interrupted, boot-time reconciliation of
 * orphaned in-flight tasks, TTL-based terminal-task pruning) without a SQL
 * schema or an OD project reference. A durable adapter (a future
 * `@jini-ai/sqlite-chat` addition) implements the same interface — see
 * `archived provenance ledger`.
 */

import { applyTaskPatch, assertValidTerminalTtl, buildNewTask, reconcileAction, TERMINAL_STATUSES } from './task-lifecycle.js';

export type MediaTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'interrupted';

function cloneTask(task: MediaTask): MediaTask {
  return {
    ...task,
    progress: [...task.progress],
    file: task.file == null ? null : structuredClone(task.file),
    error: task.error == null ? null : { ...task.error },
  };
}

export interface MediaTaskError {
  readonly message: string;
  readonly status?: number;
  readonly code?: string;
}

/** One tracked media-generation task. `ownerRef` is an opaque host-supplied scoping key (e.g. a run id) — never an OD `projectId`. */
export interface MediaTask {
  readonly id: string;
  readonly ownerRef: string;
  readonly status: MediaTaskStatus;
  readonly surface?: string;
  readonly model?: string;
  readonly progress: readonly string[];
  readonly file: unknown | null;
  readonly error: MediaTaskError | null;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MediaTaskCreateInput {
  readonly id: string;
  readonly ownerRef: string;
  readonly status?: MediaTaskStatus;
  readonly surface?: string;
  readonly model?: string;
  readonly progress?: readonly string[];
  readonly file?: unknown | null;
  readonly error?: MediaTaskError | null;
  readonly startedAt?: number;
}

export interface MediaTaskPatch {
  readonly status?: MediaTaskStatus;
  readonly surface?: string | null;
  readonly model?: string | null;
  readonly progress?: readonly string[];
  readonly file?: unknown | null;
  readonly error?: MediaTaskError | null;
  readonly endedAt?: number | null;
}

export interface MediaTaskListOptions {
  /** Include terminal (done/failed/interrupted) tasks. Defaults to `false` (in-flight only). */
  readonly includeTerminal?: boolean;
}

export interface MediaTaskReconcileOptions {
  /** How long a terminal task is retained before `reconcileOnBoot` deletes it. */
  readonly terminalTtlMs: number;
  /** Injectable clock for deterministic tests; defaults to `Date.now()`. */
  readonly now?: number;
}

export interface MediaTaskReconcileResult {
  readonly interrupted: number;
  readonly deleted: number;
}

/**
 * A replayable, ownerRef-scoped store for async media-generation tasks.
 * `@jini-ai/integrations/media-providers` ships `createInMemoryMediaTaskStore` as the reference
 * implementation; a durable adapter implements the same interface.
 */
export interface MediaTaskStore {
  create(input: MediaTaskCreateInput): Promise<MediaTask>;
  get(id: string): Promise<MediaTask | null>;
  /** Applies `patch` to an existing task and returns the updated row, or `null` if `id` is unknown. */
  update(id: string, patch: MediaTaskPatch): Promise<MediaTask | null>;
  listByOwner(ownerRef: string, options?: MediaTaskListOptions): Promise<MediaTask[]>;
  delete(id: string): Promise<void>;
  /**
   * Boot-time reconciliation: marks every still-`queued`/`running` task
   * `'interrupted'` (a restart mid-flight has no way to resume it) and
   * deletes terminal tasks older than `terminalTtlMs`. Mirrors the origin's
   * `reconcileMediaTasksOnBoot`.
   */
  reconcileOnBoot(options: MediaTaskReconcileOptions): Promise<MediaTaskReconcileResult>;
}

/** Creates the in-memory reference `MediaTaskStore`. No persistence — state is lost on process exit. */
export function createInMemoryMediaTaskStore(): MediaTaskStore {
  const tasks = new Map<string, MediaTask>();

  return {
    async create(input: MediaTaskCreateInput): Promise<MediaTask> {
      if (tasks.has(input.id)) {
        throw new Error(`media task "${input.id}" already exists`);
      }
      const task = buildNewTask(input, Date.now());
      tasks.set(task.id, task);
      return cloneTask(task);
    },

    async get(id: string): Promise<MediaTask | null> {
      const task = tasks.get(id);
      return task ? cloneTask(task) : null;
    },

    async update(id: string, patch: MediaTaskPatch): Promise<MediaTask | null> {
      const existing = tasks.get(id);
      if (!existing) return null;
      const next = applyTaskPatch(existing, patch, Date.now());
      tasks.set(id, next);
      return cloneTask(next);
    },

    async listByOwner(ownerRef: string, options: MediaTaskListOptions = {}): Promise<MediaTask[]> {
      const includeTerminal = options.includeTerminal === true;
      return [...tasks.values()]
        .filter((t) => t.ownerRef === ownerRef)
        .filter((t) => includeTerminal || !TERMINAL_STATUSES.has(t.status))
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(cloneTask);
    },

    async delete(id: string): Promise<void> {
      tasks.delete(id);
    },

    async reconcileOnBoot(options: MediaTaskReconcileOptions): Promise<MediaTaskReconcileResult> {
      assertValidTerminalTtl(options.terminalTtlMs);
      const now = options.now ?? Date.now();
      const cutoff = now - options.terminalTtlMs;
      let interrupted = 0;
      let deleted = 0;
      for (const task of [...tasks.values()]) {
        const action = reconcileAction(task, now, cutoff);
        switch (action.kind) {
          case 'interrupt':
            tasks.set(task.id, action.next);
            interrupted += 1;
            break;
          case 'delete':
            tasks.delete(task.id);
            deleted += 1;
            break;
          default:
            // 'keep': the task stays as it is.
            break;
        }
      }
      return { interrupted, deleted };
    },
  };
}
