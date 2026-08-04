import type { IdGeneratorPort, UUID } from "../core/ports.js";
import type { PolicyPermissionRepoPort, PolicyRepoPort } from "./ports.js";

/**
 * @file Shared deprecate-old/grant-new permission migration mechanism
 * (generalized from the `settings.write` ->
 * `settings.definitions.manage` precedent already shipped ad hoc in
 * `identity/seed.ts`/`identity/permissions.ts`; see
 * `docs/decisions/permission-catalog-migration.md`).
 *
 * Purpose:
 * A permission-string rename/split after real grants exist is a breaking
 * migration. This module is
 * the one place that fan-out runs, so Menus/Members/Analytics/Integrations
 * remediation efforts each register their own `{from, to}` pair here instead of
 * hand-rolling a fourth divergent copy of the same fix.
 *
 * How it relates to the project:
 * - `registerPermissionMigration`/`listPermissionMigrations` are a small,
 *   in-process registry — pure metadata, no I/O, mirrors
 *   `permissions.ts`'s `PermissionCatalog.register` overwrite semantics.
 * - `migrateDeprecatedPermissionGrants` is the actual grant fan-out: for
 *   every registered pair, every policy holding `from` gets every string in
 *   `to` it doesn't already hold. It is deliberately, structurally
 *   additive-only (INV-NEW-01) — there is no delete/update call against
 *   `policy_permissions` anywhere in this file.
 * - Feature-agnostic by design: this module has zero knowledge of
 *   `navigation`/`settings`/any specific feature. Callers (e.g.
 *   `identity/permissions.ts`) register their own pairs.
 *
 * Architectural role:
 * Security-adjacent domain logic (a bug here could fail-open (grant more than
 * intended) or fail-closed (a policy silently missing a needed grant) across every
 * feature that reuses it). The additive-only design bounds the fail-closed
 * direction to "a required new permission is missing," never "an existing
 * permission is removed." See `__tests__/permission-migrations.test.ts` for
 * the dedicated fixture-driven certification required before any
 * caller wires this into a live boot path.
 */

/** One registered deprecate-old/grant-new rename or split pair. */
export interface PermissionMigration {
  /** The deprecated permission string. Never deleted from the catalog by this mechanism. */
  readonly from: string;
  /** The replacement permission string(s) every `from`-holding policy should also gain. */
  readonly to: readonly string[];
  /** Human-readable rationale, surfaced in docs/reviews — not interpreted by this module. */
  readonly reason: string;
}

export interface MigrateDeprecatedPermissionGrantsDeps {
  policyPermissions: PolicyPermissionRepoPort;
  policies: PolicyRepoPort;
  idGen: IdGeneratorPort;
  workspaceId: UUID;
}

export interface MigrateDeprecatedPermissionGrantsResult {
  /** Total new `policy_permissions` rows written across every policy and every registered pair. */
  migratedGrantCount: number;
}

/** Module-singleton registry — keyed by `from` so re-registration overwrites (idempotent, matches `PermissionCatalog.register`). */
const registry = new Map<string, PermissionMigration>();

/**
 * Register a `{from, to, reason}` rename/split pair for later fan-out.
 * Idempotent: re-registering the same `from` overwrites the prior entry
 * rather than duplicating it (matches `PermissionCatalog.register`'s
 * existing overwrite semantics, `identity/permissions.ts`).
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function registerPermissionMigration(migration: PermissionMigration): void {
  registry.set(migration.from, migration);
}

/** Enumerate every registered migration pair. */
export function listPermissionMigrations(): PermissionMigration[] {
  return [...registry.values()];
}

/**
 * For every registered `{from, to}` pair, for every policy in the workspace
 * holding `from`, ensure every string in `to` is also granted — adding only
 * the rows that are missing. Never removes or mutates `from` (or any other
 * existing row) — additive-only by construction (INV-NEW-01), so a failed or
 * partial run leaves the system in its previous, still-functioning state.
 *
 * Safe to call on every boot (idempotent): a rerun with nothing new to add
 * returns `migratedGrantCount: 0` (mirrors `migrateLegacyPresentationSettings`'s
 * boot-safety precedent).
 *
 * @complexity O(p * m) where p = policies in the workspace, m = registered
 * migration pairs; both are small, bounded collections in this app's shape.
 * @overallScore 100
 */
export async function migrateDeprecatedPermissionGrants(
  deps: MigrateDeprecatedPermissionGrantsDeps
): Promise<MigrateDeprecatedPermissionGrantsResult> {
  const migrations = listPermissionMigrations();
  if (migrations.length === 0) return { migratedGrantCount: 0 };

  const policies = await deps.policies.list({ workspaceId: deps.workspaceId });
  let migratedGrantCount = 0;

  for (const policy of policies) {
    const existing = await deps.policyPermissions.listByPolicyId({
      workspaceId: deps.workspaceId,
      policyId: policy.id,
    });
    const held = new Set(existing.map((row) => row.permission));

    for (const migration of migrations) {
      if (!held.has(migration.from)) continue;

      for (const toPermission of migration.to) {
        if (held.has(toPermission)) continue;

        await deps.policyPermissions.save({
          id: deps.idGen.newId(),
          workspaceId: deps.workspaceId,
          policyId: policy.id,
          permission: toPermission,
          resourceType: null,
          constraintJson: null,
        });
        held.add(toPermission);
        migratedGrantCount += 1;
      }
    }
  }

  return { migratedGrantCount };
}
