# Integrated user management API

`@jini-ai/user-management` owns users, members, roles, permissions, grants, authentication and optional admin screens.
All current entries are included in the unchanged 0.1.0 package version:

| Import | Runtime | Contents |
|---|---|---|
| `@jini-ai/user-management` | Universal | Records, errors, repository/runtime ports, permission catalog |
| `@jini-ai/user-management/session-bootstrap` | Universal | Initial identity read with one admitted bootstrap, probe-then-redeem decision, plain-HTTP loopback URL guard |
| `@jini-ai/user-management/server` | Node | Auth, sessions, grants, administration, hashing, memory repos, seeding, migrations, tool metadata/parser and registration composition |
| `@jini-ai/user-management/server/sql` | Node | Kysely SQL stores for the owner recovery-code, passkey and MFA ports and the role/principal assignment repos; the host injects the kernel, `IdentityTransactionPort` and table names (`kysely` is an optional peer, used type-only) |
| `@jini-ai/user-management/react` | Browser | Login, Users, Members, hooks, browser DTOs and typed host ports |
| `@jini-ai/user-management/react/testing` | Browser | Generalized fake login/users/roles/members ports |
| `@jini-ai/user-management/react/kit` | Browser | The UI contract the screens render through: four components and five hooks, provided once by the host via `UserManagementKitProvider` |
| `@jini-ai/user-management/admin/react` | Browser | Composable roles/policies module and lazy screens using ui-kit |

Every public function/factory takes a required argument object and, where needed,
a second optional argument object. Repository `save` accepts a complete record.
React props, event handlers, state setters and translation callbacks retain their
framework contracts. See [invocation and migration examples](./args-convention.md).
Hosts provide repositories, `clock.nowMs()`, `idGen.newId()`, hashing and
session-token ports. The Node token adapter preserves the original bearer/digest
formats. Native Argon2 is optional; construct its adapter with
`new Argon2PasswordHasher({ loadBinding: loadArgon2Binding }, { memoryCost: 19456 })`.
Server entry imports never pull in React or a native binding eagerly.

`ensurePrincipal({ principalRepo, externalId, displayName }, { workspaceId, clock })` from the server entry ensures only a credential-free user principal (no roles/policies), using the trimmed external ID as its principal ID; scope defaults to `"local"`, inputs allow 1–255 trimmed characters, and existing rows remain unchanged. It requires the optional atomic `PrincipalRepoPort.insertIfAbsent` capability (otherwise it fails closed); durable adapters must enforce composite-key uniqueness across processes. `InMemoryPrincipalRepo` implements it for tests/dev only.

React consumers install compatible React/React DOM peers (and `@jini-ai/ui-kit` for the roles/policies
module). These peers are optional for universal/server consumers. The Users, Members and Login screens
import no `ui` or `admin` component: they render through `<UserManagementKitProvider kit={...}>`
(`@jini-ai/user-management/react/kit`: four component slots, five hook slots), which the host mounts once
at its root with its own implementations (`const kit = {...} satisfies UserManagementKit`). Mount the
provider inside the host's query provider; the fetch hooks in the kit own the cache. The roles/policies module uses `@jini-ai/ui-kit` and its React facades;
see [roles administration wiring and cleanup](./src/admin/PORT.md).
Member timestamps use `formatTimestamp({ iso }, { viewerTimeZone })` from `@jini-ai/core/text`; omit `viewerTimeZone` to show the stored time as written.
Supply `port`, `translate` and a session/workspace `queryScope`.
Login requires `productName`. Members requires a host-bound `useMembersHook` (bind the exported `useMembers`
or your own controller hook; the screen has no default) and optionally accepts a host-filtered refresh port.
Screen ports use object IDs and separate optional fields. The fake roles port
retains a policy's name when an update omits it or supplies `undefined`.
Remount screens when switching sessions/workspaces. The host supplies styles and dictionaries; see
[React integration](./REACT-w7a.md). No HTTP transport or router is chosen here.

User-management registration composition is exported by this package's server entry; persistence,
HTTP routes/cookies and complete end-user member authentication are host/follow-up
boundaries. Members backend extraction remains deferred for mail/origin/token
transaction semantics, rather than shared-file ownership.

The earlier extraction/conversion reports are historical. This integration
applies the identity manifest/changelog/barrel requests and reconciles internal
calls. [Integration report](./integration-report.md) contains the current file map,
caller ledger, remaining cross-package requests and every NOT RUN command.
Tests, typechecks, builds and packing were **not run (owner directive)**.

## Historical Stage A record

The original text below records the initial headless extraction before the React
and argument-convention jobs; its release-scope/signature statements are historical.

# @jini-ai/user-management

Framework-independent operator identity, with separate universal and Node entry points.

- `@jini-ai/user-management`: records, errors, repository and runtime ports, permission catalog.
- `@jini-ai/user-management/server`: login/logout/session validation, authorization, grants, operator administration, password policy and hashing, in-memory repositories, seeding, permission migrations, and framework-free tool descriptions/input parsing.

Version 0.1.0; Apache-2.0. There is no React entry point in this release.

```ts
import type { IdentityRepos } from '@jini-ai/user-management';
import type { Clock, IdGenerator } from '@jini-ai/core/primitives';
import { login, Argon2PasswordHasher } from '@jini-ai/user-management/server';
```

Hosts supply workspace IDs, repositories, a clock, an ID generator, and a password hasher. Hosts share core `Clock.nowMs()` and `IdGenerator.newId()` contracts. No CMS dependency or host persistence adapter is included.

The optional `argon2@^0.44.0` peer is needed only when using `Argon2PasswordHasher`. Its native binding loads on first hashing/verification call; importing the server entry with a host-provided hasher does not require it. Passwords, Argon2id costs, session TTLs, token hashing, authorization rules, grant clamps, and seeded permissions retain their source behavior.

The built-in permission catalog and migration registry initialize from explicit arrays. They require no side-effect-only imports, so `sideEffects: false` is safe. Permission descriptors and migration pairs are retained, including deprecated vocabulary. Hosts should register extensions before starting services; permission registries remain process-wide as in the source implementation.

## Stage A specification and decision

The owner-approved 2026-10-01 x5 dispatch is the specification: create an additive 0.1.0 package, preserve the current source and tests, split runtime entries, prohibit imports from CMS/admin/MCP/UI or application code, and leave source deletion and consumer rewiring to stage B. The implementation is a ports/adapters extraction; the current CMS domain code remains operational throughout stage A.

Decision: copy framework-independent behavior and pure tool metadata, define local structural clock/ID ports and string primitives, keep registration machinery in its current package, and represent built-in registrations as data to keep the universal import graph independent of Node services. Alternative: import CMS's shared ports or registration kit. Rejected because it creates a package back-edge and defeats identity's ownership. Rollback: discard this additive package; no existing consumer is changed.

Members are deferred as a complete backend extraction, not partially implemented here. The migration report specifies the mail/origin/transaction boundaries and required contract tests. Storage, HTTP cookies/routes, registration machinery, and UI composition remain host responsibilities.

See [stage-B checklist and source map](./stage-b-report.md) and [validation evidence](./validation.md). Build with `tsc -p tsconfig.json`; test with `vitest run` from this directory.

## Wiring

Admin route specs (`src/admin-http/routes/users/*`, DTOs in `src/admin-http/http/users.ts`) are
server-neutral `defineJsonRoute` specs, each with its own small `<Name>RouteDeps`. A host mounts one
with `mountJsonRoute({ app, spec, deps })` from `@jini-ai/http-kit`, passing its `authorize` port.
Principal routes: list, create, update, disable, enable, reset-password, delete, assign-role,
attach-policy. Role/policy routes: create/update/delete role, create/update/delete policy, write a
policy permission. The identity services they call live in the node `./server` entry, so each spec
takes the one it calls as a required deps field (typed with `typeof`) and the host binds it from
`@jini-ai/user-management/server`; the specs import only `src/core` errors and types. Host-owned rules
are injected too: the identity deps assembler (`identityServices`/`identityServiceDeps`, a thunk built
per request), the Trash index and trash move, the account-protection guard (`assertUserAccountAction`
plus the seeded `ownerPrincipalId`, run by disable, enable and reset-password), host error classes as
predicates (`isUserInTrashError`, `isSelfDeleteError`, …), and the ungrantable-permission list and
its refusal copy. Authorization happens inside the identity services (`role.manage`, `user.manage`),
so the specs never call the `authorize` port except `list`, which receives the host's raw
`decidePermission` (two permissions, "either one", no entity type). The three role/policy reads
(`list-roles`, `list-policies`, `list-policy-permissions`) ask the `authorize` port for `role.manage`
themselves, with no `entityType` and no entity scope (the port receives neither key), and read only
the `Pick`ed repo methods they call. `remove-policy-permission` takes the identity transaction port,
the policy-permission row read and two host owner guards (`principalHoldsOwnerWildcard`,
`assertActiveOwnerFloor`) as deps, and answers its 204 as a bodiless `routeReply`.

`./admin-http/owner/mfa-deps`: `composeOwnerMfaDeps({ deps, authServiceDeps, totp, sealedSecrets })`
builds `OwnerMfaDeps` from a host's late-bound identity, MFA storage and sealing ports; the host
injects `createOtplibTotp`/`createSealedMfaSecrets` from `./server`.

## Design decisions

- [Identity, authorization and sessions fail closed](docs/decisions/DR-001-identity-and-session-boundary.md).
- [Administration cannot grant authority the issuer lacks](docs/decisions/DR-002-grant-authority-and-admin-safety.md).
- [Permission renames add grants before retiring vocabulary](docs/decisions/DR-003-additive-permission-migration.md).

## Registration and session policy

`buildIdentityRegistrations`, `identityDerivedRisk` and `IdentityToolDeps` are exported by
`@jini-ai/user-management/server`. Hosts provide `IdentityToolDeps.transactions` and session
token generation/hash ports alongside repositories. `IdentityRepos.transactions` is required;
all competing grant/status writers and guard reads must share its isolation boundary.
The memory transaction factory accepts an unbound repository bag and returns a fully bound bag.

`createSessionForPrincipal({ deps, input }, { sessionTtlMs, ip, userAgent, messages })` and
`login({ deps, input }, { sessionTtlMs, ip, userAgent, messages })` default to an absolute 30-day
lifetime. Nonpositive or nonfinite lifetimes raise `RangeError` before persistence. Hosts may
replace authentication prose through `defaultUserManagementMessages` and the `messages` option.
Session `workspaceId` remains required: session and principal repositories address records by
composite tenant/record keys and session validation must not cross tenant boundaries. It is an
opaque host scope in meaning, but renaming or making it optional would violate that store contract.

## Wiring

`./admin-http/auth` routes are mounted by the host with per-route deps and its `AuthRequest`
context. Behavior contract for owner MFA login (`POST /api/admin/v1/auth/mfa/login`, B12): only a
refused proof classified as `MfaProofRefusedError` answers `400 { error: MFA_PROOF_REFUSED_MESSAGE,
code: "MFA_REFUSED" }`, with that fixed text. Any other failure, including another
`IdentityValidationError` from an injected collaborator, is rethrown to the host's redacted login
envelope (`Cache-Control: no-store` is already set), so proof or token text never reaches the body.
A host binding `completeOwnerLogin` must throw `MfaProofRefusedError` for a wrong, replayed or
expired code. Password login (`POST /api/admin/v1/auth/login`) coerces credential fields only after
readiness and the limiter, so a denied request always gets its exact 429 and `Retry-After`.

Each route's context is a narrowed view of `AuthRequest` naming only the operations it calls
(`CurrentPrincipalAuth` for `/auth/me` and `/auth/me/password-status`, `LogoutAuth` = session
revocation + cookie clearing, `SignInAuth` for password and MFA login, `BootSessionAuth` and
`LocalBootSessionAuth` for the boot routes). A host binding its full `AuthRequest` satisfies all
of them; the response policy (cookies, cache headers, limiter, `onError`) stays host code.

`RecoveryCodesCard` (`./react`) takes every hook as a required prop: `createDownloadHook`
(`createOwnerRecoveryKitDownload`), `useRecoveryKitHook` (`useOwnerRecoveryKit` bound by the host
to `useRecoveryKit`) and `useDesktopOwnerResetHook` (`useDesktopOwnerReset` bound to
`useOwnerPasswordReset`). The two wrapper hooks likewise take their inner hook as a required
second argument; neither the card nor the wrappers default to an imported hook.
