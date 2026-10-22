Spec ID: SPEC-JINI-CORE-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:0ecd2a443d46667f94d2449d64b7bf14353a566415346b8b7c9899153fd35a1f
spec_mode: reverse_spec

# Behavior Contract: @jini-ai/core

## Composition and tool authorization

- Tokens default to version 1. Singleton rebinding throws; many bindings append in insertion order and do not validate version compatibility.
- Packs construct services synchronously in supplied order. A duplicate pack name overwrites the earlier named service; no duplicate-name guard exists.
- Resolution checks declared token IDs. All declared dependencies are resolved before any service factory runs, including unused singletons; singleton presence and version are checked at resolution, and static missing-ID typing remains separate. Many-token lookup returns an empty array when unbound and may return the stored mutable array.
- Composition does not register tools, mount transports, or dispose resources. `DaemonOptions.transports` is unused. Consumers explicitly call the relevant helpers.
- `registerPackTools` walks pack order and tool order. A duplicate tool ID throws after earlier registrations have succeeded; there is no rollback or repeated-call deduplication.
- `disposePacks` runs sequentially in reverse pack order, returns failures, and continues after each failure. It has no timeout or once-only flag.
- Tool enumeration returns descriptors in registration order, with the original descriptor objects. Handler/policy state is held in a WeakMap. Root enumeration cannot retrieve them.
- Internal authorization runs policy first and calls the delegate only after an allow. Only exact `'allow'` releases the handler. Unknown tools return undefined. Policy/delegate exceptions propagate. No tool execution, confirmation UI, timeout enforcement, output truncation, or schema validation happens here.
- A tool is read-only only when `descriptor.readOnly === true`; absence fails the read-only check.

## Gated mutations

1. `plan` authorizes the read permission, computes a plan, then generates its ID.
2. `confirm` rejects agent principals before any authorization or token generation. It checks mutation permission and persists a newly minted token. It accepts the caller's plan hash without recomputing the plan.
3. `execute` checks mutation permission, token existence/status/time, actor-class identity, scope, and freshly recomputed plan hash, in that order. It atomically redeems the token before invoking the mutation.

Instance scope requires `authorizeInstance`; absence denies with underlying reason `INSTANCE_AUTHORIZATION_NOT_CONFIGURED`. Default scope is workspace. The thrown authorization reason code is `NOT_AUTHORIZED`.

Token TTL is supplied by the consumer and must be positive and finite. `now` must parse as a timestamp; generated tokens must be nonempty strings. Expiry is exactly creation time plus TTL in seconds; the exact `expiresAt` instant is redeemable. There is no random TTL jitter. Token records bind plan hash, scope, and confirmer identity, but not domain or plan ID.

Actor identity must resolve to the confirmer ID and token scope must equal hook scope. Stale-plan/identity/scope failures leave the token unredeemed. Once redemption succeeds, even a failing mutation consumes the token; this package does not roll back or retry the mutation. A durable store must make `tryRedeem` atomic across its actual concurrency boundary.

`appendActorReference` rejects cross-workspace actor/delegator references and emits nulls for omitted delegation fields. It does not validate whether the actor exists or authenticate the principal. `UnauthenticatedError` is exported for consumer use but is not raised by the gateway.

## Error policy, naming, and contribution state

- Error rules use `instanceof` in supplied order. Existing `ToolInputError` passes through; the first matching domain rule becomes `ToolInputError` with `code: message` and optional guidance. Unknown errors retain identity. Caller-safe formatting returns only an allowlisted message or fallback.
- Error wrappers affect handler exceptions; they preserve descriptors/policies and forward optional handler arguments. They do not sanitize allowlisted messages, log, report, or perform authorization.
- Contribution registration replaces a matching key without moving its first insertion position. Lists copy the array, not contributions; clear removes all entries.
- Naming tries the base at attempt 1, then host suffixes 2 through `maxAttempts` (default 1000), awaiting each availability predicate sequentially. Exhaustion invokes the supplied callback or throws the host message. Bounds must be positive safe integers.
- Duplicate naming treats the source name as unavailable. A trailing space-number is stripped only when the resulting base is already taken. Naming checks do not reserve a name or prevent races with concurrent writers.

## Environment, origins, and redaction

Truthy flags recognize trimmed, case-insensitive `1`, `true`, `yes`, and `on`. Tokens are trimmed; middleware is enabled only for a nonempty token with auth not disabled. Empty token configuration disables the middleware predicate, so the host owns fail-closed authentication policy.

Allowed origins are comma-separated HTTP(S) URLs normalized to `.origin`. The tolerant reader skips invalid entries and optionally warns; the assertion throws for any invalid entry. Ports come from explicit daemon port and the configured web port. Browser helpers permit configured origins plus explicit/local/private-LAN hosts according to their port checks. A no-Origin remote hostname requires `sec-fetch-site: same-origin`; IP-literal configured origins and local hosts use the local allowance path. These helpers do not implement CORS, authenticate credentials, or provide an outbound SSRF boundary.

Redaction replaces recognized secret and personal-data patterns with `[REDACTED:<category>]`. Credit-card candidates must pass Luhn. Counts reflect sequential matches, not exhaustive detection; text in formats outside those patterns may remain. These functions do not parse structured data or encrypt it.

## Resolved comment mismatches

`src/daemon.ts` now validates declared dependencies eagerly before any service construction and documents version checks at resolution rather than bind time. `src/pack.ts` now assigns exactly-once tool registration and registration-before-mounting to the composition root; that ordering and cardinality still require consumer orchestration and are not enforced by `createDaemon` or `registerPackTools`.

`src/pack-lifecycle.ts` and its duplicate-error test title now describe the unchanged registry error, which names only the tool ID. Pack order still determines which contribution triggers the failure, and earlier successful registrations remain installed.

Evidence: source modules named in `api.spec.md`; `src/__tests__/pack-lifecycle.test.ts`, `tool-registry.test.ts`, `gated-mutations-gateway.test.ts`, `gated-mutations-token.test.ts`, `origin-validation.test.ts`, `redact.test.ts`. No runtime verification was performed.

Decision rationale: [Confirmation checks have a fixed order and atomic redemption](../decisions/DR-001-gated-mutation-check-order.md).

## Kernel primitives and input boundaries

- `nowIso` samples `Clock.nowMs()` once. Invalid epoch milliseconds throw during ISO formatting. UUID generation uses Web Crypto without an insecure fallback.
- `pathContains` requires absolute paths, normalizes whole segments lexically, includes equality, and defaults to POSIX/case-sensitive comparison. Backslashes are literal under POSIX; Windows drive/UNC behavior requires the separator option. Hosts resolve symlinks and relative paths before calling it.
- Conservative root redaction preserves bare UUIDs, hashes, model IDs and path segments. Aggressive mode additionally masks opaque runs of at least 20 characters while preserving complete recognized correlation/route identifiers. Exact secrets are processed longest first. The bounded text sanitizer strips terminal controls, masks lexical secrets and counts its truncation marker inside the output budget.
- Registration-kit human confirmation executes prepare, askHuman, then run only for exactly `confirmed: true`; the confirmer is the delegating principal with kind user. Wiring rejects absent/mismatched independent risk, unsupported catalog/handler combinations, and missing branded human-confirmation handlers. Schema decoration is restricted to caller-selected shape errors. These checks do not replace host authorization.
