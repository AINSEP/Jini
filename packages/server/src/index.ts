/**
 * @module @jini-ai/server
 *
 * The Node.js host preset (extraction-plan.md §2.4): `createLocalNodeDaemon`, the piece that
 * assembles `@jini-ai/core`/`@jini-ai/daemon`/concern-owned storage adapters/`@jini-ai/http-kit` into an actually-runnable
 * daemon process, plus the generic host-lifecycle primitives it's built on. See `archived provenance ledger`
 * for full provenance and scope-decision notes.

 * Archived provenance rationale:
 * ## Design decisions
 *
 * **1. Two function overloads instead of one generic signature with a defaulted `BoundIds`.** The
 * task brief's literal shown signature was
 * `createLocalNodeDaemon<const Packs, BoundIds extends string = KernelBoundIds>(config: ...)`.
 * Empirically verified against this repo's TypeScript (5.9.3, `strict`) that this shape does not
 * actually preserve `createDaemon`'s compile-time "missing binding" gate: when a type parameter both
 * has a default *and* is referenced inside a conditional type in the same position where it also
 * needs inference from a nested callback's return type, TypeScript resolves it to the default
 * instead of inferring from the callback — silently defeating the gate on exactly the call shape
 * (`bindings` customizer provided) where it matters most. Fixed by splitting into two overloads — one
 * where `bindings` is absent and `BoundIds` is the concrete `KernelBoundIds`, one where `bindings` is
 * required and `BoundIds` is inferred fresh with no default — which sidesteps the inference conflict
 * entirely. Both directions (and an under-binding customizer, and a satisfied customizer) are proven
 * in `create-local-node-daemon.typecheck.ts`. Documented in full inline on the exported function.
 *
 * **2. `resolveBoundPort`/`resolveReportHost` extracted as small pure, exported helpers.** The
 * origin's `.listen()` tail inlined both the "is `server.address()` actually usable" check and the
 * "substitute 127.0.0.1 for an all-interfaces bind host" substitution directly in the `'listening'`
 * callback. Pulling them out makes two genuinely-defensive branches (a `server.address()` that is
 * `null`/a Unix-socket-path string/a non-positive port — provably unreachable via any real TCP
 * listener once `'listening'` has fired, per the origin's own "belt-and-braces" framing) directly
 * unit-testable without mocking Express or the underlying socket at all.
 *
 * **3. `@jini/core/internal`'s `AnyPack`/`RequiredTokenIds`/`MissingTokenIds` re-export.** Needed so
 * this package could re-derive `createDaemon`'s exact compile-time gate rather than duplicate the
 * type-level logic. See `packages/core/src/internal.ts`'s own module doc and
 * `packages/core/src/daemon.ts` — these three types are now `export`ed there (previously
 * module-private) but deliberately *not* re-exported from `@jini/core`'s public `index.ts` (which
 * switched from a `daemon.js` wildcard re-export to an explicit named list for exactly this reason).
 *
 * **4. `createDaemon`'s own compile-time gate is bypassed (via a cast) inside
 * `createLocalNodeDaemon`'s implementation body**, the same way
 * `packages/core/src/__tests__/index.test.ts`'s `createDaemonUnsafe` reaches `createDaemon`'s runtime
 * path directly: `Packs`/`BoundIds` are still abstract, unresolved type parameters inside a generic
 * function body, so `createDaemon`'s own conditional gate can never collapse to a definite branch
 * there regardless of which overload the real call site matched. Safety was already established by
 * this function's own equivalent gate (present on both exported overloads) at the real call site.
 *
 * **5. `stop()` always closes the durable `EventLog`, even when the caller's `onShutdown` hook
 * rejects** — `try { await config.onShutdown?.() } finally { await eventLog.close() }` — so a
 * caller-supplied hook failing can never leak an open sqlite file handle; the original rejection
 * still propagates to whoever awaited `stop()`.
 *
 * **6. `env[JINI_BIND_HOST]` is set before serving any request — a documented, only-partially-fixable
 * wrinkle.** `@jini/http`'s own `guardSameOrigin` (used by `registerDaemonStatusRoutes`' shutdown
 * route) resolves `bindHost` purely from real `process.env.JINI_BIND_HOST`, with **no parameter path**
 * of its own — unlike most of that module's other functions, it never accepts an injected `env`.
 * `createLocalNodeDaemon` sets `env[JINI_BIND_HOST] = host` (where `env` is `config.env ??
 * process.env`) before returning, which correctly fixes the common case (no `env` override — the
 * default, real `process.env` gets the right value). When a caller *does* inject a distinct `env`
 * object for full test isolation, this line cannot make `guardSameOrigin`'s hardwired real-`process.env`
 * read reflect it — a pre-existing `@jini/http` limitation this call cannot reach around without
 * editing `origin.ts` itself (out of scope here, same reasoning as the origin-validation duplication
 * flagged in `packages/http/archived provenance ledger`).
 *
 * ## 2026-07-29 — post-merge audit fixes (six teardown/config/URL defects)
 *
 * Independent review of the `feat/agentic-capability-layer` merge (OpenAI Codex `gpt-5.6-sol` as peer
 * reviewer, then re-verified against source here) surfaced six real defects in this package. Each was
 * reproduced with a failing test before any fix landed.
 *
 * **1. Caller packs were never disposed.** `composeJiniKernel` calls `createDaemon` on `config.packs`,
 * so it — not the caller — builds their services; but neither the failure-cleanup path nor `close()`
 * ever ran their `dispose`. A caller pack whose `services()` opened a socket, timer or database handle
 * leaked it past `createLocalNodeDaemon().stop()`, and the wrapper exposes no caller daemon for the
 * host to tear down itself. Added `JiniKernel.disposeCallerPacks()` — memoized, best-effort, symmetric
 * with `disposeFeatures()` — called by `close()`, by the composition-failure `catch`, and by the
 * daemon's `stop()`. Disposal order is reverse of construction: features first (they were composed
 * against an already-built caller daemon), caller packs second.
 *
 * **2. `journal.db` opened outside the cleanup block.** `createJiniKernelBase` opened `events.db`, then
 * `journal.db`, and only *then* entered the `try` whose `catch` closed them. `journal.db` failing (a
 * corrupt file, or a directory sitting where a database was expected) left the `events.db` handle open
 * in a process that has no kernel. Every acquisition now happens inside the one block, tracked in an
 * `opened` array the cleanup drains — the shape the module's own comment already claimed.
 *
 * **3. Capability keys were not runtime-validated.** Feature ids in `config.features` threw on a typo;
 * capability ids in `config.capabilities` did not. `{'host:exce': false}` deleted a grant nobody held,
 * so `host:exec` survived and `terminal`/`hostTools` stayed mounted — a security switch that fails
 * *open* on a typo, in the direction that reads as applied. `feature.ts` now carries the runtime half
 * of `CapabilityId` as a `Record<CapabilityId, true>` (drift is a compile error in both directions, so
 * the list cannot silently fall behind the union it validates) plus `CAPABILITY_IDS`/`isCapabilityId`;
 * `resolveFeatureActivation` validates the keys next to where it validates feature ids.
 *
 * **4. An injected `config.env` never reached the per-route same-origin guard.** `env[JINI_BIND_HOST] =
 * host` writes into the caller's object when one is supplied, and `@jini-ai/http-kit`'s `guardSameOrigin`
 * read real `process.env`. The origin-guard *middleware* was already handed the injected `env`, so the
 * two halves of one decision read two different environments: the middleware admitted an origin the
 * host configured through `config.env` and the route then rejected it. Fixed at the seam —
 * `OriginContext` (and so `AdapterContext`) grew an optional `env`, defaulting to `process.env`, and
 * this preset sets it. That covers `JINI_BIND_HOST`, `JINI_ALLOWED_ORIGINS` and `JINI_WEB_PORT` alike.
 *
 * **5. Shutdown could skip its own teardown, or crash the process.** `closeHttpServer` rejecting (which
 * its own contract documents) skipped feature disposal, discovery-record removal, `onShutdown` and the
 * sqlite close — leaving a half-torn-down daemon, strictly worse than the failure that caused it. It is
 * a `try`/`finally` now; the original rejection still propagates once teardown finishes. Separately,
 * `requestShutdown` dropped `stop()`'s promise with a bare `void`, so a failing shutdown became an
 * unhandled rejection — which on Node's default policy terminates the process this was gracefully
 * shutting down. It is reported through `console.error` now; the rejection stays on `stopPromise` so an
 * explicit `stop()` caller still observes it.
 *
 * **6. `resolveReportHost` produced an unparseable URL for an IPv6 bind host.** `'::1'` passed through
 * unchanged, so the reported base URL was `http://::1:54321` — which `new URL()` and `fetch` both
 * reject, and which was written verbatim into the discovery record. It now returns the bracketed
 * authority form (RFC 3986 §3.2.2), idempotently.
 *
 * Two lower-severity items from the same review, also fixed:
 *
 * - **`agents`' scan cache was not keyed by promise identity.** A slow scan that failed *after* `POST
 *   /api/agents/rescan` had already replaced it with a successful one cleared the newer entry, forcing
 *   a duplicate probe of every agent CLI on the machine. The `catch` now clears only its own entry.
 * - **`createFrontendControl`'s bind boundary did not cover `resolveBindToken` or its own error sink.**
 *   A `RunStartHandler` throwing is not a no-op — `@jini-ai/http-kit`'s run-start route marks the run
 *   `failed` and answers 500 — so a host-supplied `resolveBindToken` throwing (it parses an opaque host
 *   blob) produced exactly the killed run the `onBindError` doc promises never to cause. Both are inside
 *   the boundary now; a throwing sink is swallowed, because the reporting channel is what failed.
 *
 * **One pre-existing gap closed while here.** The package's committed 100% function-coverage gate was
 * already failing on `main` (99.09%): `sidecar-strict`'s origin-guard `getResolvedPort` closure had no
 * end-to-end coverage, because both of that mode's gates are request-time middleware. Added six real
 * `security: sidecar-strict` tests (unauthenticated 401, authenticated 201, cross-origin 403 with a
 * valid token, unset-token 503, probe routes reachable tokenless, `exemptPaths`) — the one block in
 * `compose-jini-kernel.test.ts` that opens a socket, and only because it has to.
 *
 * **Verified, personally, this session**: `packages/server` **231/231 passing** across 8 files (was
 * 215 before the sidecar-strict block), **100/100/100/100 coverage**; `packages/http-kit` 1245/1245 and
 * 100% ; `packages/chat-core` 261/261; `packages/chat-react` 610/610 and 100%;
 * `examples/reference-web` 41/41. Repo-wide `pnpm typecheck` and `pnpm guard` clean.
 */
export type {
  CreateLocalNodeDaemonConfig,
  KernelBoundIds,
  LocalNodeDaemon,
  LocalNodeHttpExtension,
  LocalNodeHttpExtensionContext,
} from './create-local-node-daemon.js';
export {
  buildDaemonDbOperations,
  classifyRunFailureForRetry,
  createLocalNodeDaemon,
  projectDetectedAgent,
  resolveBoundPort,
  resolveReportHost,
} from './create-local-node-daemon.js';

// The composition core `createLocalNodeDaemon` is itself a caller of. An embedded host mounts onto
// its own Express app with this and never opens a second listener.
export type { ComposeJiniKernelConfig, JiniKernel, JiniKernelSecurity } from './compose-jini-kernel.js';
export { composeJiniKernel, defaultServerMessages } from './compose-jini-kernel.js';

export type {
  AnyPack,
  CapabilityId,
  FeatureBuildContext,
  FeatureComposition,
  FeaturePhase,
  JiniFeature,
  JiniProfile,
  JiniProfileId,
  ProfileActivation,
} from './feature.js';
export { CAPABILITY_IDS, CORE_CAPABILITIES, defineJiniFeature, isCapabilityId, JINI_PROFILES } from './feature.js';

export type {
  ActivationReason,
  ActiveFeatureRecord,
  DeactivationReason,
  FeatureActivationInput,
  FeatureActivationPlan,
  InactiveFeatureRecord,
} from './feature-activation.js';
export { resolveFeatureActivation } from './feature-activation.js';

export type { BuiltInFeatureOptions } from './builtin-features.js';
export {
  ANONYMOUS_DELEGATED_PRINCIPAL,
  createBuiltInFeatures,
  LOCAL_DAEMON_PRINCIPAL,
} from './builtin-features.js';

export type {
  CreateJiniKernelBaseOptions,
  JiniKernelBase,
  JiniKernelStorage,
  KernelSqliteAccess,
} from './kernel-base.js';
export { createJiniKernelBase } from './kernel-base.js';

// Frontend control belongs to the daemon HTTP surface: hosts that build their own Express app
// can compose it without the server kernel. This server entry keeps its existing public export.
export { createFrontendControl } from '@jini-ai/daemon/http';
export type { CreateFrontendControlOptions, FrontendBindErrorContext, FrontendControl, FrontendHttpExtension } from '@jini-ai/daemon/http';

export type { CloseHttpServerOptions, GracefulShutdownHandle, GracefulShutdownOptions } from './host-bootstrap.js';
export {
  DEFAULT_DAEMON_BIND_HOST,
  closeHttpServer,
  installGracefulShutdown,
  normalizeDaemonBindHost,
} from './host-bootstrap.js';
