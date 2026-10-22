/**
 * @file SPEC-019 C-308 / behavior.spec.md §1.1 — degraded-state banner precedence resolver
 * (ADR-045 §4).
 *
 * Purpose:
 * Fixed precedence, highest to lowest: `migration.interrupted` > `PENDING_MIGRATION` >
 * operation-in-flight > `costClass:'unavailable'` > watermark-baseline-unavailable. Only the
 * PRIMARY banner selection is this resolver's contract (EC-06) — "an interrupted-run banner stays
 * visible beneath a superseded pending-migration banner" is a rendering-layer composition concern
 * this function does not own.
 *
 * `PENDING_MIGRATION`'s action always deep-links to the Database Timeline's own migration ceremony, never a
 * Recovery restore-flow action (AC-27/INV-07, ADR-045 §4) — restoring to an older snapshot does
 * not resolve schema drift against the current runtime.
 */

export type DegradedBannerKind =
  | "migration-interrupted"
  | "pending-migration"
  | "operation-in-flight"
  | "cost-unavailable"
  | "watermark-baseline-unavailable";

export type DegradedBannerActionKind = "deep-link-to-database-migration" | "unblock-interrupted-migration" | "none";

export interface DegradedBanner {
  kind: DegradedBannerKind;
  accessibleText: string;
  actionKind: DegradedBannerActionKind;
}

export interface DegradedBannerCapabilities {
  costClass: "cheap" | "expensive" | "unavailable";
  operationInFlight: boolean;
  pendingMigration: boolean;
  migrationInterrupted: boolean;
  watermarkBaselineAvailable: boolean;
}

export interface ResolveDegradedBannerRequired {
  capabilities: DegradedBannerCapabilities;
}

/**
 * AC-27/AC-29/EC-06/INV-07 — resolves the single primary degraded banner per the fixed precedence
 * order, or `null` when no degraded condition holds.
 *
 * @complexity O(1) — a fixed sequence of independent comparisons, no loop.
 */
export function resolveDegradedBanner(
  required: ResolveDegradedBannerRequired,
  _optional: Record<string, never> = {}
): DegradedBanner | null {
  const { capabilities } = required;

  if (capabilities.migrationInterrupted) {
    return {
      kind: "migration-interrupted",
      accessibleText:
        "A migration was interrupted mid-run. This is a real, accepted planned downtime vector, not a bug — resolve it to reopen normal Database/Recovery navigation.",
      actionKind: "unblock-interrupted-migration",
    };
  }

  if (capabilities.pendingMigration) {
    return {
      kind: "pending-migration",
      accessibleText:
        "This site is pending a schema migration before normal public serving can resume. Resolve it from the Database Timeline's own migration ceremony.",
      actionKind: "deep-link-to-database-migration",
    };
  }

  if (capabilities.operationInFlight) {
    return {
      kind: "operation-in-flight",
      accessibleText:
        "An operation is already in progress for this site. A second migrate or restore cannot start until it finishes.",
      actionKind: "none",
    };
  }

  if (capabilities.costClass === "unavailable") {
    return {
      kind: "cost-unavailable",
      accessibleText:
        "No restore-point mechanism is available for this site. See the runbook for external backup guidance.",
      actionKind: "none",
    };
  }

  if (!capabilities.watermarkBaselineAvailable) {
    return {
      kind: "watermark-baseline-unavailable",
      // Rewritten (web-design pass): the prior copy said "right now", which frames this as a
      // transient blip an operator might retry — but `watermarkBaselineAvailable` is currently a
      // hardcoded `false` (an "honest stub", see both `disclosure.ts` and this route's own
      // `status.ts`), not a live computation that can fail-then-succeed. "Right now" is therefore
      // actively misleading about the site's real state. This text also avoids the internal terms
      // "discarded-write-window"/"watermark baseline" and says what still works (restoring) and
      // what the operator will see instead (counts marked "unknown", not a verified zero — the
      // same word `DisclosurePanel`'s own per-point disclosure uses, so the two stay consistent).
      accessibleText:
        "This site can't show exactly what a restore would discard. Restoring still works — the counts you'll see are marked \"unknown\" rather than a confirmed number.",
      actionKind: "none",
    };
  }

  return null;
}
