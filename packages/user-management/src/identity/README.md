# identity — host-side permission-grant and boot-session helpers

Subpath entries `@jini-ai/user-management/identity/<module>`, one per file: `boot-session-token`,
`builtin-role-grants`, `permission-grants`, `role-manage-permission`, `user-manage-permission`.
The why for the extraction and the package layout is in
[`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

**Needs injected (all by the host, nothing is defaulted or registered on import):**
- `applyBuiltinRoleGrants({ grants, roles, rolePolicies, policies, policyPermissions, idGen, workspaceId })`
  takes `RoleRepoPort`, `RolePolicyRepoPort`, `PolicyRepoPort`, `PolicyPermissionRepoPort` (from
  `@jini-ai/user-management`) and an `IdGenerator` (from `@jini-ai/core/primitives`).
- `register*PermissionGrants({ registry })` takes the `PermissionGrantRegistry` the host created.
- `createBootSessionTokenStore()` takes nothing; the module-level `mintBootSessionToken` /
  `redeemBootSessionToken` wrap one process-scoped store.

**Provides:** `createPermissionGrantRegistry` (migration pairs + built-in-role grants in one object),
`createBuiltinRoleGrantRegistry`, `applyBuiltinRoleGrants` (additive, idempotent boot reconciliation),
`registerRoleManagePermissionGrants`, `registerUserManagePermissionGrants`, `ROLE_MANAGE_PERMISSION`,
and the single-use loopback boot token store.

```ts
import { createPermissionGrantRegistry } from "@jini-ai/user-management/identity/permission-grants";
import { registerRoleManagePermissionGrants } from "@jini-ai/user-management/identity/role-manage-permission";
import { applyBuiltinRoleGrants } from "@jini-ai/user-management/identity/builtin-role-grants";
import { mintBootSessionToken, redeemBootSessionToken } from "@jini-ai/user-management/identity/boot-session-token";

const registry = createPermissionGrantRegistry({});          // composition root owns the registry
registerRoleManagePermissionGrants({ registry });            // each feature registers its own grants
await applyBuiltinRoleGrants({ grants: registry.roleGrants.list({}), roles, rolePolicies, policies, policyPermissions, idGen, workspaceId });
const bootToken = mintBootSessionToken();                    // launcher side, only when asked for one
const ok = redeemBootSessionToken({ rawToken });             // route side, true at most once
```

**Must never import:** a host app module, an HTTP/server framework, UI packages, or another Jini
package's implementation. Allowed edges are `../core/index.js` (records and ports), the single
`../server/permission-migrations.js` module (for `createPermissionMigrationRegistry`), type-only
`@jini-ai/core/primitives`, and `node:crypto` (boot token digest only).
