/**
 * @module @jini-ai/http-kit
 *
 * JSON-route transport for a `@jini-ai/core` daemon composition: the `Result`/route-spec types,
 * request parsing, response serialization, the same-origin guard, the Express-mounting Adapter,
 * error metadata helpers and a route-pack registrar. Domain route packs are owned by
 * their capabilities and exposed through their HTTP entries.
 *
 * This package supported a switchable `express`/`fastify` HTTP transport from 2026-07-19 through
 * 2026-07-22; it was removed since nothing ever consumed `transport: 'fastify'` in practice, and
 * the maintained-but-unused Fastify subtree cost a recurring "does this new route pack also need a
 * Fastify mounting sibling" tax on every future addition to this package. The removed
 * implementation is preserved, unchanged, on the `future/fastify-transport` branch — see
 * `FASTIFY-TRANSPORT-PARKED.md` at the repo root of that branch for the full reasoning and how to
 * revive it. See `archived provenance ledger` for this package's full provenance and scope-decision notes.

 * Archived provenance rationale:
 * ## Design decisions
 *
 * **1. `compat.ts` was ported despite having no current Jini call site.** OD's
 * `compat/api-errors.ts` exists only because `server.ts`'s routes — written
 * before `JsonRouteSpec` existed — call error helpers with a different argument
 * shape than the rest of the module; Jini's `@jini/http` has no such legacy
 * call sites of its own. It was kept anyway for two reasons: (a) the task brief
 * explicitly named `api-errors.ts` in its file list, and (b) extraction-plan.md
 * §4's OD-sync mechanism (hollow re-exports + patch canary) depends on Jini's
 * port carrying the *same public surface* as the OD module it patch-routes
 * against — dropping an exported symbol here would be exactly the kind of
 * silent divergence that mechanism exists to catch. A future host application
 * with its own legacy hand-mounted routes (mirroring OD's `server.ts`) is the
 * plausible real consumer; until then it is inert, imported-but-unused code,
 * which is an acceptable cost for sync fidelity in a package whose whole
 * purpose is to be a faithful patch target.
 *
 * **2. `mountPackHttp` (route-pack registrar) is new, not a lift.** OD's
 * `http/` module has no concept of "packs" — it predates `@jini/core`'s typed
 * DI-token composition contract entirely; `server.ts` mounts every route by
 * hand. Per extraction-plan.md §3's description of `@jini/http` as containing
 * a "route-pack registrar," and per the task brief's explicit instruction to
 * check `packages/core/src/pack.ts` and compose with it rather than inventing a
 * separate pattern, `mountPackHttp(app, packs, daemon)` was built fresh: it
 * iterates the same `packs` array passed to `createDaemon` and calls each
 * pack's optional `Pack.http(app, services)` registrar (declared in
 * `@jini/core`'s `pack.ts` with `app` deliberately typed `unknown` so the
 * kernel never depends on Express) with the *same* Express `app` and the
 * *same* composed `services` object `@jini/cli`'s eventual CLI registrar would
 * receive via `Pack.cli` — satisfying extraction-plan.md §2.3's "both
 * transports call one shared app-service" invariant. Packs with no `http`
 * registrar are silently skipped (a CLI-only or headless pack is not an error).
 *
 * **3. `ExecutionDelegate` injection is explicitly out of scope, not
 * overlooked.** Extraction-plan.md §3 describes `@jini/http` as also
 * "injects `ExecutionDelegate`" (§2.5's tool-execution-boundary confirm/authorize
 * callback pair, transport-specific by design). `ToolExecutor` now exists in
 * `@jini/daemon`, but the external CLI stream currently reports a tool use after
 * the CLI has executed it; it is not a pre-execution request/response protocol.
 * This transport therefore does not pretend to inject a post-hoc callback as an
 * authorization gate. A controlled agent protocol is a real, named follow-up.
 *
 * **4. `ERROR_STATUS_BY_CODE` was re-scoped to `@jini/protocol`'s codes, not
 * copied 1:1.** See the `src/response.ts` file-map row above for the exact
 * additions/removals. This keeps the status-mapping table honest about which
 * codes are actually reachable through `@jini/protocol`'s `ApiErrorCode` type
 * (an open string type — a pack's own codes still type-check and simply fall
 * back to the conservative 500 default, same as OD's unmapped-code behavior).
 *
 * ### Design decision: deliberately duplicated, not a shared interface — with one exception
 *
 * `express/` and `fastify/`'s nine matching files (`adapter`, `api-security-middleware`, `compat`,
 * `daemon-status`, `index`, `local-daemon-request`, `origin`, `request`, `response`,
 * `route-registration-guard`) are **independent implementations of the same job, not two adapters
 * behind one shared interface.** This was a deliberate choice, not an oversight: Express's
 * middleware-chain model (`(req, res, next) => void`, `res.json(...)`, `app.use(...)`) and Fastify's
 * hook/plugin model (`onRequest`/`onRoute` hooks, `reply.send(...)`, schema-validated route options)
 * are different enough in shape that forcing them behind one abstraction would either leak one
 * framework's idioms into the other's native surface, or flatten both down to a lowest-common-
 * denominator API that fights each framework's own strengths (Fastify's schema-based validation and
 * radix-tree routing, in particular, are not expressible through an Express-shaped adapter without
 * losing most of their value). Each subtree is written the way an engineer fluent in that framework
 * would write it, and each is independently tested to 100% coverage.
 *
 * **The one exception: `fastify/daemon-status.ts` reuses `express/daemon-status.ts`'s route-spec
 * data directly** — `daemonStatusRoute`/`daemonShutdownRoute` are pure `defineJsonRoute`-shaped
 * data plus framework-agnostic `parse`/`handle` functions (see that file's own doc). They never
 * reference Express at runtime: `express/daemon-status.ts` only imports `type { Express }` for one
 * parameter type, and TypeScript's `verbatimModuleSyntax` erases type-only imports from the compiled
 * output entirely — verified there is zero runtime `express` dependency pulled into the `fastify/`
 * subtree by this reuse. `fastify/daemon-status.ts`'s own job is only the Fastify-specific mounting
 * wrapper (`registerDaemonStatusRoutes`, calling `./adapter.js`'s Fastify `mountJsonRoute`). This is
 * the single case where sharing was correct instead of duplication: the route *data* (path, method,
 * input parser, pure handler) has no framework opinion in it at all — only the *mounting glue* does,
 * and that glue is what actually differs and stays independent per subtree.
 *
 * ### Merge note (2026-07-22, later the same day): four more audit-fix sections below merged in from a second, parallel cloud session
 *
 * The sections immediately below (`delegated-tools.ts` barrel export, `media.ts`, and the
 * `runs.ts`/`terminals.ts` coverage pass) were written on a branch (`fix/audit-6-fixes-20260722`) that
 * forked from `main` *before* the Fastify-transport-split merge above landed, so they were authored
 * against the pre-split flat-file layout. They merged in cleanly with no logical conflict — the
 * route-pack files they touch (`delegated-tools.ts`, `runs.ts`, `terminals.ts`) are exactly the ones
 * this merge's "Corrected layout" section above kept flat at the package root, not moved into
 * `express/`, so every path/import reference below is still accurate post-merge. `media.ts` (new in
 * that branch) is likewise flat at the root and barrel-exported the same way. None of these four
 * sections needed any correction for the Fastify split; see `server/archived provenance ledger`'s own merge note
 * for the one piece that did (the six route packs `media.ts` joins are wired Express-only for now,
 * deliberately, per this repo's owner's explicit instruction to table Fastify parity for the newly
 * merged route packs — tracked as follow-up work, not silently dropped).
 *
 * ### Design decisions
 *
 * **`StoredAttachment` mirrors `@jini-ai/chat-core`'s `ChatAttachment` instead of importing it.** Same
 * reasoning as `media.ts` declaring its own `MediaTask`/`MediaDispatchEngine` rather than depending on
 * `@jini-ai/media`: a `jini.domain: "server"` transport package should not acquire a dependency on a
 * *domain* package (`chat`) to describe an upload that is not chat-specific. There is no cycle — the edge
 * would be legal — it is simply the wrong direction, and it would be the first `server` → `chat` package
 * edge in the graph. The drift risk that makes a mirror tempting to avoid is paid for with a test instead
 * of a dependency: `attachments.test.ts` holds a compile-time assignability assertion in **both**
 * directions against the real `ChatAttachment` (`@jini-ai/chat-core` is a **devDependency** only, so
 * nothing is added to the published dependency graph). A field added, removed, renamed, or retyped on
 * either side fails the build.
 *
 * **Hand-mounted, not `defineJsonRoute`/`mountJsonRoute`.** Two hard reasons: the upload reads the raw
 * request stream, so a JSON-parsed `req.body` is precisely what must *not* have happened; and the cleanup
 * answers `204` with no body, which a JSON responder cannot express. `requireSameOrigin` is therefore a
 * dep flag (defaulting to `true`) rather than a spec field, evaluated through the same `guardSameOrigin`.
 *
 * **Run-lifecycle wiring stays host-owned**, following `@jini-ai/daemon`'s `createRunScopedContextStore`
 * precedent exactly: there is no generic post-run-start hook to auto-wire into, and inventing one for this
 * would be a larger and worse change than documenting ten lines. The module doc carries the pattern
 * (claim in `onRunStarted`, thread into `AgentExecutor.run()`'s pre-existing
 * `imagePaths`/`extraAllowedDirs`/`uploadRoot`, `cleanupRun` in a `finally`). `daemon.ts` in the example is
 * the live reference.
 *
 * **Typed rejections replaced substring matching.** The example's route decided status codes with
 * `message.includes('20 MB') || message.includes('limited to') || ...` across a module boundary. Since one
 * package now owns both the store and the routes, `AttachmentRejectedError.reason` maps to a status in one
 * table. The externally-visible status mapping is unchanged (quota → 413, bad batch → 400, integrity →
 * redacted 500); it is just no longer coupled to message wording. Reasons that describe a broken or
 * hostile server-side state never expose their real message over HTTP, but exist so a host catching a
 * rejection from `claim()` outside HTTP can still classify it.
 */
export type {
  Handler,
  HttpMethod,
  InputParser,
  JsonRouteSpec,
  Result,
  RouteInputContext,
} from './types.js';
export { err, ok } from './types.js';
export type {
  ParsedHostHeader,
  RequestWithOriginHeaders,
} from '@jini-ai/core';
export {
  allowedBrowserPorts,
  assertValidAllowedOrigins,
  configuredAllowedHosts,
  configuredAllowedOrigins,
  isAllowedBrowserHost,
  isAllowedBrowserOrigin,
  isIpLiteralHostname,
  isLoopbackOrPrivateLanHost,
  isLocalSameOrigin,
  isPrivateIpv4,
  parseHostHeader,
} from '@jini-ai/core';
export type { AdapterContext } from './adapter.js';
export { ClientFacingError, defineJsonRoute, mountJsonRoute } from './adapter.js';
export type { InstallRouteRegistrationGuardOptions, RouteRegistration } from './route-registration-guard.js';
export {
  getRouteRegistrationInventory,
  guardedRouteKey,
  installRouteRegistrationGuard,
} from './route-registration-guard.js';
export type { CreateSseChannelOptions, SseChannel, SseEvent } from './sse.js';
export { createSseChannel, DEFAULT_MAX_QUEUED_SSE_EVENTS, requestedAfterCursor, sendRawApiError } from './sse.js';
export type { CreateSseResponseOptions, SseConnection } from './raw-sse.js';
export { createSseResponse } from './raw-sse.js';
export { mountPackHttp } from './pack-http.js';
export type {
  ApiBearerAuthMiddlewareDeps,
  ApiOriginGuardMiddlewareDeps,
  StrictBearerTokenDeps,
} from './api-security-middleware.js';
export {
  bearerTokenFromHeader,
  registerApiBearerAuthMiddleware,
  registerApiOriginGuardMiddleware,
  requireStrictBearerToken,
  timingSafeTokenMatch,
} from './api-security-middleware.js';
export { isLoopbackHostname } from '@jini-ai/platform/net';
export {
  isLoopbackPeerAddress,
  localOriginFromHeader,
  normalizeLocalAuthority,
  requireLocalDaemonRequest,
  validateLocalDaemonRequest,
} from './local-daemon-request.js';
export {
  createCompatApiError,
  createCompatApiErrorResponse,
} from './compat.js';
export * from './rate-limit.js';
export * from './middleware.js';
export * from './verified-origin.js';
export * from './observability.js';

// Generic request/response and origin primitives used by capability-owned route packs.
export * from './request.js';
export * from './response.js';
export * from './origin.js';
