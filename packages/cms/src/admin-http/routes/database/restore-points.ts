import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { rejectRoute } from '@jini-ai/core/errors/route-refusal';

import { requireAuthorizer } from './require-authorizer.js';

/** The restore-point cost classes the host's db-ops capability reports. */
export type RestorePointCostClass = 'cheap' | 'expensive' | 'unavailable';

/** One persisted restore point, as the Database/Recovery restore-points lists render it. */
export interface RestorePointListRow {
  id: string;
  trigger: string;
  costClass: string;
  kind: string;
  watermarkAtCapture: number | null;
  createdAt: string;
  artifactRef: string;
}

/** The summary a create answers with (fresh or replayed). */
export interface RestorePointCreatedSummary {
  id: string;
  costClass: RestorePointCostClass;
  kind: string;
}

/** The row `restorePointsRepo.save` persists for a newly minted restore point. */
export interface RestorePointSaveRow {
  restorePointId: string;
  idempotencyKey: string;
  trigger: string;
  createdAt: string;
  createdBy: string;
  costClass?: string;
  kind?: string;
  watermarkAtCapture?: number | null;
  artifactRef?: string | undefined;
}

/** A thrown-error class the create route maps to a refusal by `instanceof`. */
export type RestorePointErrorClass = abstract new (...args: never[]) => Error;

/** The only deps the list route reads; `listRestorePoints` is the host's restore-points read. */
export interface DatabaseRestorePointsListRouteDeps {
  restorePointsRepo: { list(): Promise<RestorePointListRow[]> };
  listRestorePoints(required: { repo: { list(): Promise<RestorePointListRow[]> } }): Promise<{ items: RestorePointListRow[] }>;
}

/** The only deps the create route reads. `createRestorePoint` owns the cost gate; the two error
 * classes are the ones it throws for "unavailable" (409) and "cost not acknowledged" (400). */
export interface DatabaseRestorePointsCreateRouteDeps {
  workspaceId: string;
  clock: { nowIso(): string };
  dbOps: {
    getCapabilities(): Promise<{ restorePoint: { costClass: RestorePointCostClass; kind: string } }>;
    captureRestorePoint(required: { scopeId: string }): Promise<{ artifactRef: string; watermarkAtCapture: number }>;
  };
  restorePointsRepo: {
    list(): Promise<RestorePointListRow[]>;
    findByIdempotencyKey(key: string): Promise<{ restorePointId: string; idempotencyKey: string } | null>;
    save(row: RestorePointSaveRow): Promise<void>;
  };
  createRestorePoint(required: {
    costClass: RestorePointCostClass;
    kind: string;
    costAck?: boolean;
    capture: () => Promise<{ artifactRef: string; watermarkAtCapture: number }>;
  }): Promise<RestorePointCreatedSummary>;
  restorePointErrors: { unavailable: RestorePointErrorClass; validation: RestorePointErrorClass };
}

/** The create route's three writable POST body fields. */
export interface RestorePointCreateInput {
  trigger: string;
  costAck: boolean;
  idempotencyKey: string;
}

/**
 * This route's three writable POST body fields, read off an untyped body in one place.
 *
 * `idempotencyKey` omission (line below, `randomUUID()`) is a deliberate opt-out, not a bug: no
 * caller in this codebase sends `idempotencyKey` today (the admin UI never does), so making it
 * required would turn every existing real call into a 400 for a body shape no one currently
 * requests updating. A caller that wants retry-safety must supply its own key; one that omits it
 * gets a fresh key per request and is treated as "not asking for idempotency," matching the
 * `findExistingRestorePointSummary` check below, which only ever short-circuits a key the caller
 * chose to repeat.
 *
 * @complexity O(1).
 */
function parseRestorePointCreateBody({ rawBody }: { rawBody: unknown }, _optional = {}): RestorePointCreateInput {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  return {
    trigger: typeof body.trigger === 'string' ? body.trigger : 'manual',
    costAck: body.costAck === true,
    idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : globalThis.crypto.randomUUID(),
  };
}

/**
 * Resolves the two fields the `capture` closure fills in, into the shape `restorePointsRepo.save`
 * persists — `watermarkAtCapture` defaults to `null` (never captured), `artifactRef` stays
 * `undefined` the same way the inline version did (see the 2026-07-16 note this route carries).
 *
 * @complexity O(1).
 */
function toCapturedRow({ captured }: { captured: { artifactRef: string; watermarkAtCapture: number } | undefined }, _optional = {}): {
  watermarkAtCapture: number | null;
  artifactRef: string | undefined;
} {
  return {
    watermarkAtCapture: captured?.watermarkAtCapture ?? null,
    artifactRef: captured?.artifactRef,
  };
}

/**
 * AC-11 idempotency check — if `idempotencyKey` already names a persisted restore point, reconstructs
 * the same `{id, costClass, kind}` summary shape a fresh create returns, instead of re-running the
 * real (costly) `capture()` and inserting a second ledger row. Must be called BEFORE `capture()`,
 * not merely before `save()` — checking only before the insert still burns a real backup on every
 * retry.
 *
 * Pairs the narrow `findByIdempotencyKey` lookup with the same `list()` read the GET route already
 * serves, rather than widening `findByIdempotencyKey`'s own return shape — no change needed to
 * either concrete repo (`SqliteRestorePointsRepo`/`InMemoryRestorePointsRepo` already implement
 * both methods). Mirrors `@jini-ai/db/recovery/lookup-adapters`'s `RestorePointDeepLinkLookup` for the
 * identical accepted O(n) tradeoff (restore points are an operator-curated, low-volume list).
 *
 * Two concurrent requests sharing the same key can still both miss this lookup and both capture —
 * this check alone does not close that race. The `(site_id, idempotency_key)` unique index on the
 * `restore_points` table (`database-journal-schema.ts`) prevents a second row from being persisted,
 * but does not prevent a second real capture from running; closing that fully needs an in-process
 * lock, which is out of scope here (see this dispatch's report).
 *
 * @complexity O(1) lookup plus O(n) over the restore-points list only when a repeat key is found.
 */
async function findExistingRestorePointSummary({ repo, idempotencyKey }: { repo: DatabaseRestorePointsCreateRouteDeps['restorePointsRepo']; idempotencyKey: string }, _optional = {}): Promise<RestorePointCreatedSummary | undefined> {
  const existing = await repo.findByIdempotencyKey(idempotencyKey);
  if (!existing) return undefined;

  const items = await repo.list();
  const row = items.find((item) => item.id === existing.restorePointId);
  // Defensive: the idempotency index just resolved this id, so a missing row here would mean the
  // two reads observed inconsistent state, not a legitimate "not found" — surface it as an error
  // rather than silently falling through to re-capture (which is what this function exists to
  // prevent).
  if (!row) {
    throw new Error(`restore point '${existing.restorePointId}' has a known idempotency key but no persisted row`);
  }
  return { id: row.id, costClass: row.costClass as RestorePointCostClass, kind: row.kind };
}

/** Maps this route's thrown error types onto the admin error envelope; anything else rethrows to
 * the host failure port. @complexity O(1). */
function rethrowRestorePointCreateError({ err, errors }: { err: unknown; errors: DatabaseRestorePointsCreateRouteDeps['restorePointErrors'] }, _optional = {}): never {
  if (err instanceof errors.unavailable) rejectRoute({ status: 409, error: err.message, code: 'RESTORE_POINT_UNAVAILABLE' });
  if (err instanceof errors.validation) rejectRoute({ status: 400, error: err.message, code: 'VALIDATION_ERROR' });
  throw err;
}

/**
 * Composes `createRestorePoint` (the cost-gate decision + the real `dbOps.captureRestorePoint()`
 * backup) with `restorePointsRepo.save()` (the durable row `createRestorePoint` itself never
 * writes — persistence is deliberately the caller's job). The `capture` closure's result is
 * captured via an outer variable so the route can persist the real `artifactRef`/
 * `watermarkAtCapture` `createRestorePoint`'s return value does not carry.
 * @complexity O(1) plus one capability read, one capture and one save.
 */
async function mintRestorePoint({ input, deps, principalId }: { input: RestorePointCreateInput; deps: DatabaseRestorePointsCreateRouteDeps; principalId: string }, _optional = {}): Promise<RestorePointCreatedSummary> {
  const capabilities = await deps.dbOps.getCapabilities();
  let captured: { artifactRef: string; watermarkAtCapture: number } | undefined;

  const summary = await deps.createRestorePoint({
    costClass: capabilities.restorePoint.costClass,
    kind: capabilities.restorePoint.kind,
    costAck: input.costAck,
    capture: async () => {
      captured = await deps.dbOps.captureRestorePoint({ scopeId: deps.workspaceId });
      return captured;
    },
  });

  await deps.restorePointsRepo.save({
    restorePointId: summary.id,
    idempotencyKey: input.idempotencyKey,
    trigger: input.trigger,
    createdAt: deps.clock.nowIso(),
    createdBy: principalId,
    costClass: summary.costClass,
    kind: summary.kind,
    // 2026-07-16: was captured above but previously never persisted — the root cause of why
    // Recovery's restore ceremony could only write a "ledger-only" note (no way to know which
    // file to restore from). See `features/recovery/gated-hooks.ts`'s `buildRestoreHooks`.
    ...toCapturedRow({ captured }),
  });
  return summary;
}

/**
 * @file design-spec.md §3.2/§3.8 — `GET /api/admin/v1/database/restore-points` (newest-first
 * restore-points list, the shared column source Database's and Recovery's own restore-points list
 * views both read — `database.read`'s own description already names "restore points" as part of
 * what it covers, ADR-041 §6). Gated by `database.read`.
 */
export const adminDatabaseRestorePointsListRoute = defineJsonRoute<undefined, { items: RestorePointListRow[] }, DatabaseRestorePointsListRouteDeps, { id: string }>({
  method: 'get',
  path: '/api/admin/v1/database/restore-points',
  parse: () => ok({ value: undefined }),
  handle: async ({ deps, authorize }) => {
    await requireAuthorizer({ authorize })({ permission: 'database.read', entityType: 'restore-point' });
    return ok({ value: await deps.listRestorePoints({ repo: deps.restorePointsRepo }) });
  },
});

/**
 * @file design-spec.md §3.3/§3.8 — `POST /api/admin/v1/database/restore-points` (mints an ad hoc
 * restore point independent of any migration, REQ-22/AC-26/AC-27). Gated by `backup.create`.
 * The body parse is total (defaults only), so authorization still runs before any repository or
 * capability read.
 */
export const adminDatabaseRestorePointsCreateRoute = defineJsonRoute<RestorePointCreateInput, { restorePoint: RestorePointCreatedSummary }, DatabaseRestorePointsCreateRouteDeps, { id: string }>({
  method: 'post',
  path: '/api/admin/v1/database/restore-points',
  parse: (raw) => ok({ value: parseRestorePointCreateBody({ rawBody: raw.body }) }),
  handle: async ({ input, deps, context, authorize }) => {
    await requireAuthorizer({ authorize })({ permission: 'backup.create', entityType: 'restore-point' });
    if (!context) throw new Error('restore-point create requires an authenticated principal');
    try {
      // AC-11: a repeat idempotencyKey returns the ORIGINAL restore point — checked before any
      // capability/cost-gate work and, critically, before `capture()` below, since the whole point
      // is to never re-run the real (costly) backup on a retry.
      const existingSummary = await findExistingRestorePointSummary({ repo: deps.restorePointsRepo, idempotencyKey: input.idempotencyKey });
      if (existingSummary) return ok({ value: { restorePoint: existingSummary } });
      return ok({ value: { restorePoint: await mintRestorePoint({ input, deps, principalId: context.id }) } });
    } catch (err) {
      return rethrowRestorePointCreateError({ err, errors: deps.restorePointErrors });
    }
  },
}, { successStatus: 201 });
