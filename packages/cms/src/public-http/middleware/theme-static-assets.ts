/**
 * @file The server-neutral decisions behind the host's theme-file mount (`/theme-assets/{themeId}/...`
 * and its preview twin `/theme-preview-assets/{revision}/{themeId}/...`): which preview revision a
 * request may trust, which file is a rewritable stylesheet, how a stylesheet's root-relative theme
 * references move into the preview namespace, and which inherited template source answers a path.
 * The host keeps the static file server and writes these answers onto its response.
 */

/** Whether an authenticated admin previewed `revision` (the host's preview-refresh middleware answers). */
export type IsAuthenticatedPreviewRevision = (required: { revision: string }, optional: {}) => boolean;

/** The part of a discovered theme this mount reads: its folder and the template sources it inherits. */
export interface ThemeWithInheritedTemplates {
  readonly dir: string;
  readonly inheritedTemplateSources?: Readonly<Record<string, string>>;
}

/**
 * The preview revision a `/theme-preview-assets/:revision/...` request's CSS may be rewritten for:
 * the one an upstream middleware already authenticated (`res.locals.themePreviewRevision`) when set,
 * otherwise the URL's own revision if it is well-formed and the predicate trusts it.
 *
 * A set but non-string `localsRevision` still wins over the URL's revision and yields `undefined`,
 * so nothing is rewritten.
 * @returns The revision string, or `undefined` when no CSS rewrite is allowed.
 */
export function trustedPreviewRevision(
  required: { requestedRevision: string; localsRevision: unknown },
  optional: { isAuthenticatedPreviewRevision?: IsAuthenticatedPreviewRevision },
): string | undefined {
  const { requestedRevision } = required;
  const revision = required.localsRevision ?? (
    /^[\w-]{1,100}$/.test(requestedRevision) && optional.isAuthenticatedPreviewRevision?.({ revision: requestedRevision }, {})
      ? requestedRevision : undefined
  );
  return typeof revision === "string" ? revision : undefined;
}

/** A `.css` file (any case) with no dot-prefixed segment anywhere in its theme-relative path. */
export function isRewritableCssPath({ relativePath }: { relativePath: string }, _optional: Record<string, never> = {}): boolean {
  return relativePath.toLowerCase().endsWith(".css") && !relativePath.split(/[\\/]/).some((segment) => segment.startsWith("."));
}

/** `css` with every `url(...)`/`@import` reference to `/theme-assets/` moved under `revision`'s preview prefix. */
export function previewCss(required: { css: string; revision: string }, _optional: Record<string, never> = {}): string {
  // Match root-relative references, preserving external hosts and existing query/fragment tails.
  return required.css.replace(/((?:url\(\s*["']?|@import\s+["']))\/theme-assets\//gi,
    (_match, prefix: string) => `${prefix}/theme-preview-assets/${encodeURIComponent(required.revision)}/`);
}

/** Serve only sources the loader actually inherited, after physical files have had precedence.
 * This shares the renderer's inheritance decision without exposing the entire package catalog.
 * @returns The inherited template source that answers a GET/HEAD for `url` under `themeDir`, or
 * `undefined`; malformed paths fall through.
 * @complexity O(t + u), for t loaded themes and u URL length; no disk reads.
 */
export function inheritedTemplateSource(
  { themes, themeDir, url, method }: { themes: readonly ThemeWithInheritedTemplates[]; themeDir: string; url: string; method: string },
  _optional: Record<string, never> = {},
): string | undefined {
  if (method !== "GET" && method !== "HEAD") return undefined;
  let relativePath: string;
  try { relativePath = decodeURIComponent(url.split("?")[0] ?? "").replace(/^\/+/, ""); }
  catch { return undefined; }
  const sources = themes.find(theme => theme.dir === themeDir)?.inheritedTemplateSources ?? {};
  return Object.hasOwn(sources, relativePath) ? sources[relativePath] : undefined;
}
