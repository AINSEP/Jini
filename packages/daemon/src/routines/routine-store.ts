/**
 * `RoutineStore` — the CRUD + run-history persistence port for `@jini-ai/http-kit`'s routine routes.
 * Designed the same way `../event-log.js`'s `EventLog` is designed (that module's own doc
 * comment is the explicit template named by the porting proposal,
 * `ADS-memory/reports/proposals/PROP-http-route-packs-automation-routines-2026-07-21.md`): a
 * storage-agnostic interface plus an in-memory reference implementation, async-only from day one
 * (extraction-plan §2.6) so a durable `@jini-ai/sqlite` adapter is a drop-in swap later without an
 * API break.
 *
 * No such port existed anywhere in this repo before this file — OD's own `routine.ts` route file
 * called eight raw `db.js` SQL functions directly (`getRoutine`/`insertRoutine`/`updateRoutine`/
 * `deleteRoutine`/`listRoutines`/`listRoutineRuns`/`getLatestRoutineRun`/`getRoutineRun`) against
 * `routines`/`routine_runs` tables that `packages/sqlite/source-map.md` already documents as
 * explicitly out of scope for the db-barrel port. This is the missing design.
 *
 * **Deliberately separate from `./scheduler.js`'s `RoutinePersistence`, not a shared interface**,
 * matching OD's own architecture: OD itself used two different narrow ports over the same
 * conceptual `routine_runs` table — `RoutinePersistence.insertRun`/`updateRun` (injected into
 * `RoutineService`, the scheduler's write path for a routine actually firing) and `routine.ts`'s
 * own direct DB reads (the HTTP layer's read path for CRUD + run-history display). This port
 * mirrors that same split: `RoutineStore` owns Routine CRUD and *read-only* run history
 * (`listRuns`/`getLatestRun`); it does not write run records — that stays the scheduler's job via
 * its own separately-injected `RoutinePersistence`. A host wiring both together against one real
 * durable table (a future `@jini-ai/sqlite` adapter) is host-level integration wiring, the same way
 * `runs.ts`'s `onStarted` driver is host-supplied rather than built into `RunLifecycle` itself —
 * not attempted here, out of this port's scope.
 */
import { randomUUID } from 'node:crypto';
import type { Routine, RoutineContextSelection, RoutineProjectTarget, RoutineRun, RoutineSchedule } from './types.js';

export interface RoutineCreateInput {
  readonly name: string;
  readonly prompt: string;
  readonly schedule: RoutineSchedule;
  readonly target: RoutineProjectTarget;
  readonly skillId?: string | null;
  readonly agentId?: string | null;
  readonly context?: RoutineContextSelection;
  /** @default true */
  readonly enabled?: boolean;
}

export interface RoutineUpdateInput {
  readonly name?: string;
  readonly prompt?: string;
  readonly schedule?: RoutineSchedule;
  readonly target?: RoutineProjectTarget;
  readonly skillId?: string | null;
  readonly agentId?: string | null;
  readonly context?: RoutineContextSelection;
  readonly enabled?: boolean;
}

/**
 * Storage-agnostic CRUD + read-only run-history port for routines. `@jini-ai/daemon` ships
 * {@link createInMemoryRoutineStore} as the reference implementation; a durable adapter
 * (`@jini-ai/sqlite`, future work) implements the same interface.
 */
export interface RoutineStore {
  list(): Promise<readonly Routine[]>;
  /** Returns `null` when no routine with `id` exists — never throws for a missing id. */
  get(id: string): Promise<Routine | null>;
  /** Assigns and returns the new routine's `id` — never supplied by the caller, matching `EventLog.append`'s cursor-assignment precedent. */
  create(input: RoutineCreateInput): Promise<Routine>;
  /** Applies a partial patch and returns the updated routine, or `null` if `id` does not exist. */
  update(id: string, patch: RoutineUpdateInput): Promise<Routine | null>;
  /** Returns whether a routine with `id` existed (and was removed). */
  delete(id: string): Promise<boolean>;
  /** Returns up to `limit` runs for `routineId`, newest first. Returns `[]` for an unknown routine rather than throwing — mirrors `list()`'s empty-collection convention. */
  listRuns(routineId: string, limit: number): Promise<readonly RoutineRun[]>;
  /** Returns the most recently started run for `routineId`, or `null` if none has ever run. */
  getLatestRun(routineId: string): Promise<RoutineRun | null>;
}

/**
 * The display-shaped run summary OD's own `routineDbRowToContract` embedded on `Routine.lastRun`
 * — a filtered/relabeled projection of a `RoutineRun` (its `id` renamed to `runId`; nullish
 * `completedAt`/`summary`/`error`/`errorCode` omitted entirely rather than included as `null`).
 * Kept as its own exported pure function (not inlined) so it is directly unit-testable, matching
 * this repo's "extract to a testable pure function" convention for awkward-to-cover branches.
 */
export function summarizeLastRun(run: RoutineRun | null): Record<string, unknown> | null {
  if (!run) return null;
  return {
    runId: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt,
    ...(run.completedAt == null ? {} : { completedAt: run.completedAt }),
    projectId: run.projectId,
    conversationId: run.conversationId,
    agentRunId: run.agentRunId,
    ...(run.summary ? { summary: run.summary } : {}),
    ...(run.error ? { error: run.error } : {}),
    ...(run.errorCode ? { errorCode: run.errorCode } : {}),
  };
}

/**
 * `RoutineStore` plus two extra write hooks for run history that are deliberately NOT part of
 * the public {@link RoutineStore} contract (see this module's doc comment for why run-writing
 * stays out of the interface). Exposed as a concrete-type superset so:
 * 1. This module's own tests can seed `listRuns`/`getLatestRun` fixtures without a second store.
 * 2. A host bridging `./scheduler.js`'s `RoutinePersistence.insertRun`/`updateRun` calls into
 *    this same in-memory instance (so `RoutineStore`'s read side observes the scheduler's writes)
 *    has a documented, shape-matched target to forward them to.
 */
export interface InMemoryRoutineStore extends RoutineStore {
  /** Records a run — mirrors `RoutinePersistence.insertRun`'s signature minus the scheduled-slot claim (this reference store has no concept of a "slot," only a flat run history), returning `false` if `run.id` was already recorded. */
  recordRun(run: RoutineRun): boolean;
  /** Patches a previously recorded run in place. A patch for an unknown `id` is a no-op, mirroring `RoutinePersistence.updateRun`'s own silent-no-op-on-unknown-id convention (see `./scheduler.js`'s `updateRun` call sites, none of which check a return value). */
  patchRun(id: string, patch: Partial<RoutineRun>): void;
}

function cloneContext(context: RoutineContextSelection): RoutineContextSelection {
  return {
    ...(context.skillIds ? { skillIds: [...context.skillIds] } : {}),
    ...(context.pluginIds ? { pluginIds: [...context.pluginIds] } : {}),
    ...(context.mcpServerIds ? { mcpServerIds: [...context.mcpServerIds] } : {}),
    ...(context.connectorIds ? { connectorIds: [...context.connectorIds] } : {}),
  };
}

/** Defensive deep clone so a caller mutating a returned `Routine` (its `context` array fields, `schedule`, or `target`) cannot corrupt this store's internal state — the store's only copy is never handed out by reference. */
function cloneRoutine(routine: Routine): Routine {
  return {
    ...routine,
    context: cloneContext(routine.context),
    schedule: { ...routine.schedule } as RoutineSchedule,
    target: { ...routine.target } as RoutineProjectTarget,
  };
}

/**
 * Reference `RoutineStore` implementation: an in-process `Map` of routines plus a flat array of
 * runs, no durable copy — matching `createInMemoryEventLog`'s own scope (a real persistent
 * adapter is `@jini-ai/sqlite`'s job).
 *
 * @complexity `get`/`create`/`update`/`delete` are O(1). `list` is O(n log n) (stable id-sort for
 * deterministic ordering). `listRuns`/`getLatestRun` are O(m log m) in the number of runs
 * recorded for the routine (m), since each sorts by `startedAt` descending on every call rather
 * than maintaining a secondary index — acceptable at this reference implementation's scale.
 */
export function createInMemoryRoutineStore(): InMemoryRoutineStore {
  const routines = new Map<string, Routine>();
  const runs: RoutineRun[] = [];

  function runsFor(routineId: string): RoutineRun[] {
    return runs
      .filter((run) => run.routineId === routineId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  async function withLastRun(routine: Routine): Promise<Routine> {
    const latest = runsFor(routine.id)[0] ?? null;
    return { ...cloneRoutine(routine), lastRun: summarizeLastRun(latest) };
  }

  return {
    async list(): Promise<readonly Routine[]> {
      const ids = Array.from(routines.keys()).sort();
      return Promise.all(ids.map((id) => withLastRun(routines.get(id)!)));
    },

    async get(id: string): Promise<Routine | null> {
      const routine = routines.get(id);
      return routine ? withLastRun(routine) : null;
    },

    async create(input: RoutineCreateInput): Promise<Routine> {
      const now = Date.now();
      const routine: Routine = {
        id: `routine-${randomUUID()}`,
        name: input.name,
        prompt: input.prompt,
        schedule: input.schedule,
        target: input.target,
        skillId: input.skillId ?? null,
        agentId: input.agentId ?? null,
        context: input.context ?? {},
        enabled: input.enabled ?? true,
        nextRunAt: null,
        lastRun: null,
        createdAt: now,
        updatedAt: now,
      };
      routines.set(routine.id, routine);
      return withLastRun(routine);
    },

    async update(id: string, patch: RoutineUpdateInput): Promise<Routine | null> {
      const existing = routines.get(id);
      if (!existing) return null;
      const updated: Routine = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
        ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
        ...(patch.target !== undefined ? { target: patch.target } : {}),
        ...(patch.skillId !== undefined ? { skillId: patch.skillId } : {}),
        ...(patch.agentId !== undefined ? { agentId: patch.agentId } : {}),
        ...(patch.context !== undefined ? { context: patch.context } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        updatedAt: Date.now(),
      };
      routines.set(id, updated);
      return withLastRun(updated);
    },

    async delete(id: string): Promise<boolean> {
      return routines.delete(id);
    },

    async listRuns(routineId: string, limit: number): Promise<readonly RoutineRun[]> {
      return runsFor(routineId).slice(0, limit);
    },

    async getLatestRun(routineId: string): Promise<RoutineRun | null> {
      return runsFor(routineId)[0] ?? null;
    },

    recordRun(run: RoutineRun): boolean {
      if (runs.some((existing) => existing.id === run.id)) return false;
      runs.push({ ...run });
      return true;
    },

    patchRun(id: string, patch: Partial<RoutineRun>): void {
      const run = runs.find((candidate) => candidate.id === id);
      if (run) Object.assign(run, patch);
    },
  };
}
