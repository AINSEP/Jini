Spec ID: SPEC-JINI-CORE-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:c111891429027642bfc851aa7893b6f78adab868b09ff292cf81edd1a2c3b329
spec_mode: reverse_spec

# Error Contract: @jini-ai/core

## Error classes and caller action

There is no universal error envelope, HTTP mapping, or automatic retry. Use `instanceof`; most custom classes retain the native `Error.name` and expose no code field.

| Exported class | Constructor | Raised when | Caller action |
|---|---|---|---|
| `ToolInputError` | `({ message }, ErrorOptions = {})` | Consumer handler validation or allowlisted model-facing reclassification | Correct input or follow attached guidance; do not retry unchanged input |
| `ForbiddenError` | `({ message, reasonCode }, ErrorOptions = {})` | Gateway authorization, confirmer, actor, or scope gate denies | Fix permission/identity/scope; never bypass the gate |
| `PlanStaleError` | `({ message }, ErrorOptions = {})` | Recomputed plan hash differs from the token hash | Re-plan and obtain fresh confirmation |
| `TokenExpiredError` | `({ message }, ErrorOptions = {})` | Unknown token, elapsed/explicit expiry, failed redemption without a redeemed record | Obtain a fresh confirmation |
| `TokenAlreadyRedeemedError` | `({ message }, ErrorOptions = {})` | Previously redeemed token, including a concurrent redemption winner | Inspect mutation outcome; do not reuse the token |
| `WorkspaceMismatchError` | `({ message }, ErrorOptions = {})` | Actor/delegator workspace differs from the referencing row workspace | Correct the reference; reject cross-scope data |
| `UnauthenticatedError` | `({ message }, ErrorOptions = {})` | Exported for consumers; no package function throws it | Authenticate at the consuming boundary |

`ToolInputError.name` is explicitly set. `ForbiddenError.reasonCode` is one of `NOT_AUTHORIZED`, `AGENT_CANNOT_CONFIRM`, `ACTOR_CLASS_MISMATCH`, or `SCOPE_MISMATCH` in current gateway code. Missing instance authorization contributes `INSTANCE_AUTHORIZATION_NOT_CONFIGURED` to the denial message, not to `reasonCode`.

## Native failures and returned failures

| Source | Failure | Caller action |
|---|---|---|
| Singleton bindings | Plain Error: duplicate binding, missing binding, version-incompatible binding | Repair composition before serving requests |
| Scoped container | Plain Error: undeclared dependency ID | Declare the dependency explicitly |
| Tool registration | Plain Error: duplicate descriptor ID | Repair colliding registrations; discard partial composition |
| Token mint/save | RangeError for invalid timestamp/TTL; Error for empty generated token or duplicate token | Repair configuration or token generator; preserve uniqueness |
| Naming | RangeError for invalid attempt bound; host exhaustion Error/callback; predicate errors propagate | Correct bound or resolve namespace exhaustion |
| Origin configuration | Error for invalid allowlist entries; `configuredAllowedHosts` can throw URL parsing errors on raw invalid origins | Validate configuration at startup |
| Pack teardown | `{ pack, error }` entries returned in an array | Report each failure and finish cleanup |
| Policy, delegate, service, store, hooks | Supplied dependency's exception propagates | Handle according to the dependency contract |

Model-facing rule codes are consumer-supplied text prefixed into a `ToolInputError.message`; there is no structured `.code` property. `forbiddenRule` constructs `<domainPrefix>_FORBIDDEN`. Unknown failures remain unknown; `callerSafeErrorMessage` provides a caller-selected fallback.

Evidence: `src/tool-registry.ts`, `src/bindings.ts`, `src/pack-lifecycle.ts`, `src/gated-mutations/*`, `src/model-facing-tool-errors.ts`, `src/naming.ts`, `src/origin-validation.ts`; corresponding tests were read, not run.

## Primitive and registration-kit failures

`toIsoDateTime`/`nowIso` can throw native `RangeError` for invalid dates. `pathContains` throws `RangeError('pathContains requires resolved absolute paths')` for unresolved inputs. Crypto and console adapter failures propagate. Timing comparison propagates the host comparator's exception after equal-length admission. Input readers throw `ToolInputError`; wiring gates and duplicate risk ownership throw plain `Error`. No transport/status mapping is introduced.
