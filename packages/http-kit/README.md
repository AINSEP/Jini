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

Regular dependencies are core, platform and protocol. Express is supplied by the host and
referenced only through erased types, so this package declares no Express runtime peer.
There is no daemon, agent-runtime or CMS dependency.

## Surface

- The Express `mountJsonRoute` and its route-spec shapes; the framework-free vocabulary (`Result`, `jsonRoute`, `validationError`, `statusForError`, origin checks, SSE stream) is `@jini-ai/core/contracts/server`.
- Express request parsing, `sendJson` and `sendApiError`.
- Origin and bearer guards, including core's canonical origin validation and Node token comparison.
- Cursor-aware and raw SSE primitives, route registration inventory and `mountPackHttp`.
- `./rate-limit`, `./middleware`, `./observability` and `./range`.

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
package has no CMS dependency. The verified-origin registry (`@jini-ai/core/contracts/server/verified-origin`)
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
`createRequestTrackingMiddleware` over core's
`ObservabilityPort` (`Pick<ObservabilityPort, 'trackRequest'>`). Mount first to include refusals and unmatched
requests; route labels are read at response completion.


## Wiring

`mountJsonRoute({ app, spec, deps })` takes a server-neutral spec (`defineJsonRoute`, from
`@jini-ai/core/contracts/server`) plus the route's own small deps type; host policy arrives as
`spec.ports` (`workspace`, `authenticate`, `authorize`, `onError`, `onReturnedError`). A handler
calls `authorize({ permission, entityType }, { entityId })` at its chosen point; a by-id route
passes `entityId` and the port receives it as its second argument, while an id-free call reaches
the port with the required arguments alone. Example: the CMS redirects specs, mounted by a host
whose `authorize` port hands `entityId` to its RBAC check. `entityType` is optional; when the
handler omits it the port's arguments carry no `entityType` key.

Request context and replies (opt-in per spec; a spec that declares none behaves exactly as before):

- `readHeaders: ['Idempotency-Key']` hands `raw.headers` (lower-cased keys, absent headers left out).
- `requestFacts: true` hands `raw.facts`, resolved per request by the host's injected
  `ports.requestFacts({ req, deps })` (its proxy-trust answer). Mounting such a spec without that
  port throws at mount time.
- `responseHeaders: { 'cache-control': 'no-store' }` is set on every answer of the route, before
  the body cap and workspace gates, so refusals carry it too.
- A handler returns core's `routeReply({ status, body?, headers? })` for 429 + `Retry-After`,
  304 + `ETag`, or a bare 204: headers are set, and with no `body` the answer is `res.status(s).send()`.
- A raw spec's `raw.readBody({ type: 'raw', mediaType, limit })` / `({ type: 'urlencoded', limit })` reads
  the body only when the handler calls it — after its gates — through Express's own `raw` / `urlencoded`
  parser (never inflating), answering `{ ok, value }` or a neutral `refusal` (`too-large` with its limit,
  `media-type`, `unsupported-encoding`, `malformed`, `aborted`, `size-mismatch`, `unreadable`). The host
  registers NO parser ahead of such a mount; one registered ahead still wins (the read reports its body).

Raw routes: `mountRawRoute({ app, spec, deps, adapter })` with a `defineRawRoute` spec serves HTML,
streams, uploads, downloads and redirects that set cookies. It takes the same `ports` and opt-ins
and runs the same gates in the same order as `mountJsonRoute`; `handle({ raw, deps, context,
authorize }, { signal })` returns a web `Response`, written back with every header (each
`Set-Cookie` separately) and its body (streamed, and cancelled when the client leaves). `raw.body`
is whatever the host's per-route parser left (`express.raw` gives a `Buffer`). It mounts with
`app[method](path)`, never `app.use`, so route-table inventories see one route per spec.
A raw spec that sets `bufferedReply: true` is not streamed: its whole body is read and answered through
Express's `res.send(Buffer)`, so it gets `Content-Length`, the host app's ETag (Express's default weak one)
and a bodiless 304 for a fresh GET/HEAD (`If-None-Match` / `If-Modified-Since`), exactly as a hand-written
`res.send` route did (`raw-route-buffered.test.ts` compares both on the wire). Without it nothing changes.

See [API.md](https://github.com/AINSEP/Jini/blob/main/packages/http-kit/API.md) for required/optional object contracts. Node runtime, ESM only.
Apache-2.0; see the repository NOTICE.

`authenticate` may answer `undefined` when the request carries no principal yet; the handler then
gets no `context` and the host's `authorize` port decides. A host uses that to keep a body refusal
from `parse` ahead of its missing-session failure (`adapter-ports.test.ts` pins the order).

## Design decisions

- [Reject ambiguous redirect URLs before normalization](docs/decisions/DR-001-redirect-normalization.md).
- [Background error reporting must contain its own storage failures](docs/decisions/DR-002-background-failure-containment.md).
