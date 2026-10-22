Spec ID: SPEC-JINI-HTTP-KIT-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:4b588c416e2862e2f5fb2c4e50ad9a28c269cffe692a5c46e5c11613659d66b8
spec_mode: reverse_spec


# HTTP-kit behavior contract

## Transport ordering and errors

- WHEN mounting a JSON route, the adapter shall evaluate requested same-origin policy before parsing, parse before handling, and serialize successful results at `successStatus ?? 200`. Failures use the error-to-status map in `errors.spec.md`.
- WHEN the response closes while a handler is pending, the adapter shall abort the supplied signal. WHEN a successful/result failure handler returns after that abort, the adapter shall skip its response write. Handlers must opt into cancellation; exceptions still enter the catch boundary.
- WHEN a `ClientFacingError` is thrown, the adapter shall disclose its selected ApiError. Other exceptions shall produce a generic correlated 500 and send the original exception to the host sink, defaulting to console.error. Host sinks must not throw; most module sinks are not isolated from sink failures.
- Route registration shall have no listening-server effect. `mountPackHttp` shall visit packs in input order, skip absent HTTP extensions, and pass each extension `{app, services: daemon.services[pack.name]}`. Repeated registrar calls are not generally idempotent.
- WHEN duplicate guarding is installed, only literal string paths shall be inventoried. Selected `METHOD PATH` duplicates shall throw before the original registration; the attempted duplicate is already in the inventory. Installation is not idempotent and must happen once per app.

## Origin and credential policies

- WHERE per-route same-origin is requested, the guard shall use the adapter's current port and environment. Local/IP hosts without Origin can pass; configured domain hosts without Origin require `Sec-Fetch-Site: same-origin`. An exact configured Origin can pass independently of Host. This is a local-browser policy, not strict scheme/host/port equality or user authentication.
- `configuredAllowedOrigins` shall drop and warn on malformed entries on each call; boot-time `assertValidAllowedOrigins` shall throw instead. Parsing valid HTTP(S) URLs retains only their origin; path/query/userinfo are not rejected by this config parser.
- WHERE API-origin middleware is mounted, absent/empty Origin shall pass, `Origin: null` shall fail, and browser requests shall fail until a resolved port exists. A rejected exact-match GET with a portless loopback Origin shall pass its narrow fallback; mutations do not receive that fallback.
- WHERE optional API bearer auth is enabled, probe paths shall pass. Unproxied loopback peers shall pass only when `trustLoopbackPeers` is true (default); any nonempty forwarding header removes that exemption. No configured token or enabled disable flag results in no middleware registration.
- WHERE strict bearer middleware is used, an unset/empty configured token shall fail 503; absent/malformed/wrong bearer shall fail 401, including loopback callers. Exact exempt paths pass first. The host shall mount it unprefixed to preserve exempt-path meaning.
- WHEN local-daemon request validation runs, peer, Host and any Origin shall be loopback; forwarded identity is ignored. Allowed requests receive loopback CORS headers, methods GET/POST/OPTIONS, Content-Type allowed, max-age 600 seconds.

## Limits, queues and defaults

| Mechanism | Guarantee/default |
|---|---|
| Fixed-window rate limiter | Per-key window starts on first accepted check; budget `max + burst`; rejection does not increment count; retry is ceil-to-seconds, minimum 1 |
| Limiter queue and pruning | Checks serialize across storage awaits; expired keys are swept at most once per window on a check; storage failure does not poison later queue entries |
| Client IP resolution | First forwarded hop only for a trusted socket peer; otherwise supplied fallback policy; no built-in proxy trust |
| Parsed JSON limit | UTF-8 bytes of `JSON.stringify(body ?? {})`; rejects only `bodyBytes > maxBytes` with caller envelope and 413; null/undefined count as `{}` |
| Generic SSE channel | Queue maximum 1,000 by default, FIFO; writes pause on false until drain; overflow closes instead of silently dropping events |
| Raw SSE response | Queue maximum 1,000 including keepalives; ping every 15,000 ms; opens headers immediately; caller controls closure |

The limiter validates nonempty string keys, but does not validate the profile or clock. Invalid profile/clock values have no reliable limiting guarantee; an absent counter starts with an allowed count of one even for a nonpositive budget. JSON limiting occurs after parsing and is not an allocation bound; the host parser needs its own limit.

## Verified origin

- Canonical verified-origin lookup shall use repository evidence, never request headers. Missing evidence shall throw; redirect/egress decisions shall return false on parse/repository/evidence errors.
- Candidates shall reject raw whitespace, controls, backslashes and userinfo, normalize lowercase host/one trailing dot/effective port, then compare scheme/host/port. basePath is not a boundary. Canonical same-origin HTTP is accepted only for development evidence; cross-origin allowlists require HTTPS and exact normalized host, without a port restriction.
- `createVerifiedOrigin` shall copy evidence and reject HTTP with a non-development source. It does not validate every field or prove ownership. Configured origin shall require HTTPS, no userinfo/nonempty query/nonempty fragment, and a nonloopback hostname; missing input returns undefined, refused input warns. Boot precedence is configured origin, permitted development seed, then none plus warning; it performs no registration.

## Deliberate exclusions and evidence

HTTP-kit does not supply user authentication, tenant ownership, durable domain stores, distributed rate-limit atomicity, an HTTP listener, a general outbound policy, automatic provider retries, UI components, theme/accessibility contracts or a complete proxy allowlist. Domain routes belong to daemon/http; CMS settings routes belong to cms/http/settings.

The route-inventory array is shallow-copied; returned entries remain shared. `defineJsonRoute` merges required/optional settings into a new object. `normalizeLocalAuthority` rejects path, userinfo, query, fragment, backslash, comma and whitespace delimiters before parsing.

Evidence: current adapter, request/response, security middleware, rate limiter, SSE and verified-origin source; inspection only.

Decision rationale: [Reject ambiguous redirect URLs before normalization](../decisions/DR-001-redirect-normalization.md), [Background error reporting must contain its own storage failures](../decisions/DR-002-background-failure-containment.md).
