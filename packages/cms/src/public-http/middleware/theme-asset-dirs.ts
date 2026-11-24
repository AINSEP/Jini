import { existsSync } from "node:fs";

/** The host's theme-id alias table: every id a request's theme id answers to, current name first. */
export type ThemeIdCandidates = (required: { id: string }) => readonly string[];

/** A containment-checked `<root>/<segment>` join (the host passes `@jini-ai/platform/fs`'s
 * `resolvePathWithin`): `null` for `..`/separators/absolute segments. */
export type ResolvePathWithin = (required: { root: string; segment: string }, optional: {}) => string | null;

/**
 * @file Maps a request's `:themeId` to the theme folders `theme-static-assets.ts` may serve from.
 * Split out of that middleware so the refusals below can be exercised directly: Express never
 * routes an empty or missing `:themeId`, so over HTTP those guards are unreachable, yet they are
 * what keeps a root itself from being served as if it were a theme.
 */

/**
 * Every existing folder `themeId` resolves to, in the order to try them.
 *
 * A renamed theme answers to both ids (`theme-id-aliases.ts`): old `/theme-assets/basic/...`
 * URLs baked into stored content keep resolving after the rename, on sites that have either
 * folder. Current name first; a file missing there falls through to the retired folder.
 *
 * @param required.roots Absolute theme roots, checked in order (see `resolveThemeDir`).
 * @param required.themeId The raw route parameter; a missing one is treated as `""` and refused.
 * @param required.themeIdCandidates The host's alias table (see `ThemeIdCandidates`).
 * @param required.resolvePathWithin The host's containment-checked join (see `ResolvePathWithin`).
 * @returns Zero, one or two absolute folder paths; never a path outside `roots`.
 * @complexity O(candidates × roots) `existsSync` calls — at most 2 × roots.length.
 */
export function resolveThemeDirs(
  required: { roots: readonly string[]; themeId: string | undefined; themeIdCandidates: ThemeIdCandidates; resolvePathWithin: ResolvePathWithin },
  _optional: {},
): string[] {
  const themeId = String(required.themeId ?? "");
  return required.themeIdCandidates({ id: themeId })
    .map((id) => resolveThemeDir({ roots: required.roots, themeId: id, resolvePathWithin: required.resolvePathWithin }))
    .filter((dir): dir is string => dir !== null);
}

/**
 * Resolve `<root>/<themeId>` to a real directory for the first `root` (checked in order) where it
 * exists, or `null` if no root has it — the multi-root generalization of the original single-root
 * function (unchanged validation per root, just tried across a list). Tie-break for a `themeId` that
 * happens to exist under more than one root: first root in `roots` wins — today's caller
 * (`app.ts`) always lists `themes/static` before `themes/templated`, so an accidental same-named
 * folder in both resolves to the static one, matching this mount's original (pre-extension) behavior
 * for every theme id that already existed under `themes/static`. No such collision exists on disk
 * today (verified: `ls themes/static themes/templated` share no folder name).
 *
 * Four separate refusals per root, because a path segment now arrives from the request rather than
 * from a `readdirSync` of trusted names:
 * - `..`/separators/absolute paths, rejected by `@jini-ai/platform/fs`'s shared
 *   `resolvePathWithin` — kept even though Express decodes `:themeId` as a single segment, because
 *   that is a property of the routing layer rather than of this function.
 * - the `__original-themes__` catalog, whose whole purpose is to be a pristine
 *   copy nothing serves or runs; it is not a theme and must not be reachable as one.
 * - ANY dot-prefixed directory name. The host's `.<product>-migrate-staging-*` scratch output (ARCH-001,
 *   2026-08-19) is the case that forced this: `migrate-theme.ts` deliberately leaves that on disk
 *   for dry-run/failure inspection as a direct sibling of real theme folders, and without a
 *   refusal it resolved here exactly like a real theme id -- its whole folder (css, tokens,
 *   screenshots) was servable over HTTP. Refusing the DOT rather than that one literal prefix is
 *   deliberate: it is strictly broader (any hidden dir -- .git, .env.d, a future scratch prefix --
 *   is refused for free), no legitimate theme id is dot-prefixed (verified against
 *   content/themes/static and content/themes/templated), and it needs NO import. The earlier form
 *   imported MIGRATION_STAGING_DIR_PREFIX from features/theme/theme.ts, which made this the only
 *   file in src/server/ importing that 1134-line module and regressed four check:architecture
 *   metrics (propagation cost all-import 11.57->11.87 and runtime-only 1.75->1.8, module API
 *   surface 201->202, core size 16.84%->17.05%) for a single string constant.
 * - anything that simply is not there, which falls through to the next root, then to the normal 404.
 */
function resolveThemeDir({ roots, themeId, resolvePathWithin }: { roots: readonly string[]; themeId: string; resolvePathWithin: ResolvePathWithin }, _optional = {}): string | null {
  if (themeId === "" || themeId.startsWith("__") || themeId.startsWith(".")) return null;
  for (const root of roots) {
    const candidate = resolvePathWithin({ root: root, segment: themeId }, {});
    if (candidate === null) continue;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
