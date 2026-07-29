/**
 * @module @jini-ai/core/internal
 *
 * Package-internal entry point — NOT part of `@jini-ai/core`'s public
 * contract. Two unrelated escape hatches live here, each for its own
 * single intended consumer:
 *
 * - {@link authorizeToolInvocation} so `@jini-ai/daemon`'s `ToolExecutor` can
 *   resolve a registered tool and run its authorization gate — the tool's
 *   own `ToolPolicy`, then an optional transport-level veto — before ever
 *   receiving the handler. This is the security-sensitive one: it is a
 *   runtime *value* export, but unlike the `getToolRegistration` it
 *   replaced (2026-07-29 hardening pass), it only ever returns a handler
 *   closure alongside a `decision: 'allow'` — a denied or unauthorized call
 *   gets no handler at all, so the authorization gate cannot be bypassed by
 *   calling this export directly instead of going through `ToolExecutor`.
 * - `AnyPack`/`RequiredTokenIds`/`MissingTokenIds` so `@jini-ai/server`'s
 *   `createLocalNodeDaemon` can re-derive `createDaemon`'s exact
 *   compile-time "missing binding" gate on its own wrapper config type,
 *   instead of either duplicating the type-level logic or losing the
 *   compile-time check through the wrapper. These are `import type`-only —
 *   erased at build time, carry no runtime capability, and are not a
 *   security boundary the way {@link authorizeToolInvocation} is.
 *
 * **Correction (2026-07-19 hardening pass):** a package.json `exports` map
 * subpath is NOT a language-level or per-consumer access modifier — Node's
 * module resolution will happily resolve `@jini-ai/core/internal` for *any*
 * package that depends on `@jini-ai/core`, not just the intended consumer.
 * Earlier revisions of this doc comment claimed this boundary was
 * "enforced" by the exports map; that was inaccurate and left the leak
 * undetected. The actual enforcement is `scripts/check-engine-boundaries.ts`'s
 * rule forbidding any *value* import from `@jini-ai/core/internal` outside
 * `packages/daemon/**` (type-only imports of the DI-token-derivation types
 * remain unrestricted, since they carry no runtime capability) — that guard
 * is wired in, but is a second, independent layer on top of the 2026-07-29
 * structural fix above, not a substitute for it.
 */
export { authorizeToolInvocation } from './tool-registry.js';
export type { ToolAuthorizationDelegate, ToolInvocationAuthorization } from './tool-registry.js';
export type { AnyPack, MissingTokenIds, RequiredTokenIds } from './daemon.js';
