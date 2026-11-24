import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

/**
 * @file Shared guards for the theme Explore admin route specs (detail, file get/put/reset/copy/
 * rename/delete, save-original, page publish): one theme's editable surface, plus read/write of its
 * files, over HTTP so a human can do what the assistant's theme file tools already could.
 *
 * Theme discovery, file I/O, the originals catalog and every file-policy predicate are the host's
 * theme feature, injected per route; the specs keep the HTTP rules: the order of the checks, the
 * status and flat body of every refusal, and the response shapes the admin client reads.
 *
 * Both mutating and reading routes are gated on `theme.set`, matching every other route on this
 * resource. There is no separate read permission in the catalog, and the presentation read route
 * already documents that same reuse.
 */

/** The principal fields these routes read: none beyond the id the host port authorizes with. */
export interface ThemeExplorePrincipal { id: string }

/** The theme fields every Explore route reads itself: its id and its virtual inherited sources. */
export interface ExploreTheme {
  readonly manifest: { readonly id: string };
  /** Template sources the loader inherits from the bundled theme; listed and readable, never writable. */
  readonly inheritedTemplateSources?: Readonly<Record<string, string>>;
}

/**
 * A file's write scope as the host's theme file policy resolves it: `"generated-readonly"` (a built
 * theme's generated tree, ADR-020 §5) carries the reason the refusal quotes.
 */
export interface ExploreWriteScope { readonly kind: string; readonly reason?: string }

/**
 * The `:themeId` lookup every route starts with. Declared as a method so the host binds its own,
 * richer theme type (the specs only read {@link ExploreTheme}'s fields and hand the object back).
 */
export interface ExploreThemeLookupDeps<TTheme extends ExploreTheme = ExploreTheme> {
  findTheme(required: { themeId: string }): TTheme | undefined;
}

/** The two host error classes the file routes answer as client errors instead of a 500. */
export interface ThemeFileErrorDeps {
  isThemeFileReadOnlyError(required: { err: unknown }): boolean;
  isThemePathError(required: { err: unknown }): boolean;
}

/**
 * Asks the host for `theme.set` on the `presentation` entity type, id-free (the hand-written gate
 * never named an entity id). A mount without an authorizer is a wiring bug, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeThemeExplore({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("theme explore admin route has no authorizer");
  await authorize({ permission: "theme.set", entityType: "presentation" });
}

/** The `:themeId` path segment; Express always fills it, the `?? ""` mirrors the host's own guard. @complexity O(1). */
export function themeIdParam(params: Record<string, string | undefined>): string {
  return String(params.themeId ?? "");
}

/**
 * Resolves `:themeId` to a discovered theme, or refuses with the routes' standard code-less 404 —
 * every route starts with this exact lookup, after authorization.
 * @complexity O(1) plus the injected lookup.
 */
export function findExploreTheme<TTheme extends ExploreTheme>({ deps, themeId }: { deps: ExploreThemeLookupDeps<TTheme>; themeId: string }, _optional: Record<string, never> = {}): TTheme {
  const theme = deps.findTheme({ themeId });
  if (!theme) rejectRoute({ status: 404, error: `theme '${themeId}' was not found` });
  return theme;
}

/**
 * Map containment/size failures to 400, generated trash destinations to 403, and I/O to the host 500.
 *
 * A theme path error reflects bad INPUT — a path escaping the theme root, a missing file, an
 * oversized body. Collapsing it into 500 would tell the admin "the server broke" when the honest
 * answer is "that path is not editable", which is the difference between a user fixing their own
 * mistake and filing a bug. Anything unmapped (refusals included) is rethrown unchanged.
 * @complexity O(1) plus the two injected predicates.
 */
export function rejectThemeFileError({ err, deps }: { err: unknown; deps: ThemeFileErrorDeps }, _optional: Record<string, never> = {}): never {
  const error = err instanceof Error ? err.message : String(err);
  if (deps.isThemeFileReadOnlyError({ err })) rejectRoute({ status: 403, error, code: "GENERATED_READONLY" });
  if (deps.isThemePathError({ err })) rejectRoute({ status: 400, error, code: "INVALID_THEME_PATH" });
  throw err;
}

/** A JSON request body coerced to a plain object — `{}` for a missing/`null` body, matching every
 *  mutating route's existing lenient handling of an absent body. @complexity O(1). */
export function bodyRecord({ body }: { body: unknown }, _optional = {}): Record<string, unknown> {
  return (body ?? {}) as Record<string, unknown>;
}

/** One string field off a JSON body, defaulting to `""` when the body itself or the field is
 *  missing — the same coercion `path`/`name`/etc. applied inline at each call site, pulled into one
 *  definition so it is applied identically everywhere. @complexity O(1). */
export function bodyStringField({ body, field }: { body: unknown; field: string }, _optional = {}): string {
  return String(bodyRecord({ body })[field] ?? "");
}

/** The `{ themeId, path }` input the single-path file routes parse from `:themeId` and the body. @complexity O(1). */
export function themePathInput(raw: { params: Record<string, string | undefined>; body: unknown }): { themeId: string; path: string } {
  return { themeId: themeIdParam(raw.params), path: bodyStringField({ body: raw.body, field: "path" }) };
}

/** Refuses a missing file with the routes' shared 404 `FILE_NOT_FOUND` body. @complexity O(1). */
export function rejectMissingThemeFile({ existingPaths, path }: { existingPaths: ReadonlySet<string>; path: string }, _optional: Record<string, never> = {}): void {
  if (!existingPaths.has(path)) rejectRoute({ status: 404, error: `file '${path}' was not found in this theme`, code: "FILE_NOT_FOUND" });
}
