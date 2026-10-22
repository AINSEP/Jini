import type { MigrationRunsRepoPort, SiteStatusPort } from "./reconcile-interrupted-migration.js";

/**
 * @file SPEC-017 C-107 / CIC U-004 / INV-08 / REQ-28 / REQ-29 — cost-gated `SERVE_SITE` auto-
 * migrate policy (ADR-041 §10, amends SPEC-003).
 *
 * Purpose:
 * Routes serve-time migration through the same snapshot-anchored ceremony as an interactive
 * migration, gated by `costClass`: `'cheap'` (the common SQLite whole-file-snapshot case)
 * auto-migrates under a reserved no-token boot policy attributed to the seeded `kind='system'`
 * principal; `'expensive'`/`'unavailable'` refuse to auto-migrate and instead enter the site into
 * `PENDING_MIGRATION`, requiring an interactive plan/confirm/execute before normal serving
 * resumes.
 *
 * How it relates to the project:
 * Must only ever run AFTER `reconcile-interrupted-migration.ts`'s `reconcileInterruptedMigrationOnBoot`
 * has resolved for this boot cycle (U-004-ORD1) — the boot composition root's own call-site
 * ordering is what actually enforces that sequencing; this function additionally refuses,
 * defense-in-depth, if it ever observes a still-non-terminal `migration_runs` row itself (U-004-B1),
 * so an out-of-order wiring bug fails closed rather than silently auto-migrating over an unresolved
 * crash.
 *
 * Architectural role:
 * `features/database` domain logic. Depends only on the injected ports.
 */

/** Thrown when a non-terminal `migration_runs` row still exists — defense-in-depth against out-of-order boot wiring (U-004-B1). */
export class UnresolvedInterruptedMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnresolvedInterruptedMigrationError";
  }
}

/**
 * Evaluates and applies the cost-gated `SERVE_SITE` auto-migrate policy for one boot cycle.
 *
 * @complexity O(1) plus one repo read and either one `runAutoMigrate()` call or one status write.
 */
export async function evaluateBootMigrationPolicy(
  required: {
    siteId: string;
    costClass: "cheap" | "expensive" | "unavailable";
    siteStatus: SiteStatusPort;
    migrationRuns: MigrationRunsRepoPort;
    runAutoMigrate: () => Promise<void>;
  },
  _optional: Record<string, never> = {}
): Promise<void> {
  const { siteId, costClass, siteStatus, migrationRuns, runAutoMigrate } = required;

  const nonTerminal = await migrationRuns.findNonTerminalForSite(siteId);
  if (nonTerminal) {
    throw new UnresolvedInterruptedMigrationError(
      `refusing to evaluate boot migration policy for site '${siteId}' while migration_runs row '${nonTerminal.id}' is still non-terminal`
    );
  }

  if (costClass === "cheap") {
    await runAutoMigrate();
    return;
  }

  // REQ-29/REQ-30: 'expensive' or 'unavailable' never auto-migrate; the site boots degraded,
  // admin-reachable, public serving refused, until an interactive execute resolves it.
  await siteStatus.set(siteId, "PENDING_MIGRATION");
}
