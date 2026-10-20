/**
 * Storage-agnostic `MediaTask` lifecycle rules shared by every
 * `MediaTaskStore` adapter (`createInMemoryMediaTaskStore` in
 * `task-store.ts`, `createSqliteMediaTaskStore` in `sqlite-task-store.ts`).
 * Each adapter used to carry its own copy of the status sets, the
 * transition graph and the create/patch/reconcile row arithmetic; keeping a
 * single copy here means the two adapters cannot drift apart. Internal to
 * the package (not re-exported from the barrel).
 */
import type {
  MediaTask,
  MediaTaskCreateInput,
  MediaTaskError,
  MediaTaskPatch,
  MediaTaskStatus,
} from './task-store.js';

// CR-013: `assertValidStatus` alone only proves enum membership, not that a
// transition is legal — it allowed e.g. `done` -> `running`. This is the
// actual lifecycle graph the store's own docs claim
// (queued -> running -> done|failed|interrupted); same-state is included so
// a caller can `update()` progress/file without also having to re-derive the
// current status, but nothing can leave a terminal state once reached.
const ALLOWED_TRANSITIONS: Readonly<Record<MediaTaskStatus, ReadonlySet<MediaTaskStatus>>> = {
  // `queued` may go straight to a terminal state too (a caller isn't
  // required to make a separate "now running" update before finishing).
  queued: new Set(['queued', 'running', 'done', 'failed', 'interrupted']),
  running: new Set(['running', 'done', 'failed', 'interrupted']),
  done: new Set(['done']),
  failed: new Set(['failed']),
  interrupted: new Set(['interrupted']),
};

const VALID_STATUSES: ReadonlySet<string> = new Set(Object.keys(ALLOWED_TRANSITIONS));

export const TERMINAL_STATUSES: ReadonlySet<MediaTaskStatus> = new Set(['done', 'failed', 'interrupted']);

const INTERRUPTED_ERROR: MediaTaskError = {
  message: 'media task interrupted by daemon restart',
  code: 'DAEMON_RESTART',
};

function assertValidStatus(status: MediaTaskStatus): void {
  if (!VALID_STATUSES.has(status)) {
    throw new RangeError(`Invalid media task status: "${status}"`);
  }
}

function snapshotFile(file: unknown): unknown | null {
  return file == null ? null : structuredClone(file);
}

function snapshotError(error: MediaTaskError | null | undefined): MediaTaskError | null {
  return error == null ? null : { ...error };
}

/**
 * `surface`/`model` are conditionally spread — this package's
 * `exactOptionalPropertyTypes: true` tsconfig rejects assigning `undefined`
 * to an optional field, so a task without a `surface`/`model` has no key at
 * all, not a key set to `undefined`.
 */
function labelFields(surface: string | undefined, model: string | undefined): Pick<MediaTask, 'surface' | 'model'> {
  return {
    ...(surface !== undefined ? { surface } : {}),
    ...(model !== undefined ? { model } : {}),
  };
}

/** Builds the stored row for `create()`; the caller checks for a duplicate id first. */
export function buildNewTask(input: MediaTaskCreateInput, now: number): MediaTask {
  const status = input.status ?? 'queued';
  assertValidStatus(status);
  return {
    id: input.id,
    ownerRef: input.ownerRef,
    status,
    progress: input.progress ? [...input.progress] : [],
    file: snapshotFile(input.file),
    error: snapshotError(input.error),
    startedAt: input.startedAt ?? now,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
    ...labelFields(input.surface, input.model),
  };
}

/** A key present in the patch (even as `null`/`undefined`) replaces the stored value; an absent key keeps it. */
function patchedLabels(existing: MediaTask, patch: MediaTaskPatch): Pick<MediaTask, 'surface' | 'model'> {
  const surface = 'surface' in patch ? (patch.surface ?? undefined) : existing.surface;
  const model = 'model' in patch ? (patch.model ?? undefined) : existing.model;
  return labelFields(surface, model);
}

function patchedPayload(existing: MediaTask, patch: MediaTaskPatch): Pick<MediaTask, 'progress' | 'file' | 'error' | 'endedAt'> {
  return {
    progress: patch.progress ? [...patch.progress] : existing.progress,
    file: 'file' in patch ? snapshotFile(patch.file) : existing.file,
    error: 'error' in patch ? snapshotError(patch.error) : existing.error,
    endedAt: 'endedAt' in patch ? (patch.endedAt ?? null) : existing.endedAt,
  };
}

/** Validates `patch` against `existing` (status enum, then transition graph) and returns the next stored row. */
export function applyTaskPatch(existing: MediaTask, patch: MediaTaskPatch, now: number): MediaTask {
  const status = patch.status ?? existing.status;
  assertValidStatus(status);
  // CR-013: enum membership alone doesn't prove the transition is legal
  // (e.g. `done` -> `running`) — check the actual lifecycle graph too.
  if (!ALLOWED_TRANSITIONS[existing.status].has(status)) {
    throw new RangeError(`Invalid media task transition: "${existing.status}" -> "${status}"`);
  }
  const payload = patchedPayload(existing, patch);
  return {
    id: existing.id,
    ownerRef: existing.ownerRef,
    status,
    progress: payload.progress,
    file: payload.file,
    error: payload.error,
    startedAt: existing.startedAt,
    endedAt: payload.endedAt,
    createdAt: existing.createdAt,
    updatedAt: now,
    ...patchedLabels(existing, patch),
  };
}

export function assertValidTerminalTtl(terminalTtlMs: number): void {
  if (!Number.isFinite(terminalTtlMs) || terminalTtlMs < 0) {
    throw new RangeError(`Invalid terminalTtlMs: ${terminalTtlMs} must be a non-negative finite number`);
  }
}

/** What boot-time reconciliation does to one stored task. */
export type ReconcileAction =
  | { readonly kind: 'interrupt'; readonly next: MediaTask }
  | { readonly kind: 'delete' }
  | { readonly kind: 'keep' };

/**
 * A restart mid-flight has no way to resume a `queued`/`running` task, so it
 * becomes `interrupted` (keeping an already-set `endedAt`); a terminal task
 * whose `endedAt` (or, failing that, `updatedAt`) is older than `cutoff` is
 * deleted. A task interrupted in this pass is never also deleted in it.
 */
export function reconcileAction(task: MediaTask, now: number, cutoff: number): ReconcileAction {
  if (task.status === 'queued' || task.status === 'running') {
    return {
      kind: 'interrupt',
      next: { ...task, status: 'interrupted', error: INTERRUPTED_ERROR, endedAt: task.endedAt ?? now, updatedAt: now },
    };
  }
  if (TERMINAL_STATUSES.has(task.status) && (task.endedAt ?? task.updatedAt) < cutoff) {
    return { kind: 'delete' };
  }
  return { kind: 'keep' };
}
