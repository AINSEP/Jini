/**
 * @file The admin `recovery` status wire DTOs (ADR-045 §4): the body `GET /api/admin/v1/recovery/status`
 * answers with and an admin client reads. Declared here, once, so the route spec
 * (`@jini-ai/cms/admin-http/routes/recovery/status`), the host's banner binding and any client mirror
 * read the same shapes without the client depending on CMS or the database package. Banner
 * precedence stays in the database package; only the declarations sit in Core.
 *
 * Core cannot import the database package, so its `DegradedBanner` and `DegradedBannerCapabilities`
 * are restated structurally here; a host that binds `resolveDegradedBanner` to the status spec
 * compiles only while the two sides agree. Keep them identical.
 */

/** The restore-point cost class the database reports. */
export type AdminRecoveryCostClass = 'cheap' | 'expensive' | 'unavailable';

/** Why the recovery feature itself may be degraded right now, independent of any one restore point. */
export type AdminDegradedBannerKind =
  | 'migration-interrupted'
  | 'pending-migration'
  | 'operation-in-flight'
  | 'cost-unavailable'
  | 'watermark-baseline-unavailable';

/** The one action a degraded banner offers. */
export type AdminDegradedBannerActionKind = 'deep-link-to-database-migration' | 'unblock-interrupted-migration' | 'none';

/** The single highest-precedence degraded banner; `accessibleText` is host-composed copy, rendered as-is. */
export interface AdminDegradedBannerDto {
  kind: AdminDegradedBannerKind;
  accessibleText: string;
  actionKind: AdminDegradedBannerActionKind;
}

/** The capability flags the banner precedence reads. */
export interface AdminRecoveryCapabilities {
  costClass: AdminRecoveryCostClass;
  operationInFlight: boolean;
  pendingMigration: boolean;
  migrationInterrupted: boolean;
  watermarkBaselineAvailable: boolean;
}

/** `GET /api/admin/v1/recovery/status`: the cost class and the one banner to show, or `null` for none. */
export interface AdminRecoveryStatusEnvelope {
  costClass: AdminRecoveryCostClass;
  banner: AdminDegradedBannerDto | null;
}
