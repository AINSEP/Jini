import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
/**
 * @file `RedirectSlugChangeCapture` — the `SlugChangeCapture` implementation
 * (SPEC-009 REQ-15/16/17; ADR-PIPE-009 Decision A).
 *
 * Purpose:
 * The single implementer of `routing`'s `SlugChangeCapture` slot. Inserts an
 * `active`, `source: 'auto_slug_change'`, `matchType: 'exact'` redirect rule +
 * its revision when an entry's routable slug/path changes, so no request can
 * observe the moved entry without its redirect already existing (INV-02).
 *
 * Correctness discipline (Decision A, load-bearing): this class performs NO
 * transaction control of its own — no `BEGIN`/`COMMIT`/`ROLLBACK` anywhere in
 * this file. It relies entirely on the caller (the content write chokepoint,
 * once wired — see tasks.md's "Known Scope Boundary": that wiring is OUT OF
 * SCOPE for this feature) already holding an open transaction on the same
 * single-connection `better-sqlite3` handle. Writes go through
 * `ports.internal.ts`'s `insertRedirectAndRevision`, the one shared,
 * non-tx-opening insert path this file and `redirects.ts` both use.
 *
 * Idempotency (REQ-17/AC-20): keyed off the routing-owned
 * `SlugChangeCaptureInput`'s `oldPath`/`newPath` rather than a `changeSetId`
 * DB column — `state.spec.md`'s frozen `RedirectRecord`/`RedirectRevision`
 * shapes (mirrored from the already-written `src/redirects/types.ts`) carry
 * no `changeSetId` field, so this reuses the existing
 * `RedirectRepoPort.lookupExact` read (already on the frozen `ports.ts`)
 * to detect "this exact slug-change was already captured": when the rule that
 * requests for `oldPath` actually follow (`RedirectRepoPort.lookupExact`, the
 * resolver's own newest-wins order) is an `active`, `source: 'auto_slug_change'`
 * rule with `toTarget === newPath`, the same change was already captured, so a
 * retry is a no-op rather than a duplicate insert. It must be the WINNING rule,
 * not just any historical match: after `a→b→a→c→a`, an older `/a → /b` still
 * exists but the newer `/a → /c` wins, so renaming `a→b` again has to insert a
 * fresh `/a → /b` or `/a` keeps resolving to `/c`, whose own rule points back
 * at `/a` — a permanent loop.
 *
 * Architectural role:
 * Feature logic. No Express/route code, no direct SQL — writes go through the
 * injected `RedirectDbHandle`; reads go through the injected `RedirectRepoPort`.
 */
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort } from "@jini-ai/core/primitives";
import type { SlugChangeCapture, SlugChangeCaptureInput } from "./ports.js";

import { insertRedirectAndRevision, type RedirectDbHandle } from "./ports.internal.js";
import type { RedirectRecord, RedirectRevision } from "./types.js";

/**
 * The narrow read this capture needs — `RedirectRepoPort.lookupExact` only
 * (idempotency check against the rule resolution actually picks). Declared as
 * a `Pick` rather than the full `RedirectRepoPort` so this file's dependency
 * surface documents exactly what it reads.
 */
export interface RedirectSlugChangeCaptureReadDeps {
  lookupExact(required: {
    workspaceId: string;
    path: string;
    includeOverrideOnly: boolean;
  }, optional?: Record<string, never>): Promise<RedirectRecord | null>;
}

export interface RedirectSlugChangeCaptureDeps {
  repo: RedirectSlugChangeCaptureReadDeps;
  db: RedirectDbHandle;
  clock: ClockPort;
  idGen: IdGeneratorPort;
}

/** Default priority/statusCode/override for an auto-captured rule (behavior.spec.md §3 analog). */
const AUTO_CAPTURE_STATUS_CODE = 301;
const AUTO_CAPTURE_PRIORITY = 0;

export class RedirectSlugChangeCapture implements SlugChangeCapture {
  constructor(private readonly deps: RedirectSlugChangeCaptureDeps, _optional: Record<string, never> = {}) {}

  /**
   * Insert the auto-capture redirect rule for a slug change, or no-op if the
   * exact same change was already captured (idempotent retry, AC-20).
   *
   * MUST be called by a caller that already holds an open transaction on the
   * shared connection (or accepts the no-transaction-safety consequences of
   * calling it outside one) — this method never opens or closes one itself.
   *
   * @throws whatever `db.insertRedirect`/`db.insertRevision` throws,
   * uncaught, so the caller's own transaction aborts (REQ-16/EC-05).
   * @complexity O(1) — one read (idempotency check) + two writes.
   */
  async onSlugChange(input: SlugChangeCaptureInput, _optional: Record<string, never> = {}): Promise<void> {
    const existing = await this.deps.repo.lookupExact({
      workspaceId: input.workspaceId,
      path: input.oldPath,
      includeOverrideOnly: false,
    });
    if (existing && existing.source === "auto_slug_change" && existing.toTarget === input.newPath) {
      // Same change already captured (retry of the same changeSetId) — idempotent no-op.
      return;
    }

    const now = clockNowIso({ clock: this.deps.clock });
    const id = this.deps.idGen.newId();

    const record: RedirectRecord = {
      id,
      workspaceId: input.workspaceId,
      matchType: "exact",
      fromPattern: input.oldPath,
      toTarget: input.newPath,
      statusCode: AUTO_CAPTURE_STATUS_CODE,
      status: "active",
      override: false,
      priority: AUTO_CAPTURE_PRIORITY,
      source: "auto_slug_change",
      sourceEntryId: input.entryId,
      fromPathAtCapture: input.oldPath,
      toPathAtCapture: input.newPath,
      createdByPrincipal: input.actor,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const revision: RedirectRevision = {
      redirectId: id,
      workspaceId: input.workspaceId,
      seq: 1,
      state: record,
      tombstoned: false,
      actorId: input.actor,
      recordedAt: now,
    };

    await insertRedirectAndRevision({ db: this.deps.db, record, revision });
  }
}
