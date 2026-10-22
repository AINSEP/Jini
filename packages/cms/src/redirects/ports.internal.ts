/**
 * @file Package-private shared insert helper for the `redirects` write path
 * (ADR-PIPE-009 Decision A).
 *
 * Purpose:
 * `insertRedirectAndRevision` is the sole path INV-01 depends on: exactly one
 * `redirects` row write + one `redirect_revisions` row write, in call order,
 * against whatever `RedirectDbHandle` the caller passes in. It performs NO
 * transaction control of its own (no `BEGIN`/`COMMIT`) — atomicity is the
 * CALLER's responsibility: `redirects.ts`'s chokepoint wraps a call to this
 * function in its own `BEGIN IMMEDIATE`/`COMMIT`; `capture.ts` calls it
 * directly, relying on the (future) content chokepoint's already-open ambient
 * transaction on the same single-connection `better-sqlite3` handle
 * (ADR-PIPE-009 Decision A, EC-05).
 *
 * Import-graph note: the domain-logic callers of this function are
 * `redirects.ts` and `capture.ts` only (ADR-PIPE-009/tasks.md T012) — no route
 * handler or UI code may import it. `repo.memory.ts`/`repo.sqlite.ts` import
 * only the `RedirectDbHandle` TYPE (not this function) to declare the shape
 * their own storage satisfies; they do not call `insertRedirectAndRevision`
 * themselves (each adapter's own `save`/`tombstone` port methods write via
 * their own direct storage calls, independently testable by the
 * `RedirectRepoPort` contract suite, T007). This keeps the chokepoint
 * boundary (INV-07) at {`redirects.ts`, `capture.ts`, `ports.internal.ts`},
 * matching the Enforcement section's review-time check.
 *
 * Architectural role:
 * Package-private. NOT exported from `index.ts` (ADR-PIPE-009 Migration
 * Safety / File Map).
 */
import type { RedirectRecord, RedirectRevision } from "./types.js";

/**
 * The minimal storage seam `insertRedirectAndRevision` writes through.
 * Deliberately narrower than `RedirectRepoPort` (no reads, no transaction
 * control) — both `repo.memory.ts` and `repo.sqlite.ts` (or a small internal
 * handle each of them owns) satisfy this shape so `redirects.ts`/`capture.ts`
 * can share one write path regardless of which adapter is active.
 */
export interface RedirectDbHandle {
  insertRedirect(record: RedirectRecord, optional?: Record<string, never>): void | Promise<void>;
  insertRevision(revision: RedirectRevision, optional?: Record<string, never>): void | Promise<void>;
}

export interface InsertRedirectAndRevisionRequired {
  db: RedirectDbHandle;
  record: RedirectRecord;
  revision: RedirectRevision;
}

/**
 * Insert a `redirects` row and its paired `redirect_revisions` row, in that
 * order, against `db`. Never opens or closes a transaction; any error from
 * `db` propagates uncaught so the caller's own transaction (or lack thereof)
 * decides the outcome.
 *
 * @complexity O(1) — two writes, no I/O beyond what `db` itself performs.
 */
export async function insertRedirectAndRevision(
  required: InsertRedirectAndRevisionRequired,
  _optional: Record<string, never> = {},
): Promise<void> {
  const { db, record, revision } = required;
  await db.insertRedirect(record);
  await db.insertRevision(revision);
}
