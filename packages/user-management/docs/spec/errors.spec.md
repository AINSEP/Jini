Spec ID: SPEC-JINI-USER-MANAGEMENT-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:864f991eb74a64723376c684b97ca239a2242fdfd6616d53a7e6edffc5e8046d
spec_mode: reverse_spec


# User management error contract

## Error representation

The root exports nine `Error` subclasses. Constructors use `(required, optional: ErrorOptions = {})`, preserving an optional `cause`; their exact inputs appear in [api.spec.md](api.spec.md). The classes do not set `.code`, HTTP status, envelope, or subclass-specific `.name`. Consumers identify them by `instanceof`, then map them to transport/UI codes. Codes below are the mappings named by source comments, not properties emitted by these services.

| Class | Consumer mapping | Thrown when | Caller action |
|---|---|---|---|
| `IdentityValidationError` | `VALIDATION_ERROR` | Wildcard permission registration; blank create username/password/name; failed create/reset password policy; non-human grant/enable target; immutable built-in/frozen edit/delete/permission target; policy update with neither defined name nor description | Correct input or choose a mutable human/custom target; retain drafts |
| `IdentityNotFoundError` | `NOT_FOUND` | Workspace-scoped principal/user/role/policy lookup fails; removal row absent from the named policy | Refresh state and verify scope/ID; do not retry unchanged |
| `IdentityConflictError` | `RESOURCE_CONFLICT` | Create username already exists; role still assigned; policy still referenced by roles/principals | Choose a different username or resolve references before deletion |
| `AuthInvalidCredentialsError` | Host-defined; no code specified by this class | Login has empty fields, unknown username, missing/inactive principal, or false verification | Request credentials again; avoid disclosing which check failed |
| `OwnerRequiredError` | `OWNER_REQUIRED` | Disable targets supplied seeded-owner ID; observed disable would leave no active wildcard owner; another caller resets supplied seeded owner's password | Preserve owner access; use authenticated owner self-reset for credential rotation |
| `PermissionUnknownError` | `PERMISSION_UNKNOWN` | Permission write string is absent from the catalog, including `*` in the default catalog | Register an intended permission at trusted startup or correct the string |
| `IdentityForbiddenError` | `FORBIDDEN` | No permission in the caller OR gate authorizes the caller | Stop the mutation; authenticate/obtain the required grant |
| `GrantExceedsIssuerError` | `GRANT_EXCEEDS_ISSUER` | Assignment, attachment, or permission write would confer strings the caller does not hold unconstrained | Reduce the grant or use a caller that already holds all conferred strings |
| `IdentityTransactionRequiredError` | Host-defined; no code specified by this class | Guarded mutation or migration has no transaction port | Bind transaction-capable storage; do not retry with weaker isolation |

`IdentityForbiddenError` adds `permission: string` and `reason: string`. An OR failure joins permissions with `|` and reports the last reason. `GrantExceedsIssuerError` adds `offendingPermissions: string[]`, deduplicated by the clamp in first-occurrence order. Other classes expose only standard Error data.

Missing grant targets are not-found errors; non-human grant targets are validation errors, as the grant helper comment now states. Service errors can contain identifiers, normalized usernames, and internal comment labels; a consumer should choose its own external message instead of assuming every message is suitable for end users.

## Nonthrowing failure results

| Entry | Failure result | Caller action |
|---|---|---|
| `validateSession` | `null` for unknown/revoked/expired session or missing/inactive principal | Treat as unauthenticated (`UNAUTHENTICATED` in source's suggested transport mapping); do not continue to protected operations |
| `authorize` | `{ allowed: false, reason }` | Deny the action; reasons are `principal_disabled`, `principal_kind_denied`, `no_grant`, `unconstrained_deny`, or `resource_scope_mismatch` |
| `validatePasswordPolicy` | Message string; success is `null` | Display validation text; do not hash/store on a failed write policy |
| `Argon2PasswordHasher.verify` | `false` when the loaded binding throws during verification | Treat as invalid credentials; binding-load exceptions still propagate |
| `parseIdentityToolInput` | `{ ok: false, error: Error }` for malformed input | Return a validation failure and do not call a service |

## Uncoded exceptions and partial failures

- Seed throws plain `Error` when a built-in role/policy name collides with a custom row. Resolve the collision; do not adopt/promote that row automatically.
- Tool parsing throws plain `Error` for malformed/unsupported schema shapes and unimplemented schema keywords, non-object top-level schema, and any declared non-string property schema, even when absent from input. Repair the schema/interpreter; these are developer failures, distinct from an invalid-input result.
- Native Argon2 loading, hashing, repository operations, clock/ID/token dependencies, and invalid date arithmetic can propagate their original exceptions. No service wraps them into a stable infrastructure code.
- Memory repositories do not manufacture validation/conflict/not-found errors; missing finds return `null` and missing deletes/revocations are no-ops. Service guards provide the domain failures.
- Fakes throw configured `Error` objects unchanged. Missing fake users/roles/policies/members and mismatched permission-removal IDs throw plain `Error`, without a stable code.
- A rejected nontransactional multi-write operation can retain earlier writes: session before last-login, principal before credentials, password before session revocation, or a partial seed. Inspect persistence before retrying. Guarded policy deletion and migration fan-out instead roll back all writes through their required transaction port.

## Browser error formatting

`describeIdentityError({ error, fallback, translate }, { messages = {} } = {})` returns a string. For a structural string `.code` of `VALIDATION_ERROR`, a nonempty native `Error.message` wins; otherwise it translates `Please correct the highlighted fields.`. For another mapped code, it translates the mapped message. Otherwise it returns a nonempty native Error message or the supplied fallback, without translating the fallback itself.

| Screen | Structural codes with predefined translated messages |
|---|---|
| Users | `GRANT_EXCEEDS_ISSUER`, `FORBIDDEN`, `RESOURCE_CONFLICT`, `OWNER_REQUIRED`, `SELF_DELETE`, `USER_IN_TRASH`, `USERNAME_IN_TRASH` |
| Roles/policies | `FORBIDDEN`, `RESOURCE_CONFLICT`, `PERMISSION_UNKNOWN`, `GRANT_EXCEEDS_ISSUER` |
| Members | `FORBIDDEN` |

Trash/self-delete codes are accepted from host transports; no corresponding error class or server deletion service is exported here. Login uses the received native Error message, or translated `login failed` for a non-Error rejection. List and mutation hooks store display errors in their controllers; a browser string error does not establish that a server mutation was rolled back.

## Evidence

Source: `src/core/types.ts`, server guards/hasher/parser/seed, `src/react/errors.ts`, and screen rule modules. Existing service and screen tests corroborate domain rejection, grant clamp payloads, generic login failure, translated structural transport codes, and draft retention. Tests were read, not executed.
