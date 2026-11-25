/**
 * @module routines
 *
 * Routine CRUD + run-history HTTP routes: `GET/POST /api/routines`, `GET/PATCH/DELETE
 * /api/routines/:id`, `POST /api/routines/:id/run`, `GET /api/routines/:id/runs`. Calls into the
 * `RoutineStore`/`RoutineService`-shaped ports `@jini-ai/daemon` ships (see that package's
 * `routines/` module — `routine-store.ts` for the CRUD+history port, `scheduler.ts` for the
 * scheduling engine) the same way `runs.ts` calls into `RunLifecycle` — no business logic lives
 * in this file itself.
 *
 * Ported from OD's `apps/daemon/src/routes/routine.ts` (348 lines, `refactor/web-memory-slice`
 * branch) per the decisions in `ADS-memory/reports/proposals/
 * PROP-http-route-packs-automation-routines-2026-07-21.md` (Finding 2). That proposal identified
 * two separable gaps blocking this route pack: (1) no scheduler existed anywhere in this repo —
 * closed by porting `routines.ts` into `packages/daemon/src/routines/scheduler.ts` this same pass;
 * (2) no `RoutineStore` persistence port existed for the CRUD side — closed by
 * `packages/daemon/src/routines/routine-store.ts`, designed the same way `EventLog` is designed.
 * This file is the third piece: the actual HTTP routes, now that both ports exist.
 *
 * **Confirmed bug fixed while porting** (per the proposal's own finding, not carried forward):
 * OD's `GET /api/routines/:id`, `DELETE /api/routines/:id`, and `GET /api/routines/:id/runs` (OD
 * source lines 236/268/292) had no try/catch, unlike every sibling handler in the same file. This
 * port does not reproduce that gap — but not via a per-route try/catch either: every route here
 * is mounted through `adapter.ts`'s `mountJsonRoute`, whose own top-level try/catch already wraps
 * every route's `parse`/`handle` invocation (the same mechanism `runs.ts`/`memory.ts` rely on),
 * so the bug is structurally impossible to reintroduce rather than merely patched at three call
 * sites.
 *
 * **Deliberately NOT ported** (see the proposal's Finding 1 and the "built-in template scoping"
 * decision it required a human call on):
 * - `GET /api/automation-templates` / `GET /api/automation-templates/:id` — these depend on
 *   `automation-templates.ts`, which is not ported (see below); none of the routine CRUD/run-now/
 *   run-history routes below need it to function.
 * - `POST /api/routines/:id/runs/:runId/crystallize` — depends on `ingestAutomationSource`
 *   (`automation-ingestions.ts`), explicitly scoped by the proposal as "a dedicated follow-up
 *   task the same size and shape as `@jini-ai/memory`'s own original port," not attempted here.
 * - `automation-templates.ts` itself, including its CRUD-adjacent lookup machinery: the decision
 *   already made for this pass is to ship **zero built-in automation templates** (matching this
 *   repo's established precedent of keeping product-authored content host-owned — `@jini-ai/memory`'s
 *   prompt-composition, `@jini-ai/deploy`'s config-path resolution, etc.) and, since no route in this
 *   file needs any part of that module to function, none of it — content or generic shape — is
 *   ported this pass.
 * - `automation-proposals.ts` / `automation-ingestions.ts` — untouched, per the proposal's Finding
 *   1 explicit scoping and this task's brief.
 *
 * **Design note — why `target.mode === 'reuse'` project-existence checking is optional, injected
 * DI, not a hard dependency**: OD's original unconditionally called `getProject(db, projectId)`
 * to validate a reuse target. This module has no project concept of its own (matching
 * `active-context.ts`'s `resolveResource` precedent for the same category of coupling), so
 * `RoutineHttpDeps.projectExists` is an optional injected predicate: a host that has a project
 * store supplies it and reuse targets are validated against it exactly like OD did; a host with
 * no such concept (or that wants to defer the check) can omit it, and reuse targets are accepted
 * without existence-checking rather than forcing every consumer to fabricate one.
 *
 * **Design note — why `POST /api/routines/:id/run`'s `run` field can be `null` even on success**:
 * `RoutineStore` deliberately does not record runs (see `routine-store.ts`'s module doc: run
 * *writing* stays the scheduler's own separately-injected `RoutinePersistence` concern, matching
 * OD's own architectural split between the two). This route calls `store.getLatestRun(id)` after
 * `scheduler.runNow(id)` resolves — accurate only if a host has bridged the scheduler's
 * `RoutinePersistence.insertRun`/`updateRun` writes into the same store instance (documented,
 * host-level integration wiring, out of this port's scope, the same way `runs.ts`'s `onStarted`
 * driver is host-supplied). `projectId`/`conversationId`/`agentRunId` on the response always
 * reflect the real, just-started run regardless of that wiring, since those come directly from
 * `scheduler.runNow`'s own return value.
 */
import {
  validateSchedule,
  validateTarget,
  RoutineActiveError,
  type Routine,
  type RoutineContextSelection,
  type RoutineCreateInput,
  type RoutineProjectTarget,
  type RoutineRun,
  type RoutineSchedule,
  type RoutineService,
  type RoutineStore,
  type RoutineUpdateInput,
} from '../index.js';
import { ToolInputError } from '@jini-ai/core';
import { createApiError, type ApiError } from '@jini-ai/protocol';
import { ClientFacingError, defineJsonRoute, validationError, err, ok, type Result, type RouteInputContext } from '@jini-ai/core/contracts/server';
import type { DaemonRouteHost } from './route-host.js';
import { gatedJsonRoute, type DaemonRoute } from './route-table.js';

/** The 404 message for an unknown routine id. */
const ROUTINE_NOT_FOUND_MESSAGE = 'routine not found';

/** The scheduler surface these routes need — a structural subset of `RoutineService`, matching OD's own `RoutineRoutesService` narrowing (`Pick<RoutineService, 'nextRunAt' | 'rescheduleOne' | 'runNow' | 'unschedule'>`). Wiring a real `RoutineService` in satisfies this with zero adapter code. */
export type RoutineScheduler = Pick<RoutineService, 'nextRunAt' | 'rescheduleOne' | 'runNow' | 'unschedule'>;

export interface RoutineHttpDeps {
  readonly store: RoutineStore;
  readonly scheduler: RoutineScheduler;
  /** Validates a `target: {mode: 'reuse', projectId}`'s `projectId` before create/update accept it. Omit to skip existence-checking entirely — see this module's doc comment. */
  readonly projectExists?: ({ projectId }: { projectId: string }) => boolean | Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Overlays the scheduler's live `nextRunAt` onto a routine fetched from the store — `RoutineStore` itself has no scheduler knowledge (see `routine-store.ts`'s module doc), matching OD's own `routineFromDb` two-step (fetch, then overlay `routineService.nextRunAt`). */
function attachNextRunAt(routine: Routine, scheduler: Pick<RoutineScheduler, 'nextRunAt'>): Routine {
  return { ...routine, nextRunAt: scheduler.nextRunAt({ routineId: routine.id })?.getTime() ?? routine.nextRunAt };
}

async function checkTargetProjectExists(target: RoutineProjectTarget, deps: RoutineHttpDeps): Promise<ApiError | null> {
  if (target.mode !== 'reuse' || !deps.projectExists) return null;
  const exists = await deps.projectExists({ projectId: target.projectId });
  return exists ? null : createApiError({ code: 'NOT_FOUND', message: `target project ${target.projectId} not found` });
}

function parseRoutineId(input: RouteInputContext): Result<string> {
  const id = input.params.id;
  return typeof id === 'string' && id.length > 0 ? ok({ value: id }) : err({ error: validationError({ message: 'id must be a non-empty path parameter' }) });
}

function parseNonEmptyString(value: unknown, field: string): Result<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return err({ error: validationError({ message: `${field} is required` }, { issues: [{ path: field, message: 'required non-empty string' }] }) });
  }
  return ok({ value: value.trim() });
}

/** Present-but-non-string/empty is rejected; absent (`undefined`) or explicit `null` are both accepted (clearing the field on update). */
function parseOptionalNullableString(body: Record<string, unknown>, field: string): Result<string | null | undefined> {
  const value = body[field];
  if (value === undefined) return ok({ value: undefined });
  if (value === null) return ok({ value: null });
  if (typeof value !== 'string' || value.trim().length === 0) {
    return err({ error: validationError({ message: `${field} must be a non-empty string or null when provided` }) });
  }
  return ok({ value });
}

function parseSchedule(value: unknown): Result<RoutineSchedule> {
  try {
    validateSchedule({ schedule: value as RoutineSchedule });
  } catch (error) {
    return err({ error: validationError({ message: errorMessage(error) }) });
  }
  return ok({ value: value as RoutineSchedule });
}

function parseTarget(value: unknown): Result<RoutineProjectTarget> {
  try {
    validateTarget({ target: value as RoutineProjectTarget });
  } catch (error) {
    return err({ error: validationError({ message: errorMessage(error) }) });
  }
  return ok({ value: value as RoutineProjectTarget });
}

/** Validates and de-duplicates one `context.*` array field, trimming entries and dropping blanks — mirrors OD's `cleanStringList`. */
function cleanStringList(value: unknown, field: string): Result<string[]> {
  if (!Array.isArray(value)) return err({ error: validationError({ message: `${field} must be an array` }) });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return err({ error: validationError({ message: `${field} must contain strings` }) });
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return ok({ value: out });
}

const CONTEXT_FIELDS = ['skillIds', 'pluginIds', 'mcpServerIds', 'connectorIds'] as const;

/** Mirrors OD's `normalizeRoutineContext`: an explicitly-empty array for a field is dropped entirely (not kept as `[]`) so a routine's stored context only ever carries fields that actually scope something. */
function parseContextSelection(value: unknown): Result<RoutineContextSelection> {
  if (value === undefined || value === null) return ok({ value: {} });
  if (!isRecord(value)) return err({ error: validationError({ message: 'context must be an object' }) });
  const context: RoutineContextSelection = {};
  for (const field of CONTEXT_FIELDS) {
    const raw = value[field];
    if (raw === undefined) continue;
    const cleaned = cleanStringList(raw, `context.${field}`);
    if (!cleaned.ok) return cleaned;
    if (cleaned.value.length > 0) context[field] = cleaned.value;
  }
  return ok({ value: context });
}

function parseOptionalBoolean(body: Record<string, unknown>, field: string): Result<boolean | undefined> {
  const value = body[field];
  if (value !== undefined && typeof value !== 'boolean') {
    return err({ error: validationError({ message: `${field} must be a boolean when provided` }) });
  }
  return ok({ value });
}

/** Table order is the validation order shared by create and update: the first failing field is the one a caller sees. */
const ROUTINE_FIELD_PARSERS: ReadonlyArray<readonly [keyof RoutineCreateInput, (body: Record<string, unknown>) => Result<unknown>]> = [
  ['name', (body) => parseNonEmptyString(body.name, 'name')],
  ['prompt', (body) => parseNonEmptyString(body.prompt, 'prompt')],
  ['schedule', (body) => parseSchedule(body.schedule)],
  ['target', (body) => parseTarget(body.target)],
  ['skillId', (body) => parseOptionalNullableString(body, 'skillId')],
  ['agentId', (body) => parseOptionalNullableString(body, 'agentId')],
  ['model', (body) => { const parsed = parseOptionalNullableString(body, 'model');
    return parsed.ok && parsed.value && parsed.value.length > 200 ? err({ error: validationError({ message: 'model must be at most 200 characters' }) }) : parsed; }],
  ['context', (body) => parseContextSelection(body.context)],
  ['enabled', (body) => parseOptionalBoolean(body, 'enabled')],
];

/**
 * Parses every routine field in table order, omitting any that parse to `undefined`. With
 * `onlyProvided` (update), a field absent from the body is skipped before parsing, so required
 * fields are not demanded and an absent `context` is not defaulted to `{}`.
 */
function parseRoutineFields({ body }: { body: Record<string, unknown> }, { onlyProvided = false }: { onlyProvided?: boolean } = {}): Result<Record<string, unknown>> {
  // `RoutineCreateInput`/`RoutineUpdateInput`'s fields are `readonly` (an immutable port-input
  // contract) — built here as a mutable local shape field-by-field, then handed back as that
  // readonly type, which is a safe widening (mutable -> readonly), not the reverse.
  const fields: Record<string, unknown> = {};
  for (const [key, parse] of ROUTINE_FIELD_PARSERS) {
    if (onlyProvided && body[key] === undefined) continue;
    const parsed = parse(body);
    if (!parsed.ok) return parsed;
    if (parsed.value !== undefined) fields[key] = parsed.value;
  }
  return ok({ value: fields });
}

function parseRoutineCreate(input: RouteInputContext): Result<RoutineCreateInput> {
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const fields = parseRoutineFields({ body: input.body });
  if (!fields.ok) return fields;
  return ok({ value: fields.value as unknown as RoutineCreateInput });
}

interface RoutineUpdateRequest {
  readonly id: string;
  readonly patch: RoutineUpdateInput;
}

function parseRoutineUpdate(input: RouteInputContext): Result<RoutineUpdateRequest> {
  const idResult = parseRoutineId(input);
  if (!idResult.ok) return idResult;
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  // A provided `skillId`/`agentId` parses to a string or `null` (never `undefined`), so an explicit
  // `null` reaches the patch and clears the field.
  const patch = parseRoutineFields({ body: input.body }, { onlyProvided: true });
  if (!patch.ok) return patch;
  return ok({ value: { id: idResult.value, patch: patch.value as RoutineUpdateInput } });
}

interface RoutineRunsQuery {
  readonly id: string;
  readonly limit: number;
  readonly cursor: string | null;
}

function parseRoutineRunsQuery(input: RouteInputContext): Result<RoutineRunsQuery> {
  const idResult = parseRoutineId(input);
  if (!idResult.ok) return idResult;
  const raw = input.query.limit;
  const rawValue = Array.isArray(raw) ? raw[0] : raw;
  // Retains OD's ceiling/floor and fallback for NaN/0/absent. Unlike its `|| 20` expression,
  // explicitly fall back for negatives too: a truthy negative must not defeat the documented default.
  const parsed = Number(rawValue);
  const numeric = parsed > 0 ? parsed : 20;
  const limit = Math.min(100, Math.max(1, numeric));
  const rawCursor = Array.isArray(input.query.cursor) ? input.query.cursor[0] : input.query.cursor;
  if (rawCursor !== undefined && (typeof rawCursor !== 'string' || rawCursor.length === 0)) {
    return err({ error: validationError({ message: 'cursor must be a non-empty string' }) });
  }
  return ok({ value: { id: idResult.value, limit, cursor: rawCursor ?? null } });
}

// ---------------------------------------------------------------------------
// GET /api/routines, POST /api/routines
// ---------------------------------------------------------------------------

export interface RoutineListResponse {
  readonly routines: readonly Routine[];
}

export const routineListRoute = defineJsonRoute<void, RoutineListResponse, { store: Pick<RoutineStore, 'list'>; scheduler: Pick<RoutineScheduler, 'nextRunAt'> }>({
  method: 'get', path: '/api/routines', parse: () => ok({ value: undefined }), handle: async ({ input: _input, deps }) => {
    const routines = await deps.store.list();
    return ok({ value: { routines: routines.map((routine) => attachNextRunAt(routine, deps.scheduler)) } });
  }
});

export interface RoutineResponse {
  readonly routine: Routine;
}

export const routineCreateRoute = defineJsonRoute<RoutineCreateInput, RoutineResponse, RoutineHttpDeps>({
  method: 'post', path: '/api/routines', parse: parseRoutineCreate, handle: async ({ input, deps }) => {
    const targetError = await checkTargetProjectExists(input.target, deps);
    if (targetError) return err({ error: targetError });
    const routine = await deps.store.create(input);
    deps.scheduler.rescheduleOne({ routineId: routine.id });
    return ok({ value: { routine: attachNextRunAt(routine, deps.scheduler) } });
  }
}, { requireSameOrigin: true, successStatus: 201 });

// ---------------------------------------------------------------------------
// GET/PATCH/DELETE /api/routines/:id
// ---------------------------------------------------------------------------

export const routineGetRoute = defineJsonRoute<string, RoutineResponse, { store: Pick<RoutineStore, 'get'>; scheduler: Pick<RoutineScheduler, 'nextRunAt'> }>({
  method: 'get', path: '/api/routines/:id', parse: parseRoutineId, handle: async ({ input: id, deps }) => {
    const routine = await deps.store.get({ id });
    return routine === null
      ? err({ error: createApiError({ code: 'NOT_FOUND', message: ROUTINE_NOT_FOUND_MESSAGE }) })
      : ok({ value: { routine: attachNextRunAt(routine, deps.scheduler) } });
  }
});

export const routineUpdateRoute = defineJsonRoute<RoutineUpdateRequest, RoutineResponse, RoutineHttpDeps>({
  method: 'patch', path: '/api/routines/:id', parse: parseRoutineUpdate, handle: async ({ input: { id, patch }, deps }) => {
    if (patch.target !== undefined) {
      const targetError = await checkTargetProjectExists(patch.target, deps);
      if (targetError) return err({ error: targetError });
    }
    const routine = await deps.store.update({ id, patch });
    if (routine === null) return err({ error: createApiError({ code: 'NOT_FOUND', message: ROUTINE_NOT_FOUND_MESSAGE }) });
    deps.scheduler.rescheduleOne({ routineId: id });
    return ok({ value: { routine: attachNextRunAt(routine, deps.scheduler) } });
  }
}, { requireSameOrigin: true });

export interface RoutineDeleteResponse {
  readonly ok: true;
}

export const routineDeleteRoute = defineJsonRoute<string, RoutineDeleteResponse, { store: Pick<RoutineStore, 'delete'>; scheduler: Pick<RoutineScheduler, 'unschedule'> }>({
  method: 'delete', path: '/api/routines/:id', parse: parseRoutineId, handle: async ({ input: id, deps }) => {
    deps.scheduler.unschedule({ routineId: id });
    const removed = await deps.store.delete({ id });
    return removed ? ok({ value: { ok: true } }) : err({ error: createApiError({ code: 'NOT_FOUND', message: ROUTINE_NOT_FOUND_MESSAGE }) });
  }
}, { requireSameOrigin: true });

// ---------------------------------------------------------------------------
// POST /api/routines/:id/run
// ---------------------------------------------------------------------------

export interface RoutineRunNowResponse {
  readonly routine: Routine | null;
  readonly run: RoutineRun | null;
  readonly projectId: string;
  readonly conversationId: string;
  readonly agentRunId: string;
}

export const routineRunNowRoute = defineJsonRoute<string, RoutineRunNowResponse, { store: Pick<RoutineStore, 'get' | 'getLatestRun'>; scheduler: Pick<RoutineScheduler, 'runNow' | 'nextRunAt'> }>({
  method: 'post', path: '/api/routines/:id/run', parse: parseRoutineId, handle: async ({ input: id, deps }) => {
    const existing = await deps.store.get({ id });
    if (existing === null) return err({ error: createApiError({ code: 'NOT_FOUND', message: ROUTINE_NOT_FOUND_MESSAGE }) });
    const started = await deps.scheduler.runNow({ routineId: id });
    const [routine, run] = await Promise.all([deps.store.get({ id }), deps.store.getLatestRun({ routineId: id })]);
    return ok({
      value: {
        routine: routine ? attachNextRunAt(routine, deps.scheduler) : null,
        run,
        projectId: started.projectId,
        conversationId: started.conversationId,
        agentRunId: started.agentRunId,
      }
    });
  }
}, { requireSameOrigin: true, successStatus: 202 });

// ---------------------------------------------------------------------------
// GET /api/routines/:id/runs
// ---------------------------------------------------------------------------

export interface RoutineRunsResponse {
  readonly runs: readonly RoutineRun[];
  /** Opaque cursor for the next (older) page, or `null` on the last page. */
  readonly nextCursor: string | null;
}

export const routineRunsListRoute = defineJsonRoute<RoutineRunsQuery, RoutineRunsResponse, { store: Pick<RoutineStore, 'get' | 'listRuns'> }>({
  method: 'get', path: '/api/routines/:id/runs', parse: parseRoutineRunsQuery, handle: async ({ input: { id, limit, cursor }, deps }) => {
    const existing = await deps.store.get({ id });
    if (existing === null) return err({ error: createApiError({ code: 'NOT_FOUND', message: ROUTINE_NOT_FOUND_MESSAGE }) });
    try {
      const page = await deps.store.listRuns({ routineId: id, limit }, { cursor });
      return ok({ value: { runs: page.items, nextCursor: page.nextCursor } });
    } catch (error) {
      if (error instanceof ToolInputError) {
        // `ToolInputError` text is Jini's own plain-words input refusal (an invalid cursor), meant for the caller.
        const refusal = validationError({ message: error.message });
        return err({ error: refusal });
      }
      throw error;
    }
  }
});

/** Every routine route as data; the four writes sit behind the same-origin gate their specs declare. */
export function routineRoutes({ deps, host }: { readonly deps: RoutineHttpDeps; readonly host: DaemonRouteHost }, _optional: Record<string, never> = {}): DaemonRoute[] {
  return [
    gatedJsonRoute({ spec: routineListRoute, deps, host }),
    gatedJsonRoute({ spec: routineCreateRoute, deps, host }),
    gatedJsonRoute({ spec: routineGetRoute, deps, host }),
    gatedJsonRoute({ spec: routineUpdateRoute, deps, host }),
    gatedJsonRoute({ spec: routineDeleteRoute, deps, host }),
    gatedJsonRoute({ spec: routineRunNowRoute, deps, host }),
    gatedJsonRoute({ spec: routineRunsListRoute, deps, host }),
  ];
}

type RouteCopy = Readonly<Record<string, string>>;
type RouteFailure = Result<never>;

function sqliteFailure(error: unknown, copy: RouteCopy): RouteFailure | null {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code !== 'SQLITE_BUSY' && code !== 'SQLITE_FULL') return null;
  const reason = code === 'SQLITE_BUSY' ? 'ROUTINES_BUSY' : 'ROUTINES_DISK_FULL';
  return err({ error: { code: code === 'SQLITE_BUSY' ? 'SERVICE_UNAVAILABLE' : 'INSUFFICIENT_STORAGE', message: copy[reason] ?? 'Routine storage is unavailable', details: { reason } } });
}

function clientFacingFailure(error: unknown, copy: RouteCopy, mapActive: boolean): RouteFailure | null {
  if (error instanceof ClientFacingError) return err({ error: { ...error.apiError, message: copy[String((error.apiError.details as { reason?: string } | undefined)?.reason)] ?? error.apiError.message } });
  if (mapActive && error instanceof RoutineActiveError) return err({ error: { code: 'CONFLICT', message: copy.ROUTINE_RUN_ACTIVE ?? 'Routine already has an active run', details: { reason: 'ROUTINE_RUN_ACTIVE' } } });
  return null;
}

/** Shared catch-block mapping for every routine route: client-facing errors and SQLite busy/full become wire errors; anything else is rethrown. `mapActive` is set only by run-now, the one route that can surface `RoutineActiveError`. */
function mapRoutineError(error: unknown, copy: RouteCopy, { mapActive = false }: { mapActive?: boolean } = {}): RouteFailure {
  const mapped = clientFacingFailure(error, copy, mapActive) ?? sqliteFailure(error, copy);
  if (mapped) return mapped;
  throw error;
}

function routineNotFound(copy: RouteCopy) {
  return err({ error: { code: 'NOT_FOUND', message: copy.ROUTINE_NOT_FOUND ?? ROUTINE_NOT_FOUND_MESSAGE, details: { reason: 'ROUTINE_NOT_FOUND' } } });
}

/** Runs a spec's own handler, relocalizing its NOT_FOUND and mapping thrown errors through `mapRoutineError`. */
async function handleWithRoutineErrors<T>(run: () => Result<T> | Promise<Result<T>>, copy: RouteCopy, options: { mapActive?: boolean } = {}): Promise<Result<T>> {
  try {
    const result = await run();
    if (result.ok || result.error.code !== 'NOT_FOUND') return result;
    return err({ error: { ...result.error, message: copy.ROUTINE_NOT_FOUND ?? result.error.message, details: { reason: 'ROUTINE_NOT_FOUND' } } });
  } catch (error) {
    return mapRoutineError(error, copy, options);
  }
}

type RoutePathCopy = { path: string; copy: RouteCopy };

export function createRoutineListRoute({ path, copy }: RoutePathCopy, _optional = {}) {
  return defineJsonRoute({ ...routineListRoute, path, handle: (required: Parameters<typeof routineListRoute.handle>[0]) =>
    handleWithRoutineErrors(() => routineListRoute.handle(required), copy) });
}
export function createRoutineGetRoute({ path, copy }: RoutePathCopy, _optional = {}) {
  return defineJsonRoute({ ...routineGetRoute, path, handle: (required: Parameters<typeof routineGetRoute.handle>[0]) =>
    handleWithRoutineErrors(() => routineGetRoute.handle(required), copy) });
}
export function createRoutineRunNowRoute({ path, copy }: RoutePathCopy, _optional = {}) {
  return defineJsonRoute({ ...routineRunNowRoute, path, handle: (required: Parameters<typeof routineRunNowRoute.handle>[0]) =>
    handleWithRoutineErrors(() => routineRunNowRoute.handle(required), copy, { mapActive: true }) });
}
export function createRoutineRunsRoute({ path, copy }: RoutePathCopy, _optional = {}) {
  return defineJsonRoute({ ...routineRunsListRoute, path, handle: (required: Parameters<typeof routineRunsListRoute.handle>[0]) =>
    handleWithRoutineErrors(() => routineRunsListRoute.handle(required), copy) });
}

type RoutineCreateBody = Omit<RoutineCreateInput, 'target'> & { target?: RoutineProjectTarget };
type RoutineCreateDeps = { store: Pick<RoutineStore, 'create'>; scheduler: Pick<RoutineScheduler, 'rescheduleOne' | 'nextRunAt'>;
  defaults?: { target: RoutineProjectTarget }; resolveCreator(required: { context: unknown }, optional: Record<string, never>): string | null | Promise<string | null> };

function invalidSchedule(error: ApiError) {
  return err({ error: { ...error, details: { reason: 'INVALID_SCHEDULE' } } });
}

function parseCreateBody(raw: RouteInputContext): Result<RoutineCreateBody> {
  if (!isRecord(raw.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const fields = parseRoutineFields({ body: raw.body }, { onlyProvided: true });
  if (!fields.ok) return invalidSchedule(fields.error);
  for (const key of ['name', 'prompt']) { const parsed = parseNonEmptyString(raw.body[key], key); if (!parsed.ok) return parsed; }
  const schedule = parseSchedule(raw.body.schedule);
  if (!schedule.ok) return invalidSchedule(schedule.error);
  return ok({ value: fields.value as RoutineCreateBody });
}

async function handleCreate({ input, deps, context }: { input: RoutineCreateBody; deps: RoutineCreateDeps; context?: unknown }, copy: RouteCopy) {
  const creatorId = await deps.resolveCreator({ context }, {});
  if (creatorId === null) return err({ error: { code: 'UNAUTHORIZED', message: copy.UNAUTHORIZED ?? 'A trusted creator is required' } });
  const target = input.target ?? deps.defaults?.target;
  if (!target) return err({ error: validationError({ message: 'target is required' }) });
  const routine = await deps.store.create({ ...input, target }, { creatorId });
  deps.scheduler.rescheduleOne({ routineId: routine.id });
  return ok({ value: { routine: attachNextRunAt(routine, deps.scheduler) } });
}

export function createRoutineCreateRoute({ path, copy }: RoutePathCopy, _optional = {}) {
  return defineJsonRoute<RoutineCreateBody, RoutineResponse, RoutineCreateDeps, unknown>({
    method: 'post', path, parse: parseCreateBody,
    handle: async (required) => {
      try { return await handleCreate(required, copy); } catch (error) { return mapRoutineError(error, copy); }
    },
  }, { requireSameOrigin: true, successStatus: 201 });
}

type RoutineUpdateBody = RoutineUpdateRequest & { expectedRevision?: number };

function parseUpdateBody(raw: RouteInputContext): Result<RoutineUpdateBody> {
  const parsed = parseRoutineUpdate(raw); if (!parsed.ok) return invalidSchedule(parsed.error);
  const revision = (raw.body as Record<string, unknown>).expectedRevision;
  if (revision !== undefined && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1)) return err({ error: validationError({ message: 'expectedRevision must be a positive safe integer' }) });
  return ok({ value: { ...parsed.value, ...(revision === undefined ? {} : { expectedRevision: revision }) } });
}

function revisionOption(expectedRevision: number | undefined): { expectedRevision?: number } {
  return expectedRevision === undefined ? {} : { expectedRevision };
}

export function createRoutineUpdateRoute({ path, copy }: RoutePathCopy, _optional = {}) {
  return defineJsonRoute<RoutineUpdateBody, RoutineResponse,
    { store: Pick<RoutineStore, 'update'>; scheduler: Pick<RoutineScheduler, 'rescheduleOne' | 'nextRunAt'> }>({
    method: 'patch', path, parse: parseUpdateBody,
    handle: async ({ input: { id, patch, expectedRevision }, deps }) => {
      try {
        const routine = await deps.store.update({ id, patch }, revisionOption(expectedRevision));
        if (!routine) return routineNotFound(copy);
        deps.scheduler.rescheduleOne({ routineId: id }); return ok({ value: { routine: attachNextRunAt(routine, deps.scheduler) } });
      } catch (error) { return mapRoutineError(error, copy); }
    },
  }, { requireSameOrigin: true });
}

function parseDeleteQuery(raw: RouteInputContext): Result<{ id: string; expectedRevision?: number }> {
  const id = parseRoutineId(raw); if (!id.ok) return id;
  const value = raw.query.revision;
  if (value === undefined) return ok({ value: { id: id.value } });
  const revision = Number(value);
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value) || !Number.isSafeInteger(revision) || revision < 1) return err({ error: validationError({ message: 'revision must be a positive safe integer' }) });
  return ok({ value: { id: id.value, expectedRevision: revision } });
}

export function createRoutineDeleteRoute({ path, copy }: RoutePathCopy, _optional = {}) {
  return defineJsonRoute<{ id: string; expectedRevision?: number }, RoutineDeleteResponse,
    { store: Pick<RoutineStore, 'delete'>; scheduler: Pick<RoutineScheduler, 'unschedule'> }>({
    method: 'delete', path, parse: parseDeleteQuery,
    handle: async ({ input: { id, expectedRevision }, deps }) => {
      try {
        const removed = await deps.store.delete({ id }, revisionOption(expectedRevision));
        if (!removed) return routineNotFound(copy);
        deps.scheduler.unschedule({ routineId: id }); return ok({ value: { ok: true } });
      } catch (error) { return mapRoutineError(error, copy); }
    },
  }, { requireSameOrigin: true });
}
