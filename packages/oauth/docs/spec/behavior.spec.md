Spec ID: SPEC-JINI-OAUTH-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:684cb05674f8f72b71b406c8582e2ef933cd708bbcbdc16d1709edc862a03f19
spec_mode: reverse_spec


# OAuth behavior contract

## Safety and ordering

- The high-level client shall delegate endpoint trust to the supplied guard before fetch. `createOAuthUrlGuard` shall require HTTPS unless `allowLoopbackHttp` explicitly permits HTTP for literal `localhost`, `127.0.0.1` or `[::1]`; the host policy shall still run. Scheme checks alone do not reject private addresses or URL userinfo.
- WHEN a policy throws a non-OAuth error, the guard shall wrap it as `OAUTH_UNSAFE_ENDPOINT`; WHEN it throws `OAuthError`, the guard shall preserve it. The policy receives a URL copy and cannot mutate the URL returned to the caller.
- WHEN device links embed userinfo, `assertSafeUserFacingUrl` shall reject them before display.
- The high-level fetch operations shall request `redirect: 'error'` and an abort deadline; they shall make one grant/registration attempt. Discovery alone tries multiple candidate documents. Fetch adapters must honor these settings.
- WHERE DNS-pinned transport is used, socket lookup shall snapshot and validate every resolved address before returning any of them. Empty/mixed forbidden answers shall fail; the validated addresses shall be used without a second resolution. Each fetch shall use the instance dispatcher and reject visible 3xx/opaque redirects, cancelling the body.
- WHERE issuer-bound policy is supplied, a present metadata issuer shall equal the requested string exactly, and present non-null endpoints shall be credential-free HTTPS URLs on the issuer origin. An absent issuer is accepted. Without this optional policy, discovery does not enforce issuer equality or endpoint-origin consistency.

## Discovery precedence

- WHEN `resource_metadata` is advertised, protected-resource discovery shall fetch that exact URL instead of well-known alternatives. Otherwise it shall try the path-suffixed protected-resource well-known location, then the root location for a nonempty resource path.
- Authorization metadata shall try inserted OAuth well-known, inserted OpenID well-known, appended OpenID well-known for a path issuer, then root OAuth and root OpenID locations. Each attempt gets its own deadline; there is no aggregate discovery deadline.
- WHEN fetched metadata is unsafe or malformed, discovery shall stop. Network/HTTP failures shall advance to the next candidate; missing token endpoints shall also advance. Protected discovery returns `null` after exhausted locations; authorization discovery throws `OAUTH_INVALID_REQUEST`.
- Advertised unsafe issuers shall be filtered out. WHEN none remain, the resource origin shall be used. Challenge scopes shall override resource-metadata scopes when nonempty.

## Browser grant

- WHEN beginning authorization, the client shall validate identity, supported grant, endpoint policy, exact normalized redirect membership, reserved extras and resource indicators before issuing pending state. Begin shall perform no provider HTTP request.
- The client shall reserve `resource`, `response_type`, `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method`; extra parameters cannot override these. Existing endpoint query fields are retained unless explicitly replaced; empty scopes and disabled PKCE do not remove pre-existing scope/challenge fields.
- WHERE `usesPkce` is true, the client shall request 32 random bytes and send only the S256 challenge in the browser URL. Stored verifiers shall be 43–128 characters in the RFC unreserved set.
- WHEN completing authorization, callback bounds shall be checked before consuming state. The store shall consume state before owner verification; provider mismatch, provider denial, absent code or failed exchange after consumption shall require a fresh authorization.
- The token request shall replay the stored redirect URI, PKCE verifier when enabled, and resource binding. Completion does not persist the returned token set.

## Token, registration and device rules

- Token requests shall send URL-encoded POST bodies. Public clients send `client_id`; POST-secret clients additionally send a truthy secret; Basic clients encode URI-encoded id/secret in the Authorization header. Required-secret presence is not validated here.
- Resource indicators shall be absolute and contain no `#`, including a bare trailing `#`; supplied arrays replace any existing resource fields and append repeated values in order.
- Successful token responses shall require a nonempty string access token. Missing/empty refresh token becomes `null`, missing/empty token type becomes `Bearer`, scopes split on whitespace/commas, and positive finite numeric/coercible expiry becomes an absolute timestamp; other expiry becomes `null`.
- Dynamic registration shall default to public authentication, grants `authorization_code, refresh_token`, response type `code`, application type `web`, and the consumer's complete identity. A recognized echoed auth method wins; otherwise a volunteered secret selects Basic before POST when advertised support permits it.
- Device begin shall accept `verification_uri` or legacy `verification_url`, validate display links, and clamp lifetime/interval as below. Device begin supports POST-secret auth; it does not emit Basic authorization for `client_secret_basic`.
- WHEN polling an expired device authorization, the client shall fail before HTTP. Every poll call shall make at most one token request; the host owns cadence and handles pending/slow-down outcomes.
- WHEN refreshing, a missing new refresh token shall preserve the old refresh token. The coordinator shall coalesce refreshes per key and persist rotation before returning the new access token.
- WHEN a token is inside refresh skew, even while still valid, the coordinator shall refresh or report missing-refresh-token reauthorization. Null expiry shall never proactively refresh. Terminal invalid-grant/access-denied outcomes shall mark reauthorization best effort; other failures shall preserve status.
- WHERE a refresh lease is unavailable, the coordinator shall reload until its deadline, then return a still-valid token or fail. It shall never refresh behind the lease holder. Lease release errors are swallowed.

## Defaults and limits

| Scope | Current value |
|---|---|
| Discovery request deadline | 10,000 ms per candidate |
| Token/device/registration request deadline | 15,000 ms; caller override |
| Metadata/token/registration JSON | 65,536 response bytes; a JSON object required |
| Device JSON | 16,384 response bytes |
| Callback code/state | Code maximum 2,048 characters; state nonempty and maximum 256 |
| Device lifetime | Ceil and clamp 30–1,800 seconds; missing/nonfinite defaults 1,800 |
| Device poll interval | Ceil and clamp 1–60 seconds; missing/nonfinite defaults 5 |
| Pending authorization store | TTL 600,000 ms; maximum 256 entries; state entropy 24 bytes |
| Refresh coordinator | Skew 120,000 ms; lease wait 5,000 ms; polling 250 ms |
| Operator provider | Empty scopes, PKCE enabled, client authentication `none` |
| Provider identifiers | Lowercase letter/digit first; lowercase letters, digits, hyphens thereafter; 1–64 characters |

Bounded readers shall cancel bodies on completion or overflow. Arbitrary adapter read/persistence failures can propagate without OAuth normalization. The caller supplies valid clocks and positive timeout/coordinator values; most factories do not validate numerical configuration.

## Deliberate exclusions and evidence

The package supplies no browser redirect handler, UI, login session, credential encryption, durable pending/token store, provider presets, device polling loop, automatic grant retry, token revocation or network access-control policy. Registry construction registers no providers.

Fixed-issuer code exchange and refresh use the same URL guard, abort deadline, bounded token parser, redaction and OAuthError mapping as the main grants; results are normalized OAuthTokenSet values. Payload pending stores use the consolidated bounded cache implementation.

Evidence: `src/authorization-code.ts`, `src/discovery.ts`, `src/device-code.ts`, `src/refresh.ts`, `src/pending-authorizations.ts`; `tests/authorization-code.test.ts`, `tests/device-code.test.ts`, `tests/token-refresh.test.ts`, `tests/retirement-security.test.ts` (read only).


Loopback HTTP is opt-in and then admits the full IPv4 loopback range and IPv4-mapped loopback, subject to the host URL policy. Path-scoped issuer discovery does not fall back to origin-wide endpoints unless explicitly enabled. Missing-refresh-token reauthorization distinguishes a proactive refresh-due instant from hard expiry.
