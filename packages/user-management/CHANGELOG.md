# Changelog

## 0.2.0 — 2026-10-02

### BREAKING

- Canonical package replaces the retired identity surface; user tools live in ./server, primitive ports come from core, and session lifetime and tenancy are configurable.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

### Compilation fixes

- Import the consolidated tab-strip barrel (requires the UI peer to export that
  entry) and use the timestamp argument object.
- Complete policy fixtures, preserve concrete spy signatures, and check optional
  roster entries and tool inputs without weakening assertions or public types.
- Preserve the required policy name in the React fake when optional updates
  omit it or supply `undefined`; add a regression case for that behavior.

### Breaking architecture boundaries

- Export identity registration composition from `./server`; generic wiring uses core rather than CMS.
- Replace local runtime and catalog types with core contracts; ID generation uses a zero-argument getter.
- Make `IdentityRepos.transactions` and registration transaction/token ports required.
- Add `sessionTtlMs` and replaceable authentication messages options; preserve the 30-day default. Invalid lifetimes raise RangeError before persistence. Sessions retain required workspace scope because repositories require it.
- Merge the job-specific test configuration into the existing config and rename its setup file.


- Remove specification identifiers from admin safety errors and direct-grant tool text; authorization and ownership checks retain their behavior.

- Reject reserved wildcard registration with a typed validation error and converge
  interrupted seeds using only unconstrained, unscoped permission rows.
- **BEHAVIOR CHANGE:** Guarded authorization mutations and migration fan-out require
  a shared identity transaction port and fail closed when it is absent. Add a
  transactional memory adapter; migration failures roll back all prior additions.
- Validate complete tool schemas eagerly and implement JSON Schema `minLength`
  using raw Unicode code points. Whitespace counts toward length; unsupported
  schema shapes fail before input inspection. Preserve not-found grant errors and
  the `principal_disabled` reason for unknown principals, with corrected documentation.

- **BREAKING:** Rename the package and folder to `@jini-ai/user-management` and
  `packages/user-management`, reflecting users, members, roles, permissions,
  grants and authentication. No alias is provided; runtime entry points, public
  symbols, argument conventions and version remain unchanged.

- Integrate the universal root, Node `./server`, browser `./react` and
  `./react/testing` entries with matching runtime metadata and complete barrels.
- Add Login, Users, Roles and Members screens, controller hooks, browser DTOs,
  injected transport/refresh ports and generalized in-memory React testing ports.
  Branding, translations, navigation and query scope remain host inputs.
- Declare optional React/React DOM, UI, admin and agentic peers and development
  dependencies; route browser suites through jsdom and preserve headless guards.
- Reconcile agent handles, query mutation input/options, async actions, settlement
  generations, tabs and translated placeholders with dependency API conversions.
  The fake roles port preserves optional permission resource scope.
- **BREAKING:** Existing public identity functions, constructors and scalar port
  methods use required argument objects and a separate optional argument object.
  Hashing uses `hash({ password })` and `verify({ hash, password })`; memory
  repositories use `new InMemoryPrincipalRepo({}, { initialRows })` (and the
  corresponding shape for the other repository constructors).
- **BREAKING:** Optional user/policy fields, request metadata and authorization
  resource context move to the second argument. `seedIdentity` requires explicit
  `input.ownerUsername`; clock and ID ports receive `{}`.
- **BREAKING:** `AuthServiceDeps` requires `SessionTokenPort`; `NodeSessionTokens`
  retains the 32-byte hex bearer and SHA-256 digest. `Argon2PasswordHasher` requires
  an injected `loadBinding`; `loadArgon2Binding({})` adapts the optional native peer.
- **BREAKING:** Domain controller ID actions use named targets: user grants/email
  use `{ principalId }`, role saves use `{ roleId }`, policy saves/form/writes use
  `{ policyId }`, permission removal uses `{ policyId, policyPermissionId }`, and
  member row-state lookup uses `{ id }`. React event/setter callbacks are preserved.
- Preserve public export names, catalog values, migration pairs, hashing costs,
  error messages and React framework callback signatures. No version bump.

## 0.1.0 — 2026-10-01

Initial additive identity package, with universal records/ports/permissions and a Node server entry for authentication, sessions, authorization, grants, operator administration, hashing, seeding, migrations, memory repositories, and independent tool metadata/input parsing. Existing source entry points and consumers are migrated separately.
