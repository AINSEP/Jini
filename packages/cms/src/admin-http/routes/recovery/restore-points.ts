import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

/**
 * @file design-spec.md §4.2/§4.8 — `GET /api/admin/v1/recovery/restore-points` (Recovery's own
 * restore-points list view — the "Backups" list, ADR-045 §3). Gated by `backup.read`.
 *
 * Reuses `database/restore-points.ts`'s `listRestorePoints` and the same `restorePointsRepo`
 * the Database restore-points route reads — one persisted list, two gated views, per
 * ADR-045 §1 ("Database and Recovery are sibling faces" of the same underlying record).
 */

/** The one collaborator this route calls: the database package's restore-point listing, bound by
 * the host to its repository (read per request). The host adds its workspace/authorize fields. */
export interface RecoveryRestorePointsListRouteDeps {
  listRestorePoints: () => Promise<{ items: readonly unknown[] }>;
}

/** The principal fields this route reads: only its presence (authorization keys on it). */
export interface RecoveryRestorePointsListPrincipal { id: string }

/** Framework-neutral spec; the host mounts it with direct (non-publish-credential) authorization. */
export const recoveryRestorePointsListRoute = defineJsonRoute<undefined, { items: readonly unknown[] }, RecoveryRestorePointsListRouteDeps, RecoveryRestorePointsListPrincipal>({
  method: "get",
  path: "/api/admin/v1/recovery/restore-points",
  parse: () => ok({ value: undefined }),
  handle: async ({ deps, context, authorize }) => {
    if (!context) throw new Error("recovery restore-points route has no authenticated principal");
    if (!authorize) throw new Error("recovery restore-points route authorizer is required");
    await authorize({ permission: "backup.read", entityType: "restore-point" });
    return ok({ value: await deps.listRestorePoints() });
  },
});
