import { inIdentityTransaction } from "./identity-transaction.js";
import { BUILTIN_PERMISSION_MIGRATIONS, type PermissionMigration } from '../core/builtin-permissions.js';
import type { IdGenerator, UUID } from "@jini-ai/core/primitives";
import type { IdentityTransactionPort, PolicyPermissionRepoPort, PolicyRepoPort } from "../core/ports.js";

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
 * - `createPermissionMigrationRegistry` builds a small, in-process registry
 * object — pure metadata, no I/O, mirrors `permissions.ts`'s
 * `PermissionCatalog.register` overwrite semantics. A host creates ONE at its
 * composition root and registers its own pairs on it explicitly; there is no
 * module-scope registry, so which migrations exist never depends on which
 * modules a process happened to import (a module-singleton filled by import
 * side effects once ran a standalone script's boot reconciliation against an
 * empty registry because that script never imported the registering module).
 * - `migrateDeprecatedPermissionGrants` is the actual grant fan-out: for
 * every pair the caller passes in `deps.migrations` (normally its registry's
 * `list({})`), every policy holding `from` gets every string in
 * `to` it doesn't already hold. It is deliberately, structurally
 * additive-only — there is no delete/update call against
 * `policy_permissions` anywhere in this file.
 * - Feature-agnostic by design: this module has zero knowledge of
 * `navigation`/`settings`/any specific feature. Callers (e.g.
 * `identity/permissions.ts`) register their own pairs.
 *
 * Architectural role:
 * Security-adjacent domain logic (a bug here could fail-open (grant more than
 * intended) or fail-closed (a policy silently missing a needed grant) across every
 * feature that reuses it). The additive-only design bounds the fail-closed
 * direction to "a required new permission is missing," never "an existing
 * permission is removed." See `__tests__/permission-migrations.test.ts` for
 * the dedicated fixture-driven certification required before any
 * caller wires this into a live boot path.
 * See docs/decisions/DR-003-additive-permission-migration.md.
 */

export type { PermissionMigration } from '../core/builtin-permissions.js';

export interface MigrateDeprecatedPermissionGrantsDeps {
  /** Bound to the same storage as both repository ports; required before any migration work. */
  transactions: IdentityTransactionPort;
  /** Every `{from, to}` pair to fan out — normally `createPermissionMigrationRegistry(...).list({})`. */
  migrations: readonly PermissionMigration[];
  policyPermissions: PolicyPermissionRepoPort;
  policies: PolicyRepoPort;
  idGen: IdGenerator;
  workspaceId: UUID;
}

export interface MigrateDeprecatedPermissionGrantsResult {
  /** Total new `policy_permissions` rows written across every policy and every passed pair. */
  migratedGrantCount: number;
}

/** A host-owned set of `{from, to, reason}` pairs; see {@link createPermissionMigrationRegistry}. */
export interface PermissionMigrationRegistry {
  /**
   * Register a `{from, to, reason}` rename/split pair for later fan-out.
   * Idempotent: re-registering the same `from` overwrites the prior entry
   * rather than duplicating it (matches `PermissionCatalog.register`'s
   * existing overwrite semantics, `identity/permissions.ts`).
   *
   * @complexity O(1).
   */
  register(migration: PermissionMigration): void;
  /** Enumerate every registered migration pair, built-ins first, in first-registration order. */
  list(_required: Record<string, never>): PermissionMigration[];
}

/**
 * Create a migration registry seeded with the library's built-in pairs, then `optional.migrations`.
 * Keyed by `from`, so a host pair with a built-in's `from` overwrites it rather than duplicating.
 *
 * @complexity O(b + m) where b = built-in pairs and m = `optional.migrations`.
 * @overallScore 100
 */
export function createPermissionMigrationRegistry(
  _required: Record<string, never> = {},
  optional: { migrations?: readonly PermissionMigration[] } = {},
): PermissionMigrationRegistry {
  const byFrom = new Map<string, PermissionMigration>();
  const register = (migration: PermissionMigration): void => {
    byFrom.set(migration.from, migration);
  };
  for (const migration of BUILTIN_PERMISSION_MIGRATIONS) register(migration);
  for (const migration of optional.migrations ?? []) register(migration);
  return { register, list: () => [...byFrom.values()] };
}

/**
 * For every `{from, to}` pair in `deps.migrations`, for every policy in the workspace
 * holding `from`, ensure every string in `to` is also granted — adding only
 * the rows that are missing. Never removes or mutates `from` (or any other
 * existing row) — additive-only by construction. The entire fan-out runs in
 * one identity transaction, so a failed or partial run restores the previous state rather
 * than committing some target grants while withholding others.
 *
 * Safe to call on every boot (idempotent): a rerun with nothing new to add
 * returns `migratedGrantCount: 0` (mirrors `migrateLegacyPresentationSettings`'s
 * boot-safety precedent).
 *
 * @complexity O(p * m) where p = policies in the workspace, m = passed
 * migration pairs; both are small, bounded collections in this app's shape.
 * @overallScore 100
 * See docs/decisions/DR-003-additive-permission-migration.md.
 */
export async function migrateDeprecatedPermissionGrants(
  deps: MigrateDeprecatedPermissionGrantsDeps
): Promise<MigrateDeprecatedPermissionGrantsResult> {
  const { migrations } = deps;
  if (migrations.length === 0) return { migratedGrantCount: 0 };

  return inIdentityTransaction({
    transactions: deps.transactions,
    workspaceId: deps.workspaceId,
    execute: async () => {
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
    },
  });
}
