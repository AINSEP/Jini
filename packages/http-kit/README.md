# @jini-ai/http-kit

Framework-level HTTP transport, guards and route-pack registration, with no domain.
Request parsing, response serialization, same-origin validation, SSE and Express mounting
are reusable primitives. The host mounts them onto its own app; the package opens no listener.
Daemon routes and their manifest now live in `@jini-ai/daemon/http`, and tool attenuation
lives in `@jini-ai/daemon/read-only-tools`. CMS settings live in `@jini-ai/cms/http/settings`.

## Install

```sh
npm install @jini-ai/http-kit express
```

Regular dependencies are core, platform, protocol and Express. There is no daemon,
agent-runtime or CMS dependency.

## Surface

- Route specs, `ok({ value })`, `err({ error })`, `defineJsonRoute` and `mountJsonRoute`.
- Request parsing, `validationError`, `sendJson`, `sendApiError` and `statusForError`.
- Origin and bearer guards, including core's canonical origin validation and Node token comparison.
- Cursor-aware and raw SSE primitives, route registration inventory and `mountPackHttp`.
- `./rate-limit`, `./middleware`, `./verified-origin` and `./observability`.

- `rate-limit` exports `createRateLimiter({ profile, clock, store })`,
  `createMemoryCounterStore({})`, and `resolveClientIp({ source, policy })`.
  Await `limiter.check({ key })` and `limiter.size({})`. Each limiter owns a
  dedicated async counter store and serializes its checks across storage awaits.
  Window/max/burst values and proxy trust policy are supplied by the host.
- `middleware` exports `rejectOversizedJsonBody({ maxBytes, errorResponseFactory })`.
  Mount it after JSON parsing. The response factory receives `{ maxBytes, bodyBytes }`
  and returns the host's error envelope; oversized bodies receive status 413.
  The host parser still owns the limit on memory allocated while parsing.

## Replaceable seams

`JsonRouteSpec.parse` and `handle` let hosts supply custom request handling. Pack services
are resolved by core before the HTTP registrar sees them. Duplicate-route detection catches
collisions during mounting, rather than letting the first registration silently win.
The Result/ApiError pipeline folds anticipated errors into one response path; unexpected
exceptions remain redacted with host-owned diagnostic reporting.

Define packs with `definePack({ name, deps, services }, { http })` from core;
the HTTP registrar belongs in the optional second argument. Mount the composed
packs with `mountPackHttp({ app, packs, daemon })`.

Express mounting is fixed. A switchable Fastify transport was removed on 2026-07-22 because
no consumer used it and maintaining every route twice imposed recurring work. Its implementation
and rationale remain on `future/fastify-transport` in `FASTIFY-TRANSPORT-PARKED.md`.

Settings routes and their CMS adapters now live at `@jini-ai/cms/http/settings`; this
package has no CMS dependency. `./verified-origin`
is a separate canonical-origin registry with required configuration evidence and
repository ports; it does not infer trust from request headers. Its canonical-origin
request type is `VerifiedOriginRequestContext`.

Origin guards require `env`, `allowedOriginsEnvVar`, `webPortEnvVar` and `bindHostEnvVar`
in the required context/dependencies. The host selects these names; the guards never
read ambient environment state. Core owns the validation functions and requires
`{ config, env }` for configured-origin parsing. Parsing stays lenient per request;
`assertValidAllowedOrigins({ config, env })` is strict at boot.
Bearer gates require their environment and token variable names in argument one;
`trustLoopbackPeers` and strict `exemptPaths` remain argument-two options.
`timingSafeTokenMatch` binds core's injected comparison port to `node:crypto`.
The async limiter uses core `Clock.nowMs()` and keeps non-empty-key validation.

`./observability` supplies `applyRequestTracking` and
`createRequestTrackingMiddleware` over the diagnostics-compatible
`HttpRequestObservabilityPort`. Mount first to include refusals and unmatched
requests; route labels are read at response completion.


See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/http-kit/API.md) for required/optional object contracts. Node runtime, ESM only.
Apache-2.0; see the repository NOTICE.

## Design decisions

- [Reject ambiguous redirect URLs before normalization](docs/decisions/DR-001-redirect-normalization.md).
- [Background error reporting must contain its own storage failures](docs/decisions/DR-002-background-failure-containment.md).
