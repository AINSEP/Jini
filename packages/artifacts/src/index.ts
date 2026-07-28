/**
 * @module artifacts
 *
 * The generic artifact store, originally ported from OD's
 * `apps/daemon/src/artifacts/` (6 files) into `@injini/daemon`'s kernel token set, then moved
 * into this standalone (unlocked/incubating — see `UNLOCKED.md`) package on 2026-07-19 to fix
 * a kernel-noun-set violation `tokens.ts`'s doc comment explains. See `source-map.md` for the
 * original per-file OD provenance and the design decisions behind each generalization.
 */
export * from './manifest.js';
export * from './store.js';
export * from './publication-guard.js';
export * from './runtime-compat.js';
export * from './stub-guard.js';
export * from './text-suppression.js';
export * from './tokens.js';
