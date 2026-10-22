Spec ID: SPEC-JINI-USER-MANAGEMENT-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:b6a4b65aa30b4d3ab62ac4f5b3d5911c215c8a242ceacb0e9e0df50ebd49b544
spec_mode: reverse_spec


# User management behavior contract

## Purpose and evidence

Observable behavior of the current package. Sources: `src/core/permissions.ts`, all `src/server` service modules, and React hooks/rules. Existing authorization, authentication, grant, administration, seed/resume, password-policy, screen, and ported hook tests were inspected without running them.

## Authentication and session guarantees

- WHEN a username is normalized, the package shall apply Unicode NFC, trim outer whitespace, then lowercase it.
- IF normalized username or password is empty, the username is unknown, the principal is missing/disabled, or verification returns false, THEN `login` shall reject with `AuthInvalidCredentialsError` and message `invalid username or password`. Failure timing is not equalized.
- WHEN login succeeds, the package shall save a session before saving the user's `lastLoginAt`, using the session's `createdAt` for that timestamp.
- WHEN a session is minted, the package shall set an absolute expiry from `sessionTtlMs` (30 days by default, finite and positive) and store only the token digest. The Node adapter shall generate 32 random bytes as 64 hex characters and digest the bearer using SHA-256.
- WHEN `createSessionForPrincipal` is invoked directly, the package shall mint using the supplied principal ID without password verification or principal lookup. The caller owns identity proof.
- IF a session is unknown, revoked, has `expiresAt <= nowIso`, or refers to a missing/inactive principal, THEN validation shall return `null`. Expiry uses string comparison; timestamps must be comparable normalized UTC ISO strings.
- WHEN a valid session is read, the package shall leave its expiry fixed. Validation performs no renewal, cleanup, revocation write, or last-login update.
- WHEN logout is repeated for an unknown/already-revoked token, the package shall perform no revocation write. Other sessions are independent.
- WHEN the Argon2 binding rejects verification, the hasher shall return `false`. Binding-load failures occur outside the catch and propagate; hash failures propagate.

## Authorization precedence and grant limits

| Condition, evaluated in order | Result |
|---|---|
| Missing or disabled principal | `{ allowed: false, reason: 'principal_disabled' }` |
| Principal kind barred from operator permissions (`member`; see `principalKindMayExercisePermission`) | `{ allowed: false, reason: 'principal_kind_denied' }` |
| Any effective `*` row with null/undefined scope and constraint | `{ allowed: true, reason: 'owner_wildcard' }` |
| Exact permission row, no constraint, resource type absent or equal to `entityType` | `{ allowed: true, reason: 'matched' }` |
| No same-permission row | `{ allowed: false, reason: 'no_grant' }` |
| Same-permission rows exist but none matches; any has a non-null constraint | `{ allowed: false, reason: 'unconstrained_deny' }` |
| Remaining same-permission rows have resource types | `{ allowed: false, reason: 'resource_scope_mismatch' }` |

- The evaluator shall resolve role → policy → permission rows plus direct principal → policy → permission rows, with every repository read scoped to the requested workspace.
- The raw resolver shall return role-derived groups followed by direct-policy groups in repository order, without deduplication or activity checks. Introspection shall deduplicate permission strings in first-seen order, retaining scoped/constrained strings and wildcard alongside other strings; it is not an authorization result.
- The evaluator shall reject every non-null `constraintJson`, including an empty string, as uninterpretable. `entityId` shall have no effect in this evaluator.
- The evaluator shall recognize exact strings and `*` only. Catalog names ending in `.manage` shall not automatically match other permissions sharing their prefix.
- The catalog shall omit `*` and reject wildcard registration with `IdentityValidationError` before changing catalog state. Other descriptor IDs retain their existing registration behavior.
- WHEN checking an OR gate, the package shall test permissions in supplied order and stop at the first allow. IF none allows, THEN it shall throw `IdentityForbiddenError` with the joined permission string and last denial reason.
- WHEN clamping a grant, the package shall deduplicate the conferred strings and require each string to be held by the issuer without scope/constraint, or covered by an unconstrained wildcard. Empty conferred permission sets shall pass. The exported clamp alone shall not verify principal status.

## Administration ordering and guards

| Operation | Caller gate | Additional guards / effect |
|---|---|---|
| Create user, update email | `user.manage` OR `member.manage` | Create normalizes/checks duplicate username and validates/hashes password before writes; update omission/empty email clears the value |
| Disable principal | `user.manage` | Seeded owner always refused; already-disabled returns existing row; an owner-wildcard holder is refused when the observed active-owner count is at most one |
| Enable principal | `user.manage` | Human target required before active-state no-op; clears `disabledAt` |
| Reset password | `user.manage` | User lookup, seeded-owner third-party refusal, password validation/hash/save, then revoke all not-yet-revoked sessions |
| Create role/policy | `role.manage` | Trim/nonblank name; custom flags; no name-uniqueness enforcement by memory adapters |
| Assign role / attach policy | `role.manage` | Existing human target, existing role/policy, grant clamp, then new join row |
| Rename role | `role.manage` | Existing custom role and trimmed nonblank name |
| Update policy | `role.manage` | Existing custom/unfrozen policy; at least one defined name/description; omitted fields retained, supplied name trimmed |
| Delete role | `role.manage` | Existing custom role; no principal-role references |
| Delete policy | `role.manage` | Existing custom/unfrozen policy; no role-policy or principal-policy references; delete its permissions before its row |
| Write permission | `role.manage` | Catalog recognition before policy lookup; custom/unfrozen policy; grant clamp; absent scope/constraint stored as `null` |
| Remove permission | `role.manage` | Custom/unfrozen parent before row lookup; row membership proved within policy; no grant clamp on removal |

- The administration services shall perform their caller gate before target validation or writes.
- WHEN a user is created, the package shall allocate a new principal ID, save the active human principal, then save credentials, with no initial grants. Hash failure shall precede either save.
- WHEN disabling a principal, the package shall retain credentials/grants/session rows. Validation shall deny during disability; re-enabling can make an unrevoked, unexpired session valid again.
- WHEN resetting a password, the package shall revoke expired-but-unrevoked sessions as well as live sessions, using one revocation timestamp. It shall not revert the password save if enumeration or revocation fails.
- The package shall make serial enable/disable state changes and logout idempotent at the service level. Creates, resets, assignments, attachments, permission writes, and deletion of absent service targets shall have no general idempotency guarantee. Repeated grant writes allocate new join/permission IDs.
- Disable, role/policy delete, role assignment, policy attachment, and permission write/removal shall enclose the caller gate, guard observations, and writes in `IdentityRepos.transactions.run`. Missing transaction wiring shall throw `IdentityTransactionRequiredError` before any mutation. The host port shall serialize competing workspace status/grant/reference writers, bind reads/writes to one transaction, and roll back all writes on failure; a plain read-committed transaction is insufficient.
- `createTransactionalInMemoryIdentityRepos({ repos })` shall supply a dev/test adapter with a shared queue, detached repository inputs/results, and rollback snapshots. Every ordinary repository call shall use the same queue. Consumers shall use only returned handles; retained raw handles bypass isolation. Other service multi-write sequences remain nontransactional unless their host encloses them in a transaction.

## Defaults, limits, and seed behavior

| Setting | Current value / enforcement |
|---|---|
| Write-time password policy | Nonempty, at most 512 Unicode code points; no trimming or composition rules; applied only to create/reset |
| Seed/login password length | Seed bypasses the write policy; login checks presence without the 512-character bound |
| Argon2 defaults | `memoryCost: 19456` KiB, `timeCost: 2`, `parallelism: 1`; host overrides accepted without package-side cost validation |
| Session TTL | 30 days by default; positive finite `sessionTtlMs` option overrides the creation-time lifetime |
| Lists/grant graph size | Unpaginated, no enforced maximum or sort comparator |
| Timeouts/retries/rate limits | None imposed by this package |
| New principal/role/policy | Active human; role custom; policy custom and unfrozen |
| Login UI defaults | Blank username/password, no initial error/busy state |

- WHEN seed runs on a fresh workspace, it shall create/reuse a system principal, save disabled legacy system principal `user-local`, converge four built-in roles/policies, hash the explicit owner password, create owner credentials, then attach the owner role.
- The owner policy shall hold `*`. Fresh admin grants shall include the explicit administration/content/media/settings vocabulary in `src/server/seed.ts`, with `user.manage` and `role.manage` absent. Editor shall receive content CRUD, ordinary media read/upload/update/delete, and `theme.set`; viewer shall receive `content.read`, `changeset.read`, and `plugin.read`.
- WHEN a prior seed is incomplete, seed shall reuse built-in names/links and add missing permission strings. A same-named custom role/policy shall throw rather than be promoted.
- The seed's held-permission comparison shall count only rows whose `resourceType` and `constraintJson` are null or absent, matching authorization's unconstrained-grant semantics. A scoped or constrained row, including an empty-string constraint, shall not prevent creation of the intended usable grant.
- WHEN the owner username already exists, seed shall repair an owner role binding only if that principal has no roles; otherwise it shall retain existing authority and credentials. It shall not refresh all built-in grants on completed seeds.
- WHEN permission migration runs, it shall process policies and migration pairs in registry order within one injected identity transaction, add absent target strings, retain old rows, and return the number of new rows. Newly added strings shall be visible to later pairs in that run. Failure shall roll back every addition across all policies. Repetition shall return zero once all target strings exist. Missing transaction wiring shall fail closed before reading/writing migration rows.
- The migration shall currently determine held strings without examining source scope/constraint and write unscoped, unconstrained target rows, including on built-in/frozen policies. Consumers must account for this widening before applying migration metadata.

## Tool parsing and deliberate exclusions

- WHEN a catalog tool input is parsed, the parser shall reject non-object inputs, additional keys, missing required values, non-string values, then strings whose untrimmed Unicode code-point count is below `minLength`, reporting the first violation and preserving accepted original strings.
- Before inspecting input, the parser shall reject unsupported/misplaced keywords, non-object/open schemas, malformed properties/required declarations, non-string property schemas even when absent, malformed descriptions, and nonnegative-integer violations for `minLength`. Supported object keywords are `type`, `properties`, `required`, `additionalProperties: false`, and `description`; string-property keywords are `type`, `minLength`, and `description`. This is a closed flat-object subset, not a general JSON Schema validator.
- Required values shall be own input properties; inherited keys shall not satisfy them. Unknown own keys and present non-string values, including optional `undefined`, shall be rejected. Whitespace counts toward JSON Schema length; service-specific nonblank rules remain service validation.
- The package shall provide tool definitions without executing tools, selecting transport, enforcing confirmations, or creating audit events.
- The package shall provide no HTTP routes, cookies/CSRF protection, lockout/throttling, tenant provisioning, durable database adapter, email validation/delivery, member-server lifecycle, OAuth/MFA/password recovery, API-key issuance, machine-principal creation, role-policy editing service, role unassignment, direct-policy detachment, or user trash/deletion service.

## Guarded identity mutations

Administrative guard/read/write sequences and permission migrations use the required transaction runner. Registration rejects wildcard permissions; wildcard remains evaluator vocabulary. Seed convergence requires usable grants, and schema validation is eager with raw Unicode length. Unknown principals return `principal_disabled`; missing grant targets throw IdentityNotFoundError. Permission migration scope widening remains described in the migration contract.

Decision rationale: [Identity, authorization and sessions fail closed](../decisions/DR-001-identity-and-session-boundary.md), [Administration cannot grant authority the issuer lacks](../decisions/DR-002-grant-authority-and-admin-safety.md), [Permission renames add grants before retiring vocabulary](../decisions/DR-003-additive-permission-migration.md).
