Spec ID: SPEC-JINI-INTEGRATIONS-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:77f44887fe055e70b2020060eeeaf4baa6a8759ea3f38732c9e90cfc5b6caa77
spec_mode: reverse_spec


# Error Contract: Integrations

## Credentialed HTTP and webhooks

These exported errors extend an internal IntegrationError, whose current constructor is `({ message: string }, { options?: ErrorOptions } = {})`. They inherit the ordinary Error name and have no code; identify them with `instanceof`.

| Class | Trigger | Caller response |
|---|---|---|
| `CredentialNotFoundError` | Resolver describe/resolve returns null | Add or select an authorized workspace credential |
| `CredentialedRequestValidationError` | Blank label, unsupported method, invalid/disallowed URL, embedded credentials, forbidden/non-string headers, non-string/oversized body | Correct request; do not retry unchanged |
| `CredentialedRequestTransportError` | General request's transport rejects and host policy does not identify it as egress refusal | Inspect redacted message; retry only with host policy for the method's side effects |
| `WebhookSubscriptionValidationError` | Blank label/topics, invalid/non-HTTPS/disallowed target, pause/resume of disabled row | Correct data or create a valid subscription |
| `WebhookSubscriptionNotFoundError` | Workspace-scoped subscription lookup misses | Refresh/select a valid workspace subscription |
| `WebhookDeliveryVetoedError` | Hook returns send=false | Delivery processor catches it and records failure/backoff; inspect host hook policy |

`verifyCustomCredential` converts transport rejection to unreachable; 401/403 are returned invalid diagnostics. `makeCredentialedRequest` returns all HTTP statuses as executed results, including 401/403 diagnostics. Host-recognized egress refusals are rethrown unchanged on the general path. Resolver/registry/audit/mapper errors propagate. Scheme-file parse failure is `{ ok: false, reason }`, and detection miss is null.

Fixed-secret signing throws ordinary Error when a subscription has no supplied secret. Verification returns false for malformed headers, invalid time/tolerance, replay-window miss and mismatch. Key derivation failures propagate. Delivery attempts catch hook/lookup/envelope/signing/transport failures as record error text; repository claim/outcome-save failures reject `processDueDeliveries`. Missing envelope/subscription and non-active subscriptions enter retry/dead-letter handling, not cancellation.

## Media denials, throws, and recorded errors

| Error or code | Trigger | Caller response |
|---|---|---|
| `MEDIA_EXECUTION_DISABLED` | Default/explicit disabled policy | Enable only through host policy |
| `MEDIA_SURFACE_DENIED` | Surface not in nonempty allowlist | Select an allowed surface |
| `MEDIA_MODEL_DENIED` | Missing/blank/unlisted model with a nonempty allowlist | Supply an allowed model |
| Ordinary Error from engine | Unsupported surface/audio kind, missing/unknown/wrong-surface model, absent renderer | Correct request/catalog route; placeholders require explicit opt-in |
| Ordinary Error from renderer/guard/parser/signer | Missing API key, vendor non-2xx/logical error, malformed response, missing/zero bytes, unsafe URL/redirect, failed download | Inspect provider context; honor egress refusal and bound retries |
| Ordinary Error from vendor registry | Duplicate provider/route registration | Register each pair once |
| Ordinary Error from staging | Unsafe directory name, excessive paths, invalid supplied upload root, symlink destination | Correct host paths/configuration; advisory missing/unauthorized source paths are skipped |
| Ordinary Error from task/operation store | Duplicate id or rejected state-key shape | Use unique ids or safe handle shape; do not retry unchanged |
| RangeError from stores | Invalid status/transition/TTL; operation maxAttempts/deadline invalid | Correct lifecycle inputs |
| Ordinary Error from hydration | Stored schema discriminator is newer than version 1 | Upgrade the reader before interpreting the record |
| `DAEMON_RESTART` | Task boot reconciliation interrupts in-flight tasks | Start new work explicitly; no task resume is supplied |
| `DEADLINE_EXPIRED` | Poll/recovery sees the absolute deadline passed | Reconcile vendor effect before resubmitting |
| `ATTEMPTS_EXHAUSTED` | Poll budget exhausted without terminal answer | Inspect vendor operation; increase future budget deliberately |
| `NO_ADAPTER` | No polling adapter for persisted provider/route | Supply the compatible adapter; current row is marked failed |
| `CRASH_GAP_NOT_IDEMPOTENT` | Submitted crash gap with no proven safe resubmit | Reconcile manually; avoid duplicate charges |

Policy codes are returned `MediaPolicyDenial` values, not thrown errors. Task/operation codes are record `error.code` values, not error-class fields. Parser/provider errors have no unified stable error-code class; strings can include upstream excerpts. `CREDENTIAL_IN_STATE_MESSAGE` prefixes ordinary errors for unknown state keys or nesting beyond twelve. This guard validates key names, not whether a permitted jobId string is secret-free.

`startOperation` can return done=false with a recorded failed row; query by operationId rather than treating every pending-shaped outcome as active. Successful vendor outcomes whose persistence retries fail retain submitted rows, and inline complete results can still be returned. Store failure during polling can reject a tick; operation counters do not prove successful persistence. Native SQLite import/open/serialization/close failures propagate, so ensure the optional peer dependency is available only when using a SQLite adapter.

No package-wide HTTP mapping, retry coordinator, error logging policy or promise of sanitized vendor message content is provided. Evidence: current credential/webhook errors, media policy/engine/parsers/stores/runtime.
