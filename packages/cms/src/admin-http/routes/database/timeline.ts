import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { rejectRoute } from '@jini-ai/core/errors/route-refusal';

import { requireAuthorizer } from './require-authorizer.js';

/** This route's six filter fields. */
export interface DatabaseTimelineFilter {
  kind: string | undefined;
  outcome: string | undefined;
  fromDate: string | undefined;
  toDate: string | undefined;
  cursor: string | undefined;
  limit: number | undefined;
}

/** One ledger row, as the Timeline renders it. */
export interface DatabaseTimelineRow {
  id: string;
  kind: string;
  createdAt: string;
  restorePointId: string | null;
  outcome: string;
}

/** One cursor-paginated Timeline page. */
export interface DatabaseTimelinePage {
  items: DatabaseTimelineRow[];
  nextCursor: string | null;
}

/** The ledger read port `getTimeline` queries. */
export interface DatabaseTimelineLedger {
  query(filter: { kind?: string | undefined; fromDate?: string | undefined; toDate?: string | undefined; outcome?: string | undefined; cursor?: string | null | undefined; limit: number }): Promise<DatabaseTimelinePage>;
}

/** The only deps this route reads; `getTimeline` is the host's Timeline read model. */
export interface DatabaseTimelineRouteDeps {
  databaseLedgerRepo: DatabaseTimelineLedger;
  getTimeline(required: { ledger: DatabaseTimelineLedger; filter: DatabaseTimelineFilter }): Promise<DatabaseTimelinePage>;
  /** Whether `err` (thrown by `getTimeline`) is a caller mistake — a 400 `VALIDATION_ERROR` —
   *  rather than a server failure. Host-bound because the error classes (the read model's limit
   *  check, the ledger's cursor decoder) belong to the host's implementations, not this route. */
  isTimelineValidationError(required: { err: unknown }): boolean;
}

/** A query field, read as a string if present, or `undefined`.
 *  @complexity O(1). */
function readOptionalQueryString({ value }: { value: unknown }, _optional = {}): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** This route's six filter fields, read off the query in one place.
 *  @complexity O(1). */
function parseTimelineFilter(query: Record<string, unknown>): DatabaseTimelineFilter {
  return {
    kind: readOptionalQueryString({ value: query.kind }),
    outcome: readOptionalQueryString({ value: query.outcome }),
    fromDate: readOptionalQueryString({ value: query.fromDate }),
    toDate: readOptionalQueryString({ value: query.toDate }),
    cursor: readOptionalQueryString({ value: query.cursor }),
    limit: typeof query.limit === 'string' ? Number(query.limit) : undefined,
  };
}

/** Maps `getTimeline`'s thrown errors onto the admin error envelope — whatever the host's
 *  `isTimelineValidationError` classifies as a validation error is a 400, everything else rethrows
 *  to the host failure port (a 500).
 *  @complexity O(1). */
function rethrowTimelineError({ err, isTimelineValidationError }: { err: unknown; isTimelineValidationError: DatabaseTimelineRouteDeps['isTimelineValidationError'] }, _optional = {}): never {
  if (!isTimelineValidationError({ err })) throw err;
  const message = err instanceof Error ? err.message : 'Invalid timeline query.';
  return rejectRoute({ status: 400, error: message, code: 'VALIDATION_ERROR' });
}

/**
 * @file SPEC-017 C-101 / REQ-01 / REQ-04 — `GET /api/admin/v1/database/timeline` (ADR-041 §1's
 * read-first Timeline). Gated by `database.read` (ADR-041 §6's permission catalog).
 *
 * The first (and, for this dispatch, only) Database/Recovery admin route wired end-to-end against
 * a real adapter (`SqliteDatabaseLedgerRepo`) — demonstrates the sidecar journal is genuinely
 * reachable over HTTP. The parse is total: the filter is only validated by `getTimeline`, after
 * authorization, exactly as the hand-written route did.
 */
export const adminDatabaseTimelineRoute = defineJsonRoute<DatabaseTimelineFilter, DatabaseTimelinePage, DatabaseTimelineRouteDeps, { id: string }>({
  method: 'get',
  path: '/api/admin/v1/database/timeline',
  parse: (raw) => ok({ value: parseTimelineFilter(raw.query) }),
  handle: async ({ input, deps, authorize }) => {
    await requireAuthorizer({ authorize })({ permission: 'database.read', entityType: 'database-ledger' });
    try {
      return ok({ value: await deps.getTimeline({ ledger: deps.databaseLedgerRepo, filter: input }) });
    } catch (err) {
      return rethrowTimelineError({ err, isTimelineValidationError: deps.isTimelineValidationError });
    }
  },
});
