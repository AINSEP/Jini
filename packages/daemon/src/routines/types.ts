/**
 * Domain types for the routine scheduler ({@link ./scheduler.js}) and its HTTP-facing
 * CRUD+history counterpart, {@link RoutineStore} (`./routine-store.js`). Mirrors OD's
 * `apps/daemon/src/routines.ts` local type block field-for-field — that file's own header
 * comment already noted these types are "a local mirror... kept here so this service
 * typechecks under NodeNext," not a product coupling, so the port is a straight lift.
 */

export type RoutineRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type RoutineRunTrigger = 'manual' | 'scheduled';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RoutineSchedule =
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; time: string; timezone: string }
  | { kind: 'weekdays'; time: string; timezone: string }
  | { kind: 'weekly'; time: string; timezone: string; weekday: Weekday };

export type RoutineProjectTarget = { mode: 'create_each_run' } | { mode: 'reuse'; projectId: string };

/** Opaque scope selection a routine's run inherits — generic ids only, no OD skill/plugin/MCP/connector vocabulary baked in beyond field names already this abstract in the origin. */
export interface RoutineContextSelection {
  skillIds?: string[];
  pluginIds?: string[];
  mcpServerIds?: string[];
  connectorIds?: string[];
}

export interface Routine {
  id: string;
  name: string;
  prompt: string;
  schedule: RoutineSchedule;
  target: RoutineProjectTarget;
  skillId: string | null;
  agentId: string | null;
  context: RoutineContextSelection;
  enabled: boolean;
  nextRunAt: number | null;
  lastRun: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  trigger: RoutineRunTrigger;
  status: RoutineRunStatus;
  projectId: string;
  conversationId: string;
  agentRunId: string;
  startedAt: number;
  completedAt: number | null;
  summary: string | null;
  error: string | null;
  errorCode: string | null;
}

export interface RoutineRunHandlerStart {
  projectId: string;
  conversationId: string;
  agentRunId: string;
  completion: Promise<RoutineRunCompletion>;
  prepare?: (run: RoutineRun) => void | Promise<void>;
  start?: () => void;
  /**
   * Tear-down for the case where the handler returned a start handle but {@link RoutineService}
   * later reached `prepare()` and it failed — i.e. the routine_run row exists, prepare may have
   * partially mutated project/conversation/snapshot state, and the in-memory chat run still
   * needs to terminate as `canceled`. Callers MUST surface failures rather than swallow them
   * (the loser-retry path depends on it).
   */
  discard?: () => void;
  /**
   * Tear-down for the case where the run was NEVER durably inserted — either `insertRun()`
   * threw, or `insertRun()` returned `false` because a sibling daemon already won the scheduled
   * slot. Prepare has not run, so no project/conversation/snapshot writes need rolling back. The
   * in-memory chat run must also be removed from the registry instead of being finalized as
   * `canceled`, otherwise duplicate-loser slots would surface phantom canceled runs on a run
   * listing. Falls back to `discard` when the handler does not distinguish the two cases.
   */
  discardUnstarted?: () => void;
}

export interface RoutineRunCompletion {
  status: RoutineRunStatus;
  summary?: string;
  error?: string;
  errorCode?: string | null;
}

export type RoutineRunHandler = (input: {
  routine: Routine;
  trigger: RoutineRunTrigger;
  startedAt: number;
  runId: string;
}) => Promise<RoutineRunHandlerStart>;

/**
 * Storage port the scheduler ({@link ./scheduler.js}'s `RoutineService`) is injected with.
 * Deliberately synchronous — kept faithful to the OD original rather than converted to this
 * repo's usual async-port convention (see `event-log.ts`'s "ports are async-only from day one"
 * doc note): the scheduler's `setTimeout`-driven fire path and its race-safe scheduled-slot
 * claim (`ScheduledRunPersistenceError`) are exactly the "genuinely hard to get right" logic the
 * porting proposal (`ADS-memory/reports/proposals/
 * PROP-http-route-packs-automation-routines-2026-07-21.md`) flagged as "not something to
 * casually reinvent" — a mechanical sync-to-async conversion of every call site inside
 * `scheduleRoutineAt`'s timer callback risks introducing new races in exactly that logic for no
 * behavioral gain, since a real backing store can still satisfy this port synchronously (an
 * in-process cache kept warm by the separately-async {@link RoutineStore}) even when durable
 * writes underneath are async. Building that bridge is host-level integration wiring, not this
 * port's job — the same way `runs.ts`'s `onStarted` driver is host-supplied rather than built
 * into `RunLifecycle` itself.
 */
export interface RoutinePersistence {
  list(): Routine[];
  insertRun(args: { readonly run: RoutineRun }, optionalArgs?: { scheduledSlotAt?: number }): boolean | void;
  updateRun(args: { readonly id: string; readonly patch: Partial<RoutineRun> }): void;
  getLatestRun(args: { readonly routineId: string }): RoutineRun | null;
}
