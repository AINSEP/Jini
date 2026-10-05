Spec ID: SPEC-JINI-USER-MANAGEMENT-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:20526959a261ac8cb56d42b5e828f38be77e064b16b4f6e0bf8d3289ad356da9
spec_mode: reverse_spec


# User management API contract

## Purpose and entry points

Consumer contract for the current source, including shared kernel types and required transactions. Evidence: `package.json`, `src/core/index.ts`, `src/server/index.ts`, `src/react/index.ts`, and `src/react/testing.ts`. Existing tests are evidence inspected as text; no execution result is claimed.

| Import | Runtime | Surface |
|---|---|---|
| `@jini-ai/user-management` | Universal | Records, errors, repository/runtime ports, permission catalog |
| `@jini-ai/user-management/server` | Node | Authentication, authorization, administration, seed, migrations, memory adapters, tool metadata/parser |
| `@jini-ai/user-management/react` | Browser/React | Screens, hooks, administration DTOs/ports, error formatting |
| `@jini-ai/user-management/react/testing` | Browser/React | Four in-memory UI port fakes and their option types |

All exports resolve to compiled ESM and declarations under `dist/`. The roles composition, React binding, adapters and conformance have separate public `./admin*` entries; see [PORT.md](../../src/admin/PORT.md). The root does not import Node or React. The server entry requires Node built-ins; the native `argon2` peer is loaded only when `loadArgon2Binding({})` is called. React consumers supply `react`, `react-dom`, `@jini-ai/ui`, `@jini-ai/admin`, and `@jini-ai/agentic` peers.

## Argument convention

Where implemented, calls use `(required, optional = {})`, both named objects. Tables preserve actual source signatures: a one-object signature has no declared second parameter. Components accept one React props object; controller event handlers and setters retain React callback signatures. Do not add a wrapper or a second parameter based on this specification. `registerPermission`, `authorizeDepsFrom`, `migrateDeprecatedPermissionGrants`, and repository `save` currently accept a direct descriptor/dependency/record object rather than a nested `required` bag.

In the signatures below, `UUID` and `ISODateTime` are string aliases imported from `@jini-ai/core/primitives`; they are not runtime validators. `Empty` is documentation shorthand for `Record<string, never>`, and `W` for `{ workspaceId: UUID }`; neither shorthand is exported.

## Root data and dependency contracts

Every stored record carries `workspaceId: UUID`. The following fields are additional to that scope.

| Exported type | Fields |
|---|---|
| `PrincipalKind` | `"user" \| "agent" \| "api_key" \| "system"` |
| `PrincipalStatus` | `"active" \| "disabled"` |
| `PrincipalRecord` | `id: UUID; kind: PrincipalKind; displayName: string; status: PrincipalStatus; disabledAt?: ISODateTime; createdAt: ISODateTime` |
| `UserRecord` | `principalId: UUID; username: string; email?: string; passwordHash: string; lastLoginAt?: ISODateTime` |
| `SessionRecord` | `id: UUID; principalId: UUID; tokenHash: string; createdAt: ISODateTime; expiresAt: ISODateTime; revokedAt?: ISODateTime; ip?: string; userAgent?: string` |
| `RoleRecord` | `id: UUID; name: string; isBuiltin: boolean` |
| `PolicyRecord` | `id: UUID; name: string; description?: string; isBuiltin: boolean; isFrozen: boolean` |
| `PolicyPermissionRecord` | `id: UUID; policyId: UUID; permission: string; resourceType?: string \| null; constraintJson?: string \| null` |
| `RolePolicyRecord` | `id: UUID; roleId: UUID; policyId: UUID` |
| `PrincipalRoleRecord` | `id: UUID; principalId: UUID; roleId: UUID` |
| `PrincipalPolicyRecord` | `id: UUID; principalId: UUID; policyId: UUID` |
| `PermissionDescriptor` | `id: string; owner: string; description: string` |

Consumers must supply workspace-scoped repository operations. Every operation below returns a `Promise` of the indicated result; `save(record)` returns `Promise<void>` on every repository. Saves and reads expose internal records including password/token hashes; the consumer must project them into browser DTOs.

| Port / matching server adapter | Required methods and results |
|---|---|
| `PrincipalRepoPort` / `InMemoryPrincipalRepo` | `findById(W & { id }): PrincipalRecord \| null`; `list(W): PrincipalRecord[]`; `save(PrincipalRecord): void` |
| `UserRepoPort` / `InMemoryUserRepo` | `findByPrincipalId(W & { principalId }): UserRecord \| null`; `findByUsername(W & { username: string }): UserRecord \| null`; `list(W): UserRecord[]`; `save(UserRecord): void` |
| `SessionRepoPort` / `InMemorySessionRepo` | `findById(W & { id }): SessionRecord \| null`; `findByTokenHash(W & { tokenHash: string }): SessionRecord \| null`; `listByPrincipalId(W & { principalId }): SessionRecord[]`; `save(SessionRecord): void`; `revoke(W & { id; revokedAt: ISODateTime }): void` |
| `RoleRepoPort` / `InMemoryRoleRepo` | `findById(W & { id }): RoleRecord \| null`; `findByName(W & { name: string }): RoleRecord \| null`; `list(W): RoleRecord[]`; `save(RoleRecord): void`; `delete(W & { id }): void` |
| `PolicyRepoPort` / `InMemoryPolicyRepo` | `findById(W & { id }): PolicyRecord \| null`; `findByName(W & { name: string }): PolicyRecord \| null`; `list(W): PolicyRecord[]`; `save(PolicyRecord): void`; `delete(W & { id }): void` |
| `PolicyPermissionRepoPort` / `InMemoryPolicyPermissionRepo` | `listByPolicyId(W & { policyId }): PolicyPermissionRecord[]`; `save(PolicyPermissionRecord): void`; `deleteByPolicyId(W & { policyId }): void`; `delete(W & { id }): void` |
| `RolePolicyRepoPort` / `InMemoryRolePolicyRepo` | `listByRoleId(W & { roleId }): RolePolicyRecord[]`; `listByPolicyId(W & { policyId }): RolePolicyRecord[]`; `save(RolePolicyRecord): void` |
| `PrincipalRoleRepoPort` / `InMemoryPrincipalRoleRepo` | `listByPrincipalId(W & { principalId }): PrincipalRoleRecord[]`; `listByRoleId(W & { roleId }): PrincipalRoleRecord[]`; `save(PrincipalRoleRecord): void` |
| `PrincipalPolicyRepoPort` / `InMemoryPrincipalPolicyRepo` | `listByPrincipalId(W & { principalId }): PrincipalPolicyRecord[]`; `listByPolicyId(W & { policyId }): PrincipalPolicyRecord[]`; `save(PrincipalPolicyRecord): void` |

Unannotated `id`, `principalId`, `roleId`, and `policyId` fields above are `UUID`. Memory method signatures use equivalent `string` types. `IdentityRepos` is the bag `{ principals, users, sessions, roles, policies, policyPermissions, rolePolicies, principalRoles, principalPolicies, transactions }` of these nine repositories and a required transaction port. Guarded mutations fail closed for untyped callers that omit the port.

`IdentityTransactionPort.run<T>({ workspaceId: UUID; execute: () => Promise<T> }): Promise<T>` commits on resolution and rolls back every write on rejection. Guard observations and competing workspace status/grant/reference writes must be serialized, including nontransactional writers. Repositories must use the same transaction connection; adapters must prevent phantom guard rows.

| Runtime port | Signature |
|---|---|
| `Clock` (`@jini-ai/core/primitives`) | `nowMs(): number`; use `nowIso({ clock })` for ISO timestamps |
| `IdGenerator` (`@jini-ai/core/primitives`) | `newId(): UUID` |
| `SessionTokenPort` | `newToken(required: Empty): string; hashToken(required: { rawToken: string }): string` |
| `PasswordHasherPort` | `hash(required: { password: string }): Promise<string>; verify(required: { hash: string; password: string }): Promise<boolean>` |

The host supplies normalized UTC timestamps, unique IDs, scoped persistence, password hashing, and session-token generation/digests. No logger, HTTP client, or runtime validation of these primitive aliases is present. Transactions are a required host dependency.

## Root functions and errors

| Export | Current signature / result | Dependencies |
|---|---|---|
| `registerPermission` | `(descriptor: PermissionDescriptor): void` | Module singleton |
| `listPermissions` | `(required: Empty): PermissionDescriptor[]` | Module singleton |
| `isKnownPermission` | `(required: { id: string }): boolean` | Module singleton |
| `permissionCatalog` | `.register(descriptor): void; .has({ id: string }): boolean; .list(required: Empty): PermissionDescriptor[]` | Initialized built-in vocabulary |

The catalog class itself and its built-in data constants are not root exports. Error constructors are root exports: `IdentityValidationError`, `IdentityNotFoundError`, `IdentityConflictError`, `AuthInvalidCredentialsError`, `OwnerRequiredError`, and `PermissionUnknownError` each take `({ message: string }, optional: ErrorOptions = {})`. `IdentityForbiddenError` takes `({ message, permission, reason }: { message: string; permission: string; reason: string }, optional: ErrorOptions = {})`. `GrantExceedsIssuerError` takes `({ message: string; offendingPermissions: string[] }, optional: ErrorOptions = {})`. `IdentityTransactionRequiredError` takes `(required: Empty, optional: ErrorOptions = {})`. All extend `Error`; see [errors.spec.md](errors.spec.md).

```ts
import { registerPermission, isKnownPermission, listPermissions } from '@jini-ai/user-management';
registerPermission({ id: 'project.read', owner: 'projects', description: 'Read projects.' });
const registered = isKnownPermission({ id: 'project.read' });
const catalog = listPermissions({});
```

## Server services

`AuthServiceDeps = { repos: IdentityRepos; hasher: PasswordHasherPort; clock: Clock; idGen: IdGenerator; tokens: SessionTokenPort }`. It is required by all authentication and administration transitions even where a transition uses only part of the bag. In the registry below, `D` abbreviates `AuthServiceDeps`, `R` abbreviates `{ deps: D; input: W & { callerPrincipalId: UUID } }`, and each listed input field extends `R.input`. These are signature abbreviations only.

| Export | Required argument | Optional argument (defaults to `{}` if present) | Promise result |
|---|---|---|---|
| `createSessionForPrincipal` | `{ deps: D; input: W & { principalId: UUID } }` | `{ ip?: string; userAgent?: string; sessionTtlMs?: number; messages?: UserManagementMessages }` | `{ session: SessionRecord; rawToken: string }` |
| `login` | `{ deps: D; input: W & { username: string; password: string } }` | `{ ip?: string; userAgent?: string; sessionTtlMs?: number; messages?: UserManagementMessages }` | `{ principal: PrincipalRecord; session: SessionRecord; rawToken: string }` |
| `validateSession` | `{ deps: D; input: W & { rawToken: string } }` | `{ nowIso?: ISODateTime }` | `{ principal: PrincipalRecord; session: SessionRecord } \| null` |
| `logout` | `{ deps: D; input: W & { rawToken: string } }` | None declared | `void` |
| `getEffectivePermissions` | `{ deps: IdentityRepos; input: W & { principalId: UUID } }` | None declared | `string[]` |
| `createUser` | `R` + `username: string; password: string` | `{ email?: string }` | `{ principal: PrincipalRecord; user: UserRecord }` |
| `createRole` | `R` + `name: string` | None declared | `{ role: RoleRecord }` |
| `createPolicy` | `R` + `name: string` | `{ description?: string }` | `{ policy: PolicyRecord }` |
| `assignRole` | `R` + `principalId: UUID; roleId: UUID` | None declared | `{ assignment: PrincipalRoleRecord }` |
| `attachPolicy` | `R` + `principalId: UUID; policyId: UUID` | None declared | `{ attachment: PrincipalPolicyRecord }` |
| `disablePrincipal` | `R` + `principalId: UUID; seededOwnerPrincipalId: UUID` | None declared | `{ principal: PrincipalRecord }` |
| `enablePrincipal` | `R` + `principalId: UUID` | None declared | `{ principal: PrincipalRecord }` |
| `updateUser` | `R` + `principalId: UUID` | `{ email?: string }` | `{ user: UserRecord }` |
| `resetUserPassword` | `R` + `principalId: UUID; password: string; seededOwnerPrincipalId: UUID` | None declared | `{ user: UserRecord }` |
| `updateRole` | `R` + `roleId: UUID; name: string` | None declared | `{ role: RoleRecord }` |
| `updatePolicy` | `R` + `policyId: UUID` | `{ name?: string; description?: string }` | `{ policy: PolicyRecord }` |
| `deleteRole` | `R` + `roleId: UUID` | None declared | `void` |
| `deletePolicy` | `R` + `policyId: UUID` | None declared | `void` |
| `writePolicyPermission` | `R` + `policyId: UUID; permission: string` | `{ resourceType?: string \| null; constraintJson?: string \| null }` | `{ policyPermission: PolicyPermissionRecord }` |
| `removePolicyPermission` | `R` + `policyId: UUID; policyPermissionId: UUID` | None declared | `void` |

`sessionTtlMs` defaults to `2592000000` (30 days) and must be finite and positive; invalid values throw `RangeError` before a session is saved. `SESSION_TTL_MS` is no longer exported. `defaultUserManagementMessages` provides the default credential failure and lifetime-validation copy; hosts can pass a replacement through `messages`. Session `workspaceId` remains required because session/principal lookup keys are workspace-scoped and validate the token in that scope. Raw session tokens are returned to the caller; the package does not set cookies. The session minter performs no identity proof or principal-status check: the host must authenticate the principal before invoking it directly. Seeded-owner IDs and caller IDs are trusted host inputs, not derived from request bodies.

`AuthorizeContext = { workspaceId: UUID; entityType?: string; entityId?: UUID }`. `AuthorizeResult = { allowed: boolean; reason: string }`. `AuthorizeDeps` contains `principals`, `principalRoles`, `rolePolicies`, `principalPolicies`, and `policyPermissions` from `IdentityRepos`.

| Export | Signature / result |
|---|---|
| `authorize` | `({ deps: AuthorizeDeps; principalId: UUID; permission: string; context: Pick<AuthorizeContext, 'workspaceId'> }, optional: Omit<AuthorizeContext, 'workspaceId'> = {}): Promise<AuthorizeResult>` |
| `resolveEffectivePermissions` | `({ deps: AuthorizeDeps; principalId: UUID; workspaceId: UUID }): Promise<PolicyPermissionRecord[]>` |
| `authorizeDepsFrom` | `(repos: IdentityRepos): AuthorizeDeps` |
| `assertCallerHasAnyPermission` | `({ deps: D; workspaceId: UUID; callerPrincipalId: UUID; permissions: readonly string[] }): Promise<void>` |
| `assertGrantClamp` | `({ deps: D; workspaceId: UUID; callerPrincipalId: UUID; conferredPermissions: readonly string[] }): Promise<void>` |
| `normalizeUsername` | `({ raw: string }): string` |
| `validatePasswordPolicy` | `({ password: string }): string \| null` |
| `MAX_PASSWORD_LENGTH` | Exported number `512` |

The raw permission resolver, effective-permission introspection, and grant clamp do not independently check principal activity. Use `authorize` and the caller gate for access decisions.

## Server factories, seed, and migrations

Every `InMemory*Repo` in the root port table is exported from `/server`. Its constructor is `new Adapter(required: Empty, optional: { initialRows?: CorrespondingRecord[] } = {})`. No consumer dependency is required. Its repository method surface is the matching port in the root table. Each also inherits `snapshotRows(Empty): Record[]` and `restoreRows({ rows: Record[] }): void` from the exported abstract `InMemoryIdentityRows<Record>`, whose constructor takes `(Empty, optional: { initialRows?: Record[] } = {})`. Snapshots are detached and serve the memory transaction adapter.

`createTransactionalInMemoryIdentityRepos({ repos: IdentityRepos }): IdentityRepos & { transactions: IdentityTransactionPort }` wraps a complete bag of memory adapters with one queue and rollback snapshots. Every returned repository read/write shares the queue and detaches values. Use only returned handles after binding; raw handles bypass isolation. Non-memory or already-bound repositories are rejected. Durable hosts inject their own adapter instead.

| Export | Signature / result | Host dependency |
|---|---|---|
| `NodeSessionTokens` | `new (required: Empty)`; `newToken(Empty): string`; `hashToken({ rawToken: string }): string` | Node crypto |
| `loadArgon2Binding` | `(required: Empty): Argon2BindingPort` | Installed native `argon2` peer |
| `Argon2PasswordHasher` | `new (required: Argon2PasswordHasherDependencies, optional: Argon2PasswordHasherOptions = {})`; methods implement `PasswordHasherPort` | `loadBinding(required: Empty): Argon2BindingPort` |
| `seedIdentity` | `({ deps: SeedIdentityDeps; input: SeedIdentityInput }, optional: SeedIdentityOptions = {}): Promise<SeedIdentityResult>` | Repositories, hasher, clock, ID generator |
| `createPermissionMigrationRegistry` | `(required: Empty = {}, optional: { migrations?: readonly PermissionMigration[] } = {}): PermissionMigrationRegistry` — `register(migration: PermissionMigration): void` (overwrites by `from`), `list(required: Empty): PermissionMigration[]` (built-ins first) | None; the host creates one at its composition root |
| `migrateDeprecatedPermissionGrants` | `(deps: MigrateDeprecatedPermissionGrantsDeps): Promise<MigrateDeprecatedPermissionGrantsResult>` | Scoped policies, permission rows, ID generator, explicit `migrations` list |

`Argon2PasswordHasherOptions = { memoryCost?: number; timeCost?: number; parallelism?: number }`; defaults are `19456` KiB, `2`, and `1`. `Argon2PasswordHasherDependencies = { loadBinding }`. `Argon2BindingPort` supplies `argon2id: number`, `hash({ password: string }, optional?: Argon2PasswordHasherOptions & { type?: number }): Promise<string>`, and `verify({ hash: string; password: string }): Promise<boolean>`.

`SeedIdentityDeps = { repos: IdentityRepos; hasher: PasswordHasherPort; clock: Clock; idGen: IdGenerator }`. `SeedIdentityInput = { workspaceId: UUID; ownerUsername: string; ownerPassword: string }`; `SeedIdentityOptions = { ownerEmail?: string }`; `SeedIdentityResult = { ownerPrincipalId: UUID; systemPrincipalId: UUID }`. There is no default owner credential.

`PermissionMigration = { readonly from: string; readonly to: readonly string[]; readonly reason: string }`. `MigrateDeprecatedPermissionGrantsDeps = { policyPermissions: PolicyPermissionRepoPort; policies: PolicyRepoPort; idGen: IdGenerator; workspaceId: UUID; transactions: IdentityTransactionPort }`; result is `{ migratedGrantCount: number }`.

Minimal Node wiring (memory storage is for an ephemeral host):

```ts
import { randomUUID } from 'node:crypto';
import type { IdentityRepos } from '@jini-ai/user-management';
import * as server from '@jini-ai/user-management/server';
const repos = server.createTransactionalInMemoryIdentityRepos({ repos: {
  principals: new server.InMemoryPrincipalRepo({}),
  users: new server.InMemoryUserRepo({}), sessions: new server.InMemorySessionRepo({}),
  roles: new server.InMemoryRoleRepo({}), policies: new server.InMemoryPolicyRepo({}),
  policyPermissions: new server.InMemoryPolicyPermissionRepo({}),
  rolePolicies: new server.InMemoryRolePolicyRepo({}),
  principalRoles: new server.InMemoryPrincipalRoleRepo({}),
  principalPolicies: new server.InMemoryPrincipalPolicyRepo({}),
} satisfies IdentityRepos });
const deps = {
  repos, clock: { nowMs: () => Date.now() },
  idGen: { newId: (_: Record<string, never>) => randomUUID() },
  hasher: new server.Argon2PasswordHasher({ loadBinding: server.loadArgon2Binding }),
  tokens: new server.NodeSessionTokens({}),
};
// These values come from the consumer's provisioning inputs.
async function provision(workspaceId: string, ownerUsername: string, ownerPassword: string) {
  const seed = await server.seedIdentity({ deps, input: { workspaceId, ownerUsername, ownerPassword } });
  await server.migrateDeprecatedPermissionGrants({ ...repos, idGen: deps.idGen, workspaceId });
  return server.authorize({ deps: server.authorizeDepsFrom(repos),
    principalId: seed.ownerPrincipalId, permission: 'project.read', context: { workspaceId } });
}
```

## Server agent-tool metadata and parser

`identityAgentToolCatalog: IdentityAgentToolDefinition[]` is metadata, without handlers or transport. `IdentityAgentToolSideEffect = 'none' | 'mutates-durable-state' | 'mints-token'`. Definitions contain `name`, `description`, `sideEffects`, `authorization: { permission: string; orPermission?: string }`, `inputSchema: Readonly<Record<string, unknown>>`, and optional `actorClassRule: 'confirmer-must-equal-own-delegatedBy' | 'user-only' | 'none'`. The actor-rule type has no separately exported name through `/server`.

| Catalog names | Required input fields | Optional input fields | Permission |
|---|---|---|---|
| `identity_user_list` | None | None | `user.manage` OR `member.manage` |
| `identity_role_list`, `identity_policy_list` | None | None | `role.manage` |
| `identity_user_create` | `username`, `password` | `email` | `user.manage` OR `member.manage` |
| `identity_user_update_email` | `principalId` | `email` | `user.manage` OR `member.manage` |
| `identity_user_disable`, `identity_user_enable` | `principalId` | None | `user.manage` |
| `identity_role_create` | `name` | None | `role.manage` |
| `identity_role_assign` | `principalId`, `roleId` | None | `role.manage` |
| `identity_role_rename` | `roleId`, `name` | None | `role.manage` |
| `identity_role_delete` | `roleId` | None | `role.manage` |
| `identity_policy_create` | `name` | `description` | `role.manage` |
| `identity_policy_update` | `policyId` | `name`, `description` | `role.manage` |
| `identity_policy_delete` | `policyId` | None | `role.manage` |
| `identity_policy_attach` | `principalId`, `policyId` | None | `role.manage` |

All fields are strings and additional keys are rejected. Lists have `sideEffects: 'none'`; all other entries have `'mutates-durable-state'`. The host binds workspace and authenticated actor, runs input parsing and service guards, projects results, and enforces any confirmation policy. Metadata alone authorizes nothing.

`parseIdentityToolInput({ schema: Readonly<Record<string, unknown>>; input: unknown }): IdentityToolInputResult`, where the exported union is `{ ok: true; value: Readonly<Record<string, string>> } | { ok: false; error: Error }`. It supplies shape validation, without authorization or I/O.

```ts
import { identityAgentToolCatalog, parseIdentityToolInput } from '@jini-ai/user-management/server';
const tool = identityAgentToolCatalog.find(row => row.name === 'identity_role_create')!;
const parsed = parseIdentityToolInput({ schema: tool.inputSchema, input: { name: 'Reviewers' } });
if (!parsed.ok) throw parsed.error;
// A host handler invokes createRole with its trusted workspace/caller and parsed.value.name.
```

## React ports and DTOs

React ports are workspace/actor-bound by the consumer. They do not receive server dependency bags. Results are `Promise`-wrapped; IDs are `string` and `Empty` again means `Record<string, never>`.

| Exported port | Methods |
|---|---|
| `LoginPort` | `login({ username: string; password: string }): Promise<{ user: AdminUser }>` |
| `UsersPort` | `listUsers(Empty): { users: AdminIdentityUser[] }`; `me(Empty): { user: { id: string }; canManageUserTrash: boolean }`; `listRoles(Empty): { roles: AdminRole[] }`; `listPolicies(Empty): { policies: AdminPolicy[] }`; `createUser({ username; password }, options?: { email?: string }): { user: AdminIdentityUser }`; `updateUser({ principalId }, options?: { email?: string }): { user: AdminIdentityUser }`; `disableUser({ principalId }): { user: AdminIdentityUser }`; `enableUser({ principalId }): { user: AdminIdentityUser }`; `resetUserPassword({ principalId; password }): void`; `assignRole({ principalId; roleId }): { assignment: unknown }`; `attachPolicy({ principalId; policyId }): { attachment: unknown }`; `deleteUser({ principalId }): void` |
| `RolesPort` | `listRoles(Empty): { roles: AdminRole[] }`; `listPolicies(Empty): { policies: AdminPolicy[] }`; `createRole({ name }): { role: AdminRole }`; `updateRole({ roleId; name }): { role: AdminRole }`; `deleteRole({ roleId }): void`; `createPolicy({ name }, options?: { description?: string }): { policy: AdminPolicy }`; `updatePolicy({ policyId }, options?: { name?: string; description?: string }): { policy: AdminPolicy }`; `deletePolicy({ policyId }): void`; `writePolicyPermission({ policyId; permission }, options?: { resourceType?: string }): { policyPermission: unknown }`; `listPolicyPermissions({ policyId }): { policyPermissions: AdminPolicyPermission[] }`; `removePolicyPermission({ policyId; policyPermissionId }): void` |
| `MembersPort` | `listMembers(Empty): { members: AdminMember[] }`; `getMember({ id }): { member: AdminMember }`; `disableMember({ id }): { member: AdminMember }`; `requestMemberMagicLink({ email }): { delivered: true }` |
| `IdentityAdminPort` | Extends all four ports above |
| `IdentityRefreshPort` | `subscribe({ onRefresh: () => void }): () => void` (unsubscribe) |

Unannotated port input fields in this table are strings. These interface methods have no default initializer; the consumer implements them. `deleteUser` and all member operations are consumer ports without matching server service implementations in this package.

| Exported DTO | Shape |
|---|---|
| `AdminUser` | `{ id: string; username: string }` |
| `AdminIdentityUser` | `{ principalId: string; workspaceId: string; username: string; email?: string; status: 'active' \| 'disabled'; createdAt: string; lastLoginAt?: string; roleIds: string[]; policyIds: string[] }` |
| `AdminRole` | Same fields as `RoleRecord`, with string IDs |
| `AdminPolicy` | Same fields as `PolicyRecord`, with string IDs |
| `AdminPolicyPermission` | `{ id: string; workspaceId: string; policyId: string; permission: string; resourceType?: string \| null; constraintJson?: string \| null }` |
| `AdminMember` | `{ id: string; workspaceId: string; email: string; name?: string; status: 'pending' \| 'active' \| 'disabled'; emailVerifiedAt?: string; createdAt: string; updatedAt: string; version: number }` |

## React callables and returned controllers

`Translate` comes from `@jini-ai/ui/panel-kit`. Screens return a React JSX element. Their exact props, section controllers, slots, and remaining exported presentation types are in [ui.spec.md](ui.spec.md).

| Export | Current signature / result | Required consumer wiring |
|---|---|---|
| `Login` | `(props: LoginProps): JSX.Element` | Login port, translator, brand, callback |
| `Users` | `(props: UsersProps): JSX.Element` | Users port, translator, query scope/provider |
| `UserManagePanel` | `(props: UserManagePanelProps): JSX.Element` | Controlled email/grant callbacks |
| `Members` | `(props: MembersProps): JSX.Element` | Members port, translator; optional refresh subscription |
| `useLogin` | `(required: LoginHookProps, optional: LoginOptions = {}): LoginController` | `{ port: LoginPort; translate: Translate; onLogin: (user: AdminUser) => void }`; optional `{ initialUsername?: string }` |
| `useUsers` | `(required: UsersDependencies, optional: UsersOptions = {}): UsersController` | `{ port: UsersPort; translate: Translate; queryScope: string }`; optional `{ openOwnPasswordReset?: boolean; onOwnPasswordResetClosed?: () => void }` |
| `useMembers` | `(required: MembersDependencies, optional: MembersOptions = {}): MembersController` | `{ port: MembersPort; translate: Translate }`; optional `{ refresh?: IdentityRefreshPort }` |
| `useResetPasswordFields` | `(required: ResetPasswordFieldsInput): ResetPasswordFieldsController` | `{ resetPasswordFor: AdminIdentityUser \| null; newPassword: string }` |
| `describeIdentityError` | `({ error: unknown; fallback: string; translate: Translate }, optional: { messages?: Readonly<Record<string, string>> } = {}): string` | Translator and caller-selected fallback/mapping |

`LoginController` returns `username/password` strings and setters, `error: string | null`, `busy: boolean`, and `submit(FormEvent): Promise<void>`. `UsersController` returns nullable user/role/policy lists, load/form/grant/status/password errors, a notice, editable drafts and setters, expanded/confirmation/reset targets, busy flags, `canManageUserTrash`, translator aliases `t/translate`, and handlers for create, grants, email, status, reset, and deletion. All async mutation handlers return `Promise<void>`; ID-targeted grant/email/role/policy handlers take named objects, while draft setters, row selectors, form events, and confirmation handlers use their declared React callback forms.

`MembersController` returns `members: AdminMember[] | null`, load/detail errors, `expandedId/detailLoadingId: string | null`, `detailById: Record<string, AdminMember>`, confirmation target/setter, `t/translate`, `stateFor({ id }): { disabling: boolean; resending: boolean; error: string | null; notice: string | null }`, `onResendSignInLink(member): Promise<void>`, `onToggleDetail(member): Promise<void>`, and `confirmDisable(): Promise<void>`.

`ResetPasswordFieldsController` returns `confirmPassword: string`, its setter, `mismatch/showNewPassword/showConfirmPassword: boolean`, and two zero-argument visibility toggles.

```tsx
import { FetchQueryProvider } from '@jini-ai/ui/panel-kit';
import { Login, Users, Members } from '@jini-ai/user-management/react';
import type { IdentityAdminPort } from '@jini-ai/user-management/react';
function Administration({ port }: { port: IdentityAdminPort }) {
  const translate = (text: string) => text;
  return <FetchQueryProvider>
    <Login port={port} translate={translate} productName="Example" onLogin={() => {}} />
    <Users port={port} translate={translate} queryScope="host:workspace:actor" />
    <Members port={port} translate={translate} />
  </FetchQueryProvider>;
}
```

The consumer supplies a scope unique to the host/workspace/authenticated actor and remounts at an identity boundary. UI callbacks and test fakes are not authorization boundaries.

## React testing entry

| Export | Signature / return |
|---|---|
| `createFakeLoginPort` | `(required: Empty, optional: FakeLoginPortOptions = {}): LoginPort` |
| `createFakeUsersPort` | `(required: Empty, optional: FakeUsersPortOptions = {}): UsersPort & { readonly users: AdminIdentityUser[] }` |
| `createFakeRolesPort` | `(required: Empty, optional: FakeRolesPortOptions = {}): RolesPort & { readonly roles: AdminRole[]; readonly policies: AdminPolicy[]; readonly policyPermissions: AdminPolicyPermission[] }` |
| `createFakeMembersPort` | `(required: Empty, optional: FakeMembersPortOptions = {}): MembersPort & { readonly members: AdminMember[]; readonly magicLinkRequests: string[] }` |

No dependencies are supplied to these factories. Their methods implement the React port signatures above.

| Exported options | Optional fields |
|---|---|
| `FakeLoginPortOptions` | `user: AdminUser`, `loginError: Error` |
| `FakeUsersPortOptions` | `users: AdminIdentityUser[]`, `roles: AdminRole[]`, `policies: AdminPolicy[]`, `meId: string`, `canManageUserTrash: boolean`; `createUserError`, `updateUserError`, `toggleStatusError`, `resetPasswordError`, `assignRoleError`, `attachPolicyError`, `deleteUserError` (each `Error`) |
| `FakeRolesPortOptions` | `roles: AdminRole[]`, `policies: AdminPolicy[]`, `initialPolicyPermissions: AdminPolicyPermission[]`; `createRoleError`, `updateRoleError`, `deleteRoleError`, `createPolicyError`, `updatePolicyError`, `deletePolicyError`, `writePermissionError`, `listPermissionsError`, `removePermissionError` (each `Error`) |
| `FakeMembersPortOptions` | `members: AdminMember[]` |

```ts
import { createFakeUsersPort } from '@jini-ai/user-management/react/testing';
const port = createFakeUsersPort({}, { users: [], canManageUserTrash: false });
await port.createUser({ username: 'alice', password: 'example' });
const { users } = await port.listUsers({});
```

## Contract boundaries

No public entry is missing source documentation. Transport routes/status envelopes, durable storage, member authentication/mail delivery, user trash/deletion services, API-key issuance, and role-policy linking/unassignment are consumer responsibilities or absent services, not promised exports. Behavior, state, UI, and errors are specified in the sibling files. Primitive contracts are imported from core/primitives; root catalog vocabulary is shared with core.

## Server identity tool wiring


Source: [identity-tool-registrations.ts](../../src/server/agent-tool-registrations.ts), [index.ts](../../src/server/index.ts).

```ts
declare function buildIdentityRegistrations(routeDeps: IdentityToolDeps): ToolRegistration[];
```

Types/data: `IdentityToolDeps`, `identityDerivedRisk`, `defaultUserManagementMessages`.

```ts
interface IdentityToolDeps { workspaceId: string; clock: Clock; idGen: { newId(): string }; principalRepo: PrincipalRepoPort; userRepo: UserRepoPort; sessionRepo: SessionRepoPort; roleRepo: RoleRepoPort; policyRepo: PolicyRepoPort; policyPermissionRepo: PolicyPermissionRepoPort; rolePolicyRepo: RolePolicyRepoPort; principalRoleRepo: PrincipalRoleRepoPort; principalPolicyRepo: PrincipalPolicyRepoPort; passwordHasher: PasswordHasherPort; ownerPrincipalId: Promise<string>; transactions: IdentityRepos["transactions"]; tokens: AuthServiceDeps["tokens"]; }
```

Wiring (adapters/context are host-provided):

```ts
import { buildIdentityRegistrations, defaultUserManagementMessages } from "@jini-ai/user-management/server";
const registrations = buildIdentityRegistrations(identityToolDeps); // host mounts registrations
```


`IdentityToolDeps` requires the same transaction and session-token ports used by server authentication services. Generic registration helpers come from the core root, not CMS; only domain identity policy and handlers live here.

Roles screens and controller hooks are now composed through `./admin/react`; the superseded
standalone roles exports were removed in the 2026-10-03 cleanup. See [PORT.md](../../src/admin/PORT.md).
Role/policy DTOs and fake ports remain available for users and independent port tests.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Additional exported names | Kind and source |
|---|---|
| `GrantOption`, `GrantSelectController`, `UserManageController`, `UserRowActionsController`, `UserRowProps`, `UsersTableProps` | type; [Users.tsx](../../src/react/users/Users.tsx) |

## Current manifest boundary

The current `package.json` exposes `.`, `./server`, `./react`, `./react/testing`, `./admin`,
`./admin/react`, `./admin/adapters/http`, `./admin/adapters/memory`, and `./admin/conformance`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
