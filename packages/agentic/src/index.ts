/**
 * Compatibility root — re-exports `./core` unchanged so existing `from '@jini-ai/agentic'`
 * imports keep resolving. New code should prefer the explicit `@jini-ai/agentic/core` import;
 * see `core/README.md` for why this package is split the way it is.

 * Archived provenance rationale:
 * ## The DOM split (why this package has two entry points)
 *
 * Everything under `src/` except `src/dom/` compiles under `tsconfig.json`, which extends the repo's
 * `tsconfig.base.json` unmodified (`lib: ["ES2023"]`, no `DOM`) and **excludes `src/dom` entirely**.
 * `src/dom/` compiles separately under `tsconfig.dom.json`, the only config in this package with
 * `DOM`/`DOM.Iterable` in `lib`.
 *
 * This is a compile-time guarantee, not a convention: a `document`/`window` reference anywhere
 * outside `src/dom/**` fails `tsc -p tsconfig.json` with "Cannot find name 'document'" (verified
 * during the 2026-07-26 extraction — see the extraction's report for the exact command and error
 * text). That is what proves the policy layer (`page-executor.ts`'s guards, refusals, and
 * allowlist-enforcement) cannot quietly reach into a live page; only `src/dom/dom-page-driver.ts`,
 * the one `PageDriver` implementation that legitimately needs a DOM, may.
 *
 * Two `package.json` exports follow the same split:
 *
 * - `.` (`dist/index.d.ts`/`dist/index.js`, built by `tsconfig.json`) — the DOM-free vocabulary,
 *   policy gate, and protocol projections. What `@jini/chat-core`, `@jini/daemon` (structurally, see
 *   below), and (once §5 of the plan lands) `@jini/ui` depend on.
 * - `./dom` (`dist/dom/index.d.ts`/`dist/dom/index.js`, built by `tsconfig.dom.json`) — the browser
 *   `PageDriver`. What `@jini/chat-react` depends on.
 *
 * `scripts/check-engine-boundaries.ts` R2 normally allows only bare `@jini/<name>` imports (one
 * entry point per package), with a single named exception for `@jini/core/internal`. This extraction
 * added a second, identically-gated exception for the exact literal `@jini/agentic/dom` — not a
 * pattern — because `@jini/chat-react` genuinely needs the DOM half and there is no third package for
 * it to live in without recreating the sprawl this plan exists to reduce (23 packages vs. a locked
 * 14). See that script's own module doc for the up-to-date rule list.
 */
export * from './core/index.js';
