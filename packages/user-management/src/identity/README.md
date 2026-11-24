# identity — host-side permission-grant and boot-session helpers

Subpath entries `@jini-ai/user-management/identity/<module>`, one per file: `boot-session-token`,
`builtin-role-grants`, `permission-grants`, `role-manage-permission`, `user-manage-permission`,
`api-key-types`, `api-key-secret`, `api-key-service`, `repo.memory`, `owner-reset-env`,
`user-purge-types`, `username-change-ports`, `delete-user-service`.
The why for the extraction and the package layout is in
[`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

**Needs injected (all by the host, nothing is defaulted or registered on import):**
- `applyBuiltinRoleGrants({ grants, roles, rolePolicies, policies, policyPermissions, idGen, workspaceId })`
  takes `RoleRepoPort`, `RolePolicyRepoPort`, `PolicyRepoPort`, `PolicyPermissionRepoPort` (from
  `@jini-ai/user-management`) and an `IdGenerator` (from `@jini-ai/core/primitives`).
- `register*PermissionGrants({ registry })` takes the `PermissionGrantRegistry` the host created.
  `registerSiteKeyPermissionGrants({ registry, siteKeyName })` also takes the host's site-key env var
  name (product identity, K3); the migration's audit reason names it.
- `createBootSessionTokenStore()` takes nothing and the module keeps no state: the host builds ONE
  store per process in its own binding and hands that same instance to its serve command (mint) and
  its boot-session route (redeem). Two stores would refuse every launcher token; the host pins the
  sharing with a test.

- `createApiKeySecret({ prefix })` takes the host's api-key scheme marker (product identity, e.g.
  `acme_ak_`; lowercase letters, digits, `_`). Every issued key carries it, so the host binds one
  value for its lifetime. `issueApiKey`/`authenticateApiKey` take the bound value as `keySecret`;
  `createApiKeyService({ keySecret })` pre-binds both so call sites keep `{ deps, input }`.
- `ApiKeyServiceDeps` = the Jini `AuthServiceDeps` plus `apiKeys: ApiKeyRepoPort` and
  `secretHasher: ApiKeySecretHasherPort` (`ScryptApiKeySecretHasher` is the reference adapter).
- `applyOwnerPasswordReset({ deps, workspaceId, password, username? }, { beforeReset? })` takes
  `OwnerRecoveryDeps`; `beforeReset` is the host's pre-write backup hook.
- `createUsernameChangePort({ outbox, idGen, isInTrash, seededOwnerPrincipalId })` takes the host's
  outbox and Trash membership check.
- `createTrashUserService({})` owns the `trashUser` serialization queue (INV-08 owner floor): the
  host creates ONE instance per process at composition and every caller shares it; the module keeps
  no state. Each `trashUser({ deps, input })` takes `DeleteUserDeps` = `AuthServiceDeps` plus the
  host's Trash-bound `removeUser` (structural `RemoveUserFn`; absent = `UserDeleteUnsupportedError`)
  and its `isInTrash` membership check. The account-contract checks (`assertUserAccountAction`,
  `userAccountProtection`, `assertActiveOwnerFloor`, `callerMayManageUserTrash`) and the
  `SelfDeleteError`/`UserInTrashError`/`UsernameInTrashError` identities are stateless exports.

**Provides:** `createPermissionGrantRegistry` (migration pairs + built-in-role grants in one object),
`createBuiltinRoleGrantRegistry`, `applyBuiltinRoleGrants` (additive, idempotent boot reconciliation),
`registerRoleManagePermissionGrants`, `registerUserManagePermissionGrants`, `ROLE_MANAGE_PERMISSION`,
the single-use loopback boot token store, the `api_keys`
record and ports with their in-memory adapter (`InMemoryApiKeyRepo`), the user-purge port
(`UserPurgePort`, `InMemoryUserPurge`), and the api-key transitions.

```ts
import { createPermissionGrantRegistry } from "@jini-ai/user-management/identity/permission-grants";
import { registerRoleManagePermissionGrants } from "@jini-ai/user-management/identity/role-manage-permission";
import { applyBuiltinRoleGrants } from "@jini-ai/user-management/identity/builtin-role-grants";
import { createBootSessionTokenStore } from "@jini-ai/user-management/identity/boot-session-token";

const registry = createPermissionGrantRegistry({});          // composition root owns the registry
registerRoleManagePermissionGrants({ registry });            // each feature registers its own grants
await applyBuiltinRoleGrants({ grants: registry.roleGrants.list({}), roles, rolePolicies, policies, policyPermissions, idGen, workspaceId });
const bootTokens = createBootSessionTokenStore();            // host binding: ONE per process
const bootToken = bootTokens.mint();                         // launcher side, only when asked for one
const ok = bootTokens.redeem({ rawToken });                  // route side, same instance, true at most once
```

**Must never import:** a host app module, an HTTP/server framework, UI packages, or another Jini
package's implementation. Allowed edges are `../core/index.js` (records and ports), the single
`../server/permission-migrations.js` module (for `createPermissionMigrationRegistry`), type-only
`@jini-ai/core/primitives` and `@jini-ai/core/contracts/events`, the `../server/*` service modules
(`authorize`, `auth-service`, `grant-service`, `recovery-codes`), and `node:crypto` (boot token digest,
api-key minting and scrypt hashing only).
