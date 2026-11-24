/**
 * @file The pure decisions behind the host's theme-preview refresh wiring: how a preview revision
 * is validated, which paths are theme assets, how preview HTML is re-pointed at a revision's asset
 * directory, the bounded cache of authenticated revisions, and the `preview-reload` POST's
 * authorize-then-refresh outcome. The Express middleware chain (session gate, `next(error)`
 * forwarding, `res.send` wrapping) stays in the host; this module is framework-neutral.
 */

/** The permission a theme preview reload is authorized against. */
export const THEME_PREVIEW_RELOAD_PERMISSION = "theme.set";

/** Unique asset directory also versions relative CSS imports, url() assets and JS module imports. */
export function freshThemePreviewHtml(
  { html, revision }: { html: string; revision: string },
  _optional: Record<string, never> = {},
): string {
  return html.replaceAll("/theme-assets/", `/theme-preview-assets/${encodeURIComponent(revision)}/`);
}

/** A theme asset's request path (a page load fans out into dozens of these). */
export function isThemeAssetPath({ path }: { path: string | undefined }, _optional: Record<string, never> = {}): boolean {
  return /^\/(?:theme-assets|theme-preview-assets)(?:\/|$)/.test(path ?? "");
}

/** The preview revision a query value opts into, or `undefined` when it is absent or malformed. */
export function previewRevisionOf({ value }: { value: unknown }, _optional: Record<string, never> = {}): string | undefined {
  return typeof value === "string" && /^[\w-]{1,100}$/.test(value) ? value : undefined;
}

/** The set of preview revisions an authenticated document established, oldest evicted first. */
export interface PreviewRevisionCache {
  remember(required: { revision: string }, optional?: Record<string, never>): void;
  has(required: { revision: string }, optional?: Record<string, never>): boolean;
}

/**
 * Asset loads from sandboxed previews may omit cookies (fonts use anonymous CORS). The authenticated
 * document establishes the namespace; only that namespace rewrites public CSS.
 * @complexity O(1) per call; at most `limit` revisions are held.
 */
export function createPreviewRevisionCache({ limit }: { limit: number }, _optional: Record<string, never> = {}): PreviewRevisionCache {
  const revisions = new Set<string>();
  return {
    remember: ({ revision }) => {
      revisions.add(revision);
      if (revisions.size > limit) {
        const oldest = revisions.values().next();
        if (oldest.done) throw new Error("theme preview revision cache has no oldest entry");
        revisions.delete(oldest.value);
      }
    },
    has: ({ revision }) => revisions.has(revision),
  };
}

/** What the host's `authorize` is asked, and answers. */
export type ThemePreviewReloadAuthorize = (required: {
  principalId: string;
  workspaceId: string;
  permission: string;
  entityType: string;
}) => Promise<{ allowed: boolean }>;

/** How a reload attempt ended; the host maps each kind to its response. */
export type ThemePreviewReloadOutcome =
  | { kind: "forbidden"; body: { error: string } }
  | { kind: "reloaded"; body: unknown }
  | { kind: "failed"; error: unknown };

/**
 * Authorize `theme.set`, then run the refresh. An `authorize` that throws propagates (the host
 * forwards it to `next(error)`); only a failing `refresh` becomes a `failed` outcome, because the
 * host answers that one with its redacted admin failure.
 * @complexity One authorization plus one refresh.
 */
export async function runThemePreviewReload(
  { principalId, workspaceId, authorize, refresh }: { principalId: string; workspaceId: string; authorize: ThemePreviewReloadAuthorize; refresh: () => unknown },
  _optional: Record<string, never> = {},
): Promise<ThemePreviewReloadOutcome> {
  const auth = await authorize({ principalId, workspaceId, permission: THEME_PREVIEW_RELOAD_PERMISSION, entityType: "theme" });
  if (!auth.allowed) return { kind: "forbidden", body: { error: `not authorized for '${THEME_PREVIEW_RELOAD_PERMISSION}'` } };
  try {
    return { kind: "reloaded", body: refresh() };
  } catch (error) {
    return { kind: "failed", error };
  }
}
