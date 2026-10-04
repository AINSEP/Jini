Spec ID: SPEC-JINI-USER-MANAGEMENT-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:af46f75aa5b00825746f5f003f937deb8c3f45da0e716e7ef7a592a697592b3f
spec_mode: reverse_spec

Cleanup note (2026-10-03): standalone `useRoles` and its screens were removed. Any
legacy roles-hook sections below describe the earlier extraction; the current controller
and React lifecycle are documented in [PORT.md](../../src/admin/PORT.md). Users, members
and auth state contracts remain unchanged.


# User management state contract

## State ownership and persistence

Services retain no per-host lifecycle state: the consumer owns nine repositories, clocks, IDs, hashing/token adapters, workspace scope, and startup sequencing. Repositories persist principals, credentials, sessions, roles, policies, permission rows, and three join collections. No durable storage engine, transaction coordinator, background cleanup, shutdown method, or cross-process synchronization ships here.

## In-memory repository lifecycle

Each exported `InMemory*Repo` allocates a fresh array per instance. Construction shallow-copies optional seed arrays. `save` replaces a row with an equal workspace and key, or appends a new row; the key is `principalId` for users and `id` for all other repositories. List/filter order follows the underlying insertion order; replacing a row retains its position.

Point reads and lists return stored record references, not cloned records. Mutating a returned record or an originally supplied seed record can mutate repository state without `save`. The list array is newly allocated; record objects are shared. There is no uniqueness enforcement on usernames, role/policy names, grant relationships, or token digests and no foreign-key checks. Business guards live in services.

Deletes filter only the specified workspace/key. Policy-permission bulk deletion filters workspace/policy. Missing deletes are no-ops. Session `revoke` mutates `revokedAt` on a found row; repeated direct calls overwrite the timestamp, although service `logout` avoids already-revoked writes.

Discarding an instance discards its storage; process restart loses memory state. The consumer must keep one correctly scoped adapter set for the lifetime of an ephemeral host or provide persistent port implementations. Multi-write transitions are not atomic, including with memory adapters.

## Principal and session transitions

| Transition | Before | After / persistence |
|---|---|---|
| Create user | Username absent | New active human principal, then new credential row; no grants |
| Disable | Existing active principal, guards pass | `status: 'disabled'`, `disabledAt: nowIso({ clock })`; other rows retained |
| Disable again | Existing disabled non-seeded-owner principal | Existing row returned without save |
| Enable | Existing disabled human | `status: 'active'`, `disabledAt: undefined` |
| Enable again | Existing active human | Existing row returned without save |
| Login/direct mint | Verified login or trusted supplied principal ID | New session with token digest and absolute expiry; login subsequently saves last-login timestamp |
| Session validation | Stored session | Read only; valid principal/session or `null` |
| Logout | Known unrevoked token | Session revocation timestamp; other sessions retained |
| Password reset | Existing user, guards pass | New hash saved, then every unrevoked session stamped revoked |

Disabled sessions are rejected through principal status without revocation. Re-enabling can restore their validity before absolute expiry. Expired/revoked sessions are never physically removed by these services. There is no principal hard-delete or credential-delete port here.

Roles/policies can be custom-created and updated; built-ins are guarded from edits/deletion and frozen policies from edits/deletion/permission changes by public services. Assignments/attachments are append operations with newly generated IDs and have no removal service. Permission removal deletes only a proven member row; policy deletion cascades permission rows first after reference guards.

## Provisioning and interrupted seed

The consumer shall await `seedIdentity` before accepting identity-dependent traffic and retain its owner/system result IDs. It must serialize startup and any migrations for a workspace; the package provides no seed lock.

The seed finds normalized owner username first. If found, it repairs an owner binding only when no role exists and returns, without replacing credentials or refreshing all built-ins. Missing nonlegacy system principal on this path returns `user-local` as the system ID fallback.

If no owner user exists, seed reuses an existing nonlegacy system principal, rewrites disabled `user-local`, converges built-in roles/policies and their links/permission strings, hashes the supplied password, saves a new owner principal, saves credentials, and saves the owner role link last. Interrupted built-in/link creation is retried through read-before-write convergence. A crash between owner user and its final link is repaired on the next seed.

The seed has no transaction or orphan-principal cleanup. Interruption between owner principal and credential save can leave an orphan human row. Presence of an owner username is treated as provisioning completion evidence; the package does not independently attest its provenance. Existing roles suppress the repair even if they do not grant owner authority.

## Process-global registries and migration lifecycle

`permissionCatalog` is initialized on module load from built-in data. Registration overwrites by permission ID; enumeration returns Map insertion order. The server migration registry similarly initializes built-in migration pairs and overwrites by `from`. Both registries are shared across hosts/workspaces using the same module instance, have no reset/unregister/dispose API, and are lost on process restart.

Enumeration copies the outer array but shares descriptor/migration objects. Neither registry validates/freeze-protects caller objects. The consumer should finish trusted registration before handling traffic and avoid mutating registered objects.

Although the initial catalog excludes `*`, registration does not prohibit it. Registering that string changes `isKnownPermission({ id: '*' })` and the catalog check used by permission writes.

`migrateDeprecatedPermissionGrants` reads policies one at a time, builds a held-string set, processes migrations in registry order, and saves missing target rows serially. It retains old rows and previously saved targets after a failure; rerun fills remaining targets. Idempotency depends on serialized execution and the held-string comparison, not a unique index or lock. The comparison ignores scope and constraints; target rows are always unscoped/unconstrained.

## React caches and controller lifecycle

| Module | State/lifecycle |
|---|---|
| `useLogin` | Local drafts, busy/error; initial username consumed by initial state; successful login invokes callback; no persistent session store |
| `useUsers` | Query-provider roster keyed `[queryScope, 'users-roles-policies']`; local drafts, expanded row, confirmations, busy/errors, own-user ID and trash flag |
| `useRoles` | Query-provider lists keyed `[queryScope, 'roles-and-policies']`; local edit/create drafts, confirmations, current permission panel/rows, loading generations |
| `useMembers` | Local nullable roster and per-row action state; loads on mount/refresh; subscription cleanup on dependency change/unmount; detail cache by ID |
| `useResetPasswordFields` | Local confirm text and reveal flags; resets all three when reset target principal ID changes, including closing |

User list mutations invalidate only their scoped roster key; role/policy list mutations invalidate only their scoped role/policy key. Neither hook declares cross-screen list invalidation. Permission writes/removals refresh the currently open matching permission panel. Password reset does not invalidate a roster query. The host owns query-provider cache policy, eviction, and transport cancellation.

Users performs `me({})` once per mount using the initially captured port. Consumers must remount when authenticated actor or bound port changes; changing query scope alone does not re-run that identity lookup. Automatic own-password-reset opens at most once per mount once the own row is known, and its close callback fires only for the automatically opened dialog.

Generation guards suppress older member-roster loads and superseded policy-panel loads. Member detail successes are cached by ID even if another panel is open; detail errors/loading cleanup are guarded. Cached detail is not automatically updated/evicted by member roster refresh or disable. Closing a policy panel clears rows but does not advance its load generation, so an already-in-flight load can repopulate hidden controller rows.

## UI fake lifecycle

Factories allocate independent arrays from optional initial lists, with shared record objects. Methods mutate those arrays and return shallow list copies. There is no server authorization, validation, hashing, durable state, or transaction behavior.

Fake IDs are derived from current list length plus one, so delete/create cycles can reuse IDs. Default users are active in workspace `fake-ws`, created at the Unix epoch, with empty grants. Fake login defaults to `{ id: 'fake-user-1', username: 'fake-admin' }`; fake `me` captures the configured/first-user ID or `fake-user-1`, and trash management defaults to true. Password reset is a no-op except for configured failure. Member magic-link requests append email and return `{ delivered: true }` without sending mail.

## Evidence and limits

Evidence: `src/server/repo.memory.ts`, auth/administration/seed/migration modules, React hooks and testing factories; seed resume and ported hook tests were inspected as text. No storage durability, race-free atomicity, performance SLA, or UI cache-refresh guarantee beyond the operations above was verified by execution.
