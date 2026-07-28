/**
 * @module @injini/core/internal
 *
 * Package-internal entry point — NOT part of `@injini/core`'s public
 * contract. Two unrelated escape hatches live here, each for its own
 * single intended consumer:
 *
 * - {@link getToolRegistration} so `@injini/daemon`'s `ToolExecutor` can
 *   resolve a registered tool's full `{descriptor, handler, policy}`
 *   triple. This is the security-sensitive one: it is a runtime *value*
 *   export that returns live handler closures, and it is what the
 *   `ToolExecutor` authorization gate exists to guard.
 * - `AnyPack`/`RequiredTokenIds`/`MissingTokenIds` so `@injini/node-host`'s
 *   `createLocalNodeDaemon` can re-derive `createDaemon`'s exact
 *   compile-time "missing binding" gate on its own wrapper config type,
 *   instead of either duplicating the type-level logic or losing the
 *   compile-time check through the wrapper. These are `import type`-only —
 *   erased at build time, carry no runtime capability, and are not a
 *   security boundary the way {@link getToolRegistration} is.
 *
 * **Correction (2026-07-19 hardening pass):** a package.json `exports` map
 * subpath is NOT a language-level or per-consumer access modifier — Node's
 * module resolution will happily resolve `@injini/core/internal` for *any*
 * package that depends on `@injini/core`, not just the intended consumer.
 * Earlier revisions of this doc comment claimed this boundary was
 * "enforced" by the exports map; that was inaccurate and left the leak
 * undetected. The actual enforcement is `scripts/check-engine-boundaries.ts`'s
 * rule forbidding any *value* import of `getToolRegistration` from
 * `@injini/core/internal` outside `packages/daemon/**` (type-only imports of
 * the DI-token-derivation types remain unrestricted, since they carry no
 * runtime capability). Until that guard is finished and wired into CI, this
 * boundary is documentation-only — treat it as such.
 */
export { getToolRegistration } from './tool-registry.js';
export type { AnyPack, MissingTokenIds, RequiredTokenIds } from './daemon.js';
