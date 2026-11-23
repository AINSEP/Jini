import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

/**
 * @file design-spec.md §4.2/§4.4/§4.8 — `GET /api/admin/v1/recovery/status` (the capability/status
 * bar + the single highest-precedence degraded banner, ADR-045 §4). Gated by `backup.read`.
 *
 * `resolveDegradedBanner` itself is pure/no-I/O (`degraded-banners.ts`'s own file header) — this
 * route's only job is assembling its `capabilities` input from real (or, where disclosed below,
 * honestly-stubbed) sources:
 *  - `costClass`: real, from `deps.dbOps.getCapabilities()` (`db/sqlite/db-ops.ts`'s
 *    `SqliteDbOpsAdapter` in the running server).
 *  - `pendingMigration`/`migrationInterrupted`: real read of `deps.siteStatusRepo`. ADR-041/043/
 *    044/045 re-audit (2026-07-16, TM-adr041-043-044-045-audit-001, Finding 2 fix): the host's
 *    database-migration reconciliation boot module runs before the site opens to traffic, so this
 *    reflects a REAL crash-interrupted-migration determination, not an always-`false` stub.
 *  - `operationInFlight`: real, from the host operation lock's `isOperationInFlight` read-only peek
 *    (injected). ADR-041/043/044/045 re-audit (2026-07-16, TM-adr041-043-044-045-audit-001,
 *    Finding 3): the lock itself was already live in both gated ceremonies' `execute` routes
 *    (`migrate-forward.ts`/`restore.ts` both acquire and release it) — this route's own hardcoded
 *    `false` was the only actual gap, a display-only stub. The peek closes it without changing the
 *    mutual-exclusion mechanism itself.
 *  - `watermarkBaselineAvailable`: `false`, matching `disclosure.ts` route's own honest stub.
 */

/** The restore-point cost class the database reports (`DbOpsPort`'s capability). */
export type RecoveryStatusCostClass = "cheap" | "expensive" | "unavailable";

/** The capability flags the banner precedence reads (`@jini-ai/db/recovery/degraded-banners`). */
export interface RecoveryStatusCapabilities {
  costClass: RecoveryStatusCostClass;
  operationInFlight: boolean;
  pendingMigration: boolean;
  migrationInterrupted: boolean;
  watermarkBaselineAvailable: boolean;
}

/** The deps this route reads: the workspace, its two status sources, the operation-lock peek and
 * the database package's banner precedence (all bound by the host). The host adds `authorize`. */
export interface RecoveryStatusRouteDeps {
  workspaceId: string;
  dbOps: { getCapabilities(): Promise<{ restorePoint: { costClass: RecoveryStatusCostClass } }> };
  siteStatusRepo: { get(workspaceId: string): Promise<string | null | undefined> };
  isOperationInFlight: (required: { siteId: string }, optional: Record<string, never>) => boolean;
  resolveDegradedBanner: (required: { capabilities: RecoveryStatusCapabilities }) => unknown;
}

/** The principal fields this route reads: only its presence (authorization keys on it). */
export interface RecoveryStatusPrincipal { id: string }

/** The status bar body: the cost class and the one banner to show (or none). */
export interface RecoveryStatusResponse { costClass: RecoveryStatusCostClass; banner: unknown }

/** Framework-neutral spec; the host mounts it with direct (non-publish-credential) authorization. */
export const recoveryStatusRoute = defineJsonRoute<undefined, RecoveryStatusResponse, RecoveryStatusRouteDeps, RecoveryStatusPrincipal>({
  method: "get",
  path: "/api/admin/v1/recovery/status",
  parse: () => ok({ value: undefined }),
  handle: async ({ deps, context, authorize }) => {
    if (!context) throw new Error("recovery status route has no authenticated principal");
    if (!authorize) throw new Error("recovery status route authorizer is required");
    await authorize({ permission: "backup.read", entityType: "restore-point" });

    const capabilities = await deps.dbOps.getCapabilities();
    const siteStatus = await deps.siteStatusRepo.get(deps.workspaceId);
    const banner = deps.resolveDegradedBanner({
      capabilities: {
        costClass: capabilities.restorePoint.costClass,
        operationInFlight: deps.isOperationInFlight({ siteId: deps.workspaceId }, {}),
        pendingMigration: siteStatus === "PENDING_MIGRATION",
        migrationInterrupted: siteStatus === "BLOCKED_PENDING_RECOVERY",
        watermarkBaselineAvailable: false,
      },
    });
    return ok({ value: { costClass: capabilities.restorePoint.costClass, banner } });
  },
});
