Spec ID: SPEC-JINI-OAUTH-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:c77dc8b22906aae69891ec39c8d39645d00fcc3d4b1cd01ff537c6a137e3bfea
spec_mode: reverse_spec


# OAuth failures

## Typed failure shape

`new OAuthError({code, message, operatorAction}, {providerErrorCode?, retryAfterSeconds?, cause?} = {})` extends `Error`, sets `name = 'OAuthError'`, and exposes those fields plus `retryable`. Only `OAUTH_AUTHORIZATION_PENDING` and `OAUTH_SLOW_DOWN` set `retryable = true`. `isOAuthError({value})` checks `instanceof`; cross-realm or separately installed copies need their own classification.

| Code | Trigger | Caller action |
|---|---|---|
| `OAUTH_PROVIDER_UNREACHABLE` | High-level fetch/abort/redirect rejection caught as transport failure; expired lease wait with no valid token | Diagnose transport; initiate a deliberate later attempt. A consumed browser code/state cannot be reused. |
| `OAUTH_PROVIDER_REJECTED` | Non-OK provider response, unknown provider error code, non-denial callback error | Check client configuration and operator guidance; do not blindly retry the same grant. |
| `OAUTH_INVALID_STATE` | Unknown, expired, replayed, wrong-owner or wrong-provider state; empty/oversized callback state | Start a fresh authorization. Redemption failures intentionally share a message. |
| `OAUTH_INVALID_GRANT` | Provider `invalid_grant`; coordinator missing token, missing refresh token at refresh eligibility, or terminal refresh rejection | Reauthorize; consult durable status. Best-effort status-write failure is carried as cause. |
| `OAUTH_AUTHORIZATION_PENDING` | Provider `authorization_pending` | Wait until the next device polling interval. |
| `OAUTH_SLOW_DOWN` | Provider `slow_down` | Increase polling interval; inspect `retryAfterSeconds` when supplied. The package schedules nothing. |
| `OAUTH_ACCESS_DENIED` | Provider or callback `access_denied` | Stop this flow; obtain new user approval before restarting. |
| `OAUTH_EXPIRED_TOKEN` | Provider `expired_token` or local device expiry | Start a new device authorization. |
| `OAUTH_UNSUPPORTED_GRANT` | Undeclared browser/device grant or missing required grant endpoint; provider `unsupported_grant_type` | Select a supported grant or correct the descriptor. |
| `OAUTH_MALFORMED_RESPONSE` | Oversized/non-object/non-JSON document; missing token/client id/device required string | Check provider compatibility and endpoint configuration. |
| `OAUTH_UNSAFE_ENDPOINT` | Scheme or injected policy refusal, unsafe display link, strict metadata policy violation, DNS-pinned transport's visible redirect | Correct endpoint/egress policy. Do not weaken policy to retry. |
| `OAUTH_INVALID_REQUEST` | Invalid app identity, verifier, resource URI, reserved authorization extra, redirect membership, provider descriptor/lookup, pending-store limits, or exhausted authorization discovery | Fix caller configuration/input; begin a new flow when necessary. |

`mapProviderErrorCode({providerErrorCode})` recognizes `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`, `unsupported_grant_type`; everything else maps to `OAUTH_PROVIDER_REJECTED`. Dynamic registration always uses rejected rather than this granular map for provider rejection.

High-level flows omit remote `error_description` from messages. Raw provider `error` strings are retained in `providerErrorCode` and can appear in token/registration messages; callback codes are retained only when matching lowercase letters/underscores, length 1–64. Treat provider metadata and `cause` as untrusted/private diagnostic data. `retryAfterSeconds` is a finite numeric token-response `interval`, without positivity validation.

## Failures outside the typed vocabulary

| Surface | Failure | Caller action |
|---|---|---|
| File registration cache | `SyntaxError` on invalid JSON; plain `Error('invalid registration cache')` on invalid rows; raw I/O failures | Repair or replace the cache deliberately; protect stored client secrets. Later operations can succeed after repair. |
| Clock/numeric configuration | Native `RangeError`/date failures for invalid instants or unsupported timeout values | Supply valid clock values and numeric configuration. |
| Injected stores, entropy, scheduler, dispatcher, policy | Adapter exceptions can propagate; DNS lookup rejects empty answers with a plain `Error` | Classify at the composition boundary. Ensure cleanup and adapter observability. |

`invalidPendingAuthorizationState({})` returns an error object for store adapters to throw. No HTTP status/envelope is chosen by this package.

## Evidence and proactive reauthorization

The no-refresh-token path now distinguishes refresh due from expired; it still marks reauthorization within the proactive skew window. All token grants use typed OAuth errors and bounded parsing.

Other evidence: `src/errors.ts`, `src/token-endpoint.ts`, `src/pending-authorizations.ts`, `src/file-registration-cache.ts`, `tests/args-convention.test.ts`, `tests/pkce-and-state.test.ts`. Tests were not run.
