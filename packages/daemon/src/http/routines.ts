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
 * closed by porting `routines.ts` into `@jini-ai/daemon/src/routines/scheduler.ts` this same pass;
 * (2) no `RoutineStore` persistence port existed for the CRUD side — closed by
 * `@jini-ai/daemon/src/routines/routine-store.ts`, designed the same way `EventLog` is designed.
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
import type { Express } from 'express';
import {
  validateSchedule,
  validateTarget,
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
import { createApiError, type ApiError } from '@jini-ai/protocol';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from '@jini-ai/http-kit';
import { validationError } from '@jini-ai/http-kit';
import { err, ok, type Result, type RouteInputContext } from '@jini-ai/http-kit';

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
function attachNextRunAt(routine: Routine, scheduler: RoutineScheduler): Routine {
  return { ...routine, nextRunAt: scheduler.nextRunAt({ routineId: routine.id })?.getTime() ?? null };
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

function parseRoutineCreate(input: RouteInputContext): Result<RoutineCreateInput> {
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const name = parseNonEmptyString(input.body.name, 'name');
  if (!name.ok) return name;
  const prompt = parseNonEmptyString(input.body.prompt, 'prompt');
  if (!prompt.ok) return prompt;
  const schedule = parseSchedule(input.body.schedule);
  if (!schedule.ok) return schedule;
  const target = parseTarget(input.body.target);
  if (!target.ok) return target;
  const skillId = parseOptionalNullableString(input.body, 'skillId');
  if (!skillId.ok) return skillId;
  const agentId = parseOptionalNullableString(input.body, 'agentId');
  if (!agentId.ok) return agentId;
  const context = parseContextSelection(input.body.context);
  if (!context.ok) return context;
  const enabled = input.body.enabled;
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    return err({ error: validationError({ message: 'enabled must be a boolean when provided' }) });
  }
  return ok({
    value: {
      name: name.value,
      prompt: prompt.value,
      schedule: schedule.value,
      target: target.value,
      ...(skillId.value !== undefined ? { skillId: skillId.value } : {}),
      ...(agentId.value !== undefined ? { agentId: agentId.value } : {}),
      context: context.value,
      ...(enabled !== undefined ? { enabled } : {}),
    }
  });
}

interface RoutineUpdateRequest {
  readonly id: string;
  readonly patch: RoutineUpdateInput;
}

function parseRoutineUpdate(input: RouteInputContext): Result<RoutineUpdateRequest> {
  const idResult = parseRoutineId(input);
  if (!idResult.ok) return idResult;
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const body = input.body;
  // `RoutineUpdateInput`'s fields are `readonly` (an immutable port-input contract) — built here
  // as a mutable local shape field-by-field, then handed back as that readonly type, which is a
  // safe widening (mutable -> readonly), not the reverse.
  const patch: { -readonly [K in keyof RoutineUpdateInput]: RoutineUpdateInput[K] } = {};

  if (body.name !== undefined) {
    const name = parseNonEmptyString(body.name, 'name');
    if (!name.ok) return name;
    patch.name = name.value;
  }
  if (body.prompt !== undefined) {
    const prompt = parseNonEmptyString(body.prompt, 'prompt');
    if (!prompt.ok) return prompt;
    patch.prompt = prompt.value;
  }
  if (body.schedule !== undefined) {
    const schedule = parseSchedule(body.schedule);
    if (!schedule.ok) return schedule;
    patch.schedule = schedule.value;
  }
  if (body.target !== undefined) {
    const target = parseTarget(body.target);
    if (!target.ok) return target;
    patch.target = target.value;
  }
  if (body.skillId !== undefined) {
    const skillId = parseOptionalNullableString(body, 'skillId');
    if (!skillId.ok) return skillId;
    patch.skillId = skillId.value ?? null;
  }
  if (body.agentId !== undefined) {
    const agentId = parseOptionalNullableString(body, 'agentId');
    if (!agentId.ok) return agentId;
    patch.agentId = agentId.value ?? null;
  }
  if (body.context !== undefined) {
    const context = parseContextSelection(body.context);
    if (!context.ok) return context;
    patch.context = context.value;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return err({ error: validationError({ message: 'enabled must be a boolean when provided' }) });
    patch.enabled = body.enabled;
  }

  return ok({ value: { id: idResult.value, patch } });
}

interface RoutineRunsQuery {
  readonly id: string;
  readonly limit: number;
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
  return ok({ value: { id: idResult.value, limit } });
}

// ---------------------------------------------------------------------------
// GET /api/routines, POST /api/routines
// ---------------------------------------------------------------------------

export interface RoutineListResponse {
  readonly routines: readonly Routine[];
}

export const routineListRoute = defineJsonRoute<void, RoutineListResponse, RoutineHttpDeps>({
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

export const routineGetRoute = defineJsonRoute<string, RoutineResponse, RoutineHttpDeps>({
  method: 'get', path: '/api/routines/:id', parse: parseRoutineId, handle: async ({ input: id, deps }) => {
    const routine = await deps.store.get({ id });
    return routine === null
      ? err({ error: createApiError({ code: 'NOT_FOUND', message: 'routine not found' }) })
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
    if (routine === null) return err({ error: createApiError({ code: 'NOT_FOUND', message: 'routine not found' }) });
    deps.scheduler.rescheduleOne({ routineId: id });
    return ok({ value: { routine: attachNextRunAt(routine, deps.scheduler) } });
  }
}, { requireSameOrigin: true });

export interface RoutineDeleteResponse {
  readonly ok: true;
}

export const routineDeleteRoute = defineJsonRoute<string, RoutineDeleteResponse, RoutineHttpDeps>({
  method: 'delete', path: '/api/routines/:id', parse: parseRoutineId, handle: async ({ input: id, deps }) => {
    deps.scheduler.unschedule({ routineId: id });
    const removed = await deps.store.delete({ id });
    return removed ? ok({ value: { ok: true } }) : err({ error: createApiError({ code: 'NOT_FOUND', message: 'routine not found' }) });
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

export const routineRunNowRoute = defineJsonRoute<string, RoutineRunNowResponse, RoutineHttpDeps>({
  method: 'post', path: '/api/routines/:id/run', parse: parseRoutineId, handle: async ({ input: id, deps }) => {
    const existing = await deps.store.get({ id });
    if (existing === null) return err({ error: createApiError({ code: 'NOT_FOUND', message: 'routine not found' }) });
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
}

export const routineRunsListRoute = defineJsonRoute<RoutineRunsQuery, RoutineRunsResponse, RoutineHttpDeps>({
  method: 'get', path: '/api/routines/:id/runs', parse: parseRoutineRunsQuery, handle: async ({ input: { id, limit }, deps }) => {
    const existing = await deps.store.get({ id });
    if (existing === null) return err({ error: createApiError({ code: 'NOT_FOUND', message: 'routine not found' }) });
    const runs = await deps.store.listRuns({ routineId: id, limit });
    return ok({ value: { runs } });
  }
});

/** Mounts every routine route on `app`. A pack's `http(app, services)` calls this directly. */
export function registerRoutineRoutes({ app, deps, adapter }: { readonly app: Express; readonly deps: RoutineHttpDeps; readonly adapter: AdapterContext }, _optional: Record<string, never> = {}): void {
  mountJsonRoute({ app, spec: routineListRoute, deps, adapter });
  mountJsonRoute({ app, spec: routineCreateRoute, deps, adapter });
  mountJsonRoute({ app, spec: routineGetRoute, deps, adapter });
  mountJsonRoute({ app, spec: routineUpdateRoute, deps, adapter });
  mountJsonRoute({ app, spec: routineDeleteRoute, deps, adapter });
  mountJsonRoute({ app, spec: routineRunNowRoute, deps, adapter });
  mountJsonRoute({ app, spec: routineRunsListRoute, deps, adapter });
}
