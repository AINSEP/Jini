/**
 * @file the Timeline read
 * model.
 *
 * Purpose:
 * Renders the never-brick ledger (migrations, snapshots, index provisions, template upgrades,
 * restores, interrupted migrations) as a filterable, cursor-paginated read surface. This module
 * is deliberately read-only by construction — no raw-row-edit, SQL-console, or DB-first-mode
 * export may ever exist here; that is a permanent category error against this codebase's
 * write-chokepoint/authorize/append-only-revision model ("Why Database, not Database").
 *
 * How it relates to the project:
 * `LedgerReadPort` is implemented by the sidecar ops-journal adapter; this module
 * has no knowledge of that adapter's database details.
 *
 * Architectural role:
 * `features/database` domain logic. Depends only on the injected `LedgerReadPort`.
 * See docs/decisions/DR-001-bounded-operational-timeline.md.
 */

/** One row of the append-only `database_ledger`, as rendered to the Timeline UI. See docs/decisions/DR-001-bounded-operational-timeline.md. */
export interface LedgerRow {
  id: string;
  kind: string;
  /** ISO-8601 UTC. */
  createdAt: string;
  restorePointId: string | null;
  outcome: string;
}

export interface LedgerReadPort {
  query(filter: {
    kind?: string | undefined;
    fromDate?: string | undefined;
    toDate?: string | undefined;
    outcome?: string | undefined;
    cursor?: string | null | undefined;
    limit: number;
  }): Promise<{ items: LedgerRow[]; nextCursor: string | null }>;
}

/** The server-side row cap — no raw/unbounded query surface is ever offered. See docs/decisions/DR-001-bounded-operational-timeline.md. */
export const MAX_TIMELINE_PAGE_SIZE = 200;
/** Page size when a caller names none. */
export const DEFAULT_TIMELINE_PAGE_SIZE = 50;

/** Thrown when a caller requests a page size above the server's bound. */
class TimelineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelineValidationError";
  }
}

/**
 * Returns a filtered, cursor-paginated page of the Timeline ledger.
 *
 * @complexity O(1) plus one `LedgerReadPort.query()` call (the port owns the actual scan/index
 * cost).
 * @overallScore 100
 */
export async function getTimeline(
  required: {
    ledger: LedgerReadPort;
    filter?: { kind?: string | undefined; fromDate?: string | undefined; toDate?: string | undefined; outcome?: string | undefined; cursor?: string | undefined; limit?: number | undefined };
  },
  _optional: Record<string, never> = {}
): Promise<{ items: LedgerRow[]; nextCursor: string | null }> {
  const { ledger, filter = {} } = required;
  const limit = filter.limit ?? DEFAULT_TIMELINE_PAGE_SIZE;

  if (!Number.isInteger(limit) || limit < 1) {
    // A 0 or fractional limit reached the ledger as an empty page or a fractional SQL LIMIT; an HTTP
    // caller's `Number("abc")` arrived as NaN.
    throw new TimelineValidationError(`'limit' must be an integer between 1 and ${MAX_TIMELINE_PAGE_SIZE}`);
  }
  if (limit > MAX_TIMELINE_PAGE_SIZE) {
    // See docs/decisions/DR-001-bounded-operational-timeline.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
    throw new TimelineValidationError(`requested limit ${limit} exceeds the server cap of ${MAX_TIMELINE_PAGE_SIZE}`);
  }

  return ledger.query({ ...filter, limit });
}
