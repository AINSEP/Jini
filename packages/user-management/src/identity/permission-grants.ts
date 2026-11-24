import { createPermissionMigrationRegistry, type PermissionMigrationRegistry } from "../server/permission-migrations.js";

import { createBuiltinRoleGrantRegistry, type BuiltinRoleGrantRegistry } from "./builtin-role-grants.js";

/**
 * @file The one object that says which permission grants boot reconciles.
 *
 * Both boot-time grant paths read it: `migrateDeprecatedPermissionGrants` (`migrations`, the
 * `from`-anchored fan-out) and `applyBuiltinRoleGrants` (`roleGrants`, stated against a built-in
 * role). A composition root creates one, lets each feature that owns a permission register its own
 * grants on it explicitly (`server/runtime/composition/app-permission-grants.ts` is that list), and
 * passes it to identity wiring as a port.
 *
 * Both registries used to be module singletons filled by import side effects, so the grants a
 * process reconciled depended on which modules it happened to import: every real composition root
 * reached `features/pages/permissions.ts` only through an unrelated barrel import, and
 * `development/scripts/backfill-reset-admin-password.ts` did not reach it at all and reconciled
 * against an empty registry (`11aa47080`).
 */
export interface PermissionGrantRegistry {
  /** `{from, to}` fan-out pairs, seeded with `@jini-ai/user-management`'s built-in pairs. */
  readonly migrations: PermissionMigrationRegistry;
  /** `{role, permission}` grants onto a built-in role's own built-in policy. */
  readonly roleGrants: BuiltinRoleGrantRegistry;
}

/**
 * Create a registry holding only the library's built-in migration pairs and no host grants. Feature
 * `register*PermissionGrants` functions add to it; nothing is registered by importing a module.
 *
 * @complexity O(b) where b = built-in migration pairs.
 */
export function createPermissionGrantRegistry(
  _required: Record<string, never> = {},
  _optional: Record<string, never> = {}
): PermissionGrantRegistry {
  return { migrations: createPermissionMigrationRegistry({}), roleGrants: createBuiltinRoleGrantRegistry({}) };
}
