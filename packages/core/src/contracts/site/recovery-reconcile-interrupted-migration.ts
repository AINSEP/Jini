/**
 * @file The per-site serve-status port read by the serving gate and written by boot-time crash
 * reconciliation. Types only.
 *
 * Owner of these declarations; `@jini-ai/db/recovery/reconcile-interrupted-migration` re-exports
 * the types from here. A crashed-mid-
 * migration site is set to `BLOCKED_PENDING_RECOVERY` and blocks normal site open until an
 * operator resolves it via Recovery. The reconciler itself and its other ports stay in the db
 * package.
 */

export type SiteServeStatus = "SERVING" | "PENDING_MIGRATION" | "BLOCKED_PENDING_RECOVERY";

export interface SiteStatusPort {
  get(siteId: string): Promise<SiteServeStatus>;
  set(siteId: string, status: SiteServeStatus): Promise<void>;
}
