Spec ID: SPEC-JINI-CAPABILITY-PROVIDERS-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:bdccd8234c4e0efe99a004b0e62350196edca69389cf7054173c89da5b6d79f5
spec_mode: reverse_spec


# Capability providers error contract

| Error / result | Trigger | Caller action |
| --- | --- | --- |
| `VisitorAuthRegistryError({ code, message })`, code `invalid-provider` | Invalid metadata id/label/credentials/scopes | Correct configuration before registration |
| Same class, `duplicate-provider` | An id is already registered | Reuse its definition or choose another id; registration is append-only |
| `VisitorAuthConfigurationError({ code, message })`, `invalid-input` | Missing bindings, invalid clock/TTL/security artifacts/skew or malformed required configuration | Reject the request and repair host configuration/input |
| Same class, `insecure-url` | Endpoint or redirect violates URL policy | Supply a trusted allowed URL |
| Same class, `provider-mismatch` | Definition, server and registration identify different providers | Fix tenant/provider resolution |
| Same class, `pkce-s256-required` | Authorization server does not support required S256 | Select a compatible trusted server |
| Same class, `reserved-parameter` | Endpoint query/extras override fixed authorization parameters | Remove the override |
| `StripePaymentsProviderError({ message, status }, { stripeType?, stripeCode? } = {})` | Missing key (401), missing fetch (500), local amount/refund checks (400/404), or remote non-success response | Inspect status/type/code; reconcile uncertain payment state before retrying a mutation |
| Stripe refund error with status 402 | Remote refund status is failed or canceled | Surface payment failure; do not treat the charge as refunded |
| Ordinary `Error` | Empty JWT secret/blob namespace; duplicate email/record; bad signin; reference payment invalid amount, missing or invalid-state refund | Fix configuration, credentials or operation preconditions; these errors have no stable package code |
| Backing filesystem/database/crypto/fetch/socket errors | Adapter dependencies fail, SQL/JSON cannot represent data, network fails, or socket send fails | Handle the underlying dependency error; network exceptions are not wrapped consistently |
| Subscriber exception | A realtime handler throws | Repair/isolate the handler; publication may have partially delivered |

`StripePaymentsProviderError` exposes `status`, optional `stripeType` and `stripeCode`; it has no package error-code enum. A malformed remote JSON body is treated as an empty object, so response-derived fields may fall back rather than raising a parse error.

## Rejections returned as values

`evaluateVisitorAuthCallback` returns rejection reasons `tenant-mismatch`, `flow-binding-mismatch`, `expired`, `state-mismatch`, `issuer-mismatch`, `provider-error`, `missing-code`. They are not thrown exceptions. After rejecting, discard the consumed transaction and start a fresh authorization flow if appropriate. A provider error may carry only a sanitized provider error code.

`validateVisitorAuthIdentityClaims` returns `audience-mismatch`, `authorized-party-mismatch`, `expired`, `issuer-mismatch`, `malformed-claims`, `nonce-mismatch` or `subject-missing`. Do not create a session on rejection. Its input is typed, verified claims; arbitrarily malformed JavaScript objects can also trigger native errors.

Missing auth sessions, storage objects, database records and charges use `null`; missing registry entries use `undefined`. These are normal absence results. No shared base error class or universal retry policy is provided.
