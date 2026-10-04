# Integrated user management API

`@jini-ai/user-management` owns users, members, roles, permissions, grants, authentication and optional admin screens.
All current entries are included in the unchanged 0.1.0 package version:

| Import | Runtime | Contents |
|---|---|---|
| `@jini-ai/user-management` | Universal | Records, errors, repository/runtime ports, permission catalog |
| `@jini-ai/user-management/server` | Node | Auth, sessions, grants, administration, hashing, memory repos, seeding, migrations, tool metadata/parser and registration composition |
| `@jini-ai/user-management/react` | Browser | Login, Users, Members, hooks, browser DTOs and typed host ports |
| `@jini-ai/user-management/react/testing` | Browser | Generalized fake login/users/roles/members ports |
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

React consumers install compatible React/React DOM and `@jini-ai/{ui,admin,agentic}`
peers. These peers are optional for universal/server consumers. Mount Users
inside `FetchQueryProvider` from `@jini-ai/ui/panel-kit`; the current provider owns
its cache directly. The roles/policies module uses `@jini-ai/ui-kit` and its React facades;
see [roles administration wiring and cleanup](./src/admin/PORT.md).
Member timestamps use `formatTimestamp({ iso })` from `@jini-ai/ui/panel-kit`.
Supply `port`, `translate` and a session/workspace `queryScope`.
Login requires `productName`. Members optionally accepts a host-filtered refresh port.
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
