/**
 * @file `@jini-ai/cms/core` — the framework-free half of the CMS capability.
 *
 * PLACEHOLDER. Nothing has been ported yet; this file exists so the package builds, typechecks,
 * and has a green suite before the first real module lands.
 *
 * ## What belongs here
 *
 * Everything that must run in any JavaScript runtime: content contracts and types, ports
 * (interfaces describing persistence/search/blob dependencies), pure domain services, and the
 * kernel registries. No Express, no `node:*`, no DOM, no concrete adapters.
 *
 * ## What belongs in `../server`
 *
 * Only the Node-bound half: concrete repository implementations (SQLite/Postgres), filesystem blob
 * stores, and anything importing `node:*`. See that file's header.
 *
 * ## Why the split is drawn here, and why it is enforced by `exports` rather than convention
 *
 * This mirrors a defect measured in the CMS runtime this is ported from. There, the content model
 * and its HTTP composition root lived in one `src/` tree with no enforced boundary, and 53 import
 * edges ended up pointing *into* the composition root — including 22 domain modules importing a
 * 454-line route-deps type whose first line was `import type { Express } from "express"`. The
 * consequence, visible in git history, was that no content module could be changed without also
 * changing the server: its theme module and its server co-changed in 71% of commits touching the
 * former.
 *
 * The originating repo's analysis is at
 * `ADS-memory/reports/refactors/2026-08-02-module-graph-analysis.md`. The conclusion that matters
 * for this package: the decomposition was sound, but nothing *enforced* it, so a transport type
 * leaked into every domain module and welded 33 of 38 modules into a single inseparable component.
 *
 * A package's `exports` map is exactly the enforcement a single `src/` tree cannot provide. Porting
 * into `/core` + `/server` from the start means that failure cannot recur here: a consumer of
 * `@jini-ai/cms/core` physically cannot reach a Node adapter, and `/core` physically cannot import
 * a transport type, because the module resolver refuses it. Keep it that way — if a port makes a
 * core module want something from `/server`, the dependency is pointing the wrong way and the fix
 * is a port (interface) in core, not a widened export.
 *
 * ## Port inventory (not yet moved)
 *
 * Kernel first — the source repo's `src/core/{ports,commands,events,tools}` — since every domain
 * module depends on it. Then domain modules, each already independent at source (git co-change
 * shows domain modules essentially never change together, so they can be ported one at a time
 * without coordination): post, taxonomy, entries, content-types, media, seo, comments, forms,
 * navigation, redirects, widgets, newsletter, members.
 *
 * Deliberately NOT ported: the source `src/server/**` (Express transport — Jini has
 * `@jini-ai/http-kit` and `@jini-ai/server` for that) and the admin UI (`@jini-ai/admin` owns it).
 */

/**
 * Layer marker. Exists so the `/core` entry point has a real runtime export to resolve and test
 * against before any domain code lands — an empty module would still build but would not prove the
 * `exports` map, the build output paths, or the test wiring actually work.
 *
 * Delete this once the first real module is exported from here; it has no purpose after that.
 */
export const CMS_CORE_LAYER = 'core' as const;
