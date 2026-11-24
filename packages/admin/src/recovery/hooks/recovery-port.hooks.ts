import type { AdminRestorePoint, AdminRestorePointSummary } from "../../core/ports/database.js";
import type { AdminRecoveryDeepLinkResult, AdminRecoveryStatus, DatabaseContextEnvelope } from "../../core/ports/recovery.js";

/**
 * @file What `use-recovery.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import. Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * the host admin app's Hooks guide.
 */
export interface RecoveryPort {
  getRecoveryStatus(): Promise<AdminRecoveryStatus>;
  listRecoveryRestorePoints(): Promise<{ items: AdminRestorePoint[] }>;
  /** Restore-point functionality consolidation (2026-09-10, the host's todo log) — Recovery now
   *  owns the create action Database's `RestorePointsSection` used to. */
  createRestorePoint(input: Record<string, never>, options?: { trigger?: string; costAck?: boolean }): Promise<{ restorePoint: AdminRestorePointSummary }>;
  resolveRecoveryDeepLink(envelope: DatabaseContextEnvelope): Promise<AdminRecoveryDeepLinkResult>;
}
