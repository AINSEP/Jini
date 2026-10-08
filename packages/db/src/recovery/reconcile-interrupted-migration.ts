/**
 * @file SPEC-017 C-106 / CIC U-004 / REQ-15 / AC-17 — boot-time crash reconciliation
 * (ADR-041 §3).
 *
 * Purpose:
 * A boot scanner that converts any non-terminal `migration_runs` row (read from the sidecar ops
 * journal — the only place guaranteed to survive a mid-crash restore of `content.db`, ADR-041 §2)
 * into a `migration.interrupted` ledger row, and blocks normal site open until an operator
 * resolves it via Recovery. This is a real, accepted downtime vector, traded deliberately for
 * "never boot into a half-migrated schema" (ADR-041 §3).
 *
 * How it relates to the project:
 * The boot composition root calls this BEFORE `evaluate-boot-migration-policy.ts`'s
 * `evaluateBootMigrationPolicy` (C-107) every boot cycle (U-004-ORD1) — that ordering is a
 * composition-root wiring concern this module cannot itself enforce; the sibling `defensive`
 * precondition check lives in `evaluate-boot-migration-policy.ts` instead.
 *
 * ADR-041/043/044/045 re-audit (2026-07-16, TM-adr041-043-044-045-audit-001, Finding 2 — hard
 * blocker fix): this function is now actually invoked, by `server/runtime/boot/bootstrap.ts`'s
 * `database-migration-reconciliation` boot module (a CRITICAL ADR-046 Phase 2 boot module, runs
 * first), before the real server accepts any traffic. It was previously fully built and
 * unit-tested but never called by any composition root — a real, live gap (not just a "seams
 * only" v1 disclosure) this fix closes. `evaluate-boot-migration-policy.ts`'s
 * `evaluateBootMigrationPolicy` (C-107) itself remains NOT wired into any composition root —
 * that is `SERVE_SITE` cost-gated auto-migration, a separate, larger, still-deferred capability
 * this fix does not build; only the crash-detection half above is now live.
 *
 * Architectural role:
 * `features/database` domain logic. Depends only on the injected ports.
 */

export interface MigrationRunsRepoPort {
  findNonTerminalForSite(siteId: string): Promise<{ id: string; status: string } | null>;
  /**
   * Round-5 re-audit (2026-07-16, TM-adr041-043-044-045-audit-001, codex `R5-F1-BLOCKED-RECOVERY-
   * NOT-RESTART-SAFE` / Fable `R5-F2-BLOCK-HAS-NO-EXIT`, both independently confirmed): before this
   * fix, no production code path ever terminalized a non-terminal `migration_runs` row, so a
   * successful Recovery restore left `BLOCKED_PENDING_RECOVERY` in place forever — the block had no
   * exit. Marks the run terminal (`RESTORED`) so the next boot's `findNonTerminalForSite` no longer
   * re-detects it.
   */
  markResolved(params: { id: string }): Promise<void>;
}

export interface BootLedgerPort {
  appendInterruptedRow(params: { siteId: string; migrationRunId: string }): Promise<void>;
}

export type SiteServeStatus = "SERVING" | "PENDING_MIGRATION" | "BLOCKED_PENDING_RECOVERY";

export interface SiteStatusPort {
  get(siteId: string): Promise<SiteServeStatus>;
  set(siteId: string, status: SiteServeStatus): Promise<void>;
}

/**
 * Reconciles any crashed-mid-migration state found for `siteId` on boot.
 *
 * @complexity O(1) plus one repo read and, when a non-terminal row exists, one ledger append and
 * one status write.
 */
export async function reconcileInterruptedMigrationOnBoot(
  required: { siteId: string; migrationRuns: MigrationRunsRepoPort; ledger: BootLedgerPort; siteStatus: SiteStatusPort },
  _optional: Record<string, never> = {}
): Promise<{ blocked: boolean }> {
  const { siteId, migrationRuns, ledger, siteStatus } = required;

  const nonTerminal = await migrationRuns.findNonTerminalForSite(siteId);
  if (!nonTerminal) {
    return { blocked: false };
  }

  await ledger.appendInterruptedRow({ siteId, migrationRunId: nonTerminal.id });
  await siteStatus.set(siteId, "BLOCKED_PENDING_RECOVERY");
  return { blocked: true };
}
